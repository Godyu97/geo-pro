import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { withEligibleFacts } from "../brand-facts/service.ts";
import { applyQuotaLedger, grantState } from "../quotas/ledger.ts";
import { QuotaDao } from "../quotas/dao.ts";
import type {
  BatchControlInput,
  BriefDraftFields,
  ConfirmBriefInput,
  ContentError,
  GenerateBatchInput,
  SaveBriefDraftInput,
} from "./contracts.ts";
import { ContentDao, type BriefVersionRow, type UnitRow } from "./dao.ts";
import {
  canCancel,
  canPause,
  canResume,
  canRetryFailed,
  contentBriefGaps,
  coverageFromCluster,
  deriveBatchStatus,
  fillDraftFromTemplate,
} from "./rules.ts";

type Clock = () => string;
type Failure = { error: ContentError; gaps?: Array<{ code: string }> };

function denied(error: ContentError, gaps?: Array<{ code: string }>): Failure {
  return gaps ? { error, gaps } : { error };
}

function parseFields(version: BriefVersionRow): BriefDraftFields {
  return {
    audience: version.audience,
    targetGap: version.targetGap,
    applicableBoundary: version.applicableBoundary,
    primaryPage: version.primaryPage,
    conversionAction: version.conversionAction,
    templateKind: version.templateKind,
    titleCandidates: JSON.parse(version.titleCandidatesJson) as string[],
    factVersionIds: JSON.parse(version.factVersionIdsJson) as string[],
    competitorSource: version.competitorSource,
  };
}

function versionFromFields(
  id: string,
  briefId: string,
  brandId: string,
  revision: number,
  fields: BriefDraftFields,
  createdAt: string,
  confirmedAt: string | null,
): BriefVersionRow {
  return {
    id,
    briefId,
    brandId,
    revision,
    audience: fields.audience,
    targetGap: fields.targetGap,
    applicableBoundary: fields.applicableBoundary,
    primaryPage: fields.primaryPage,
    conversionAction: fields.conversionAction,
    templateKind: fields.templateKind,
    titleCandidatesJson: JSON.stringify(fields.titleCandidates),
    factVersionIdsJson: JSON.stringify(fields.factVersionIds),
    competitorSource: fields.competitorSource ?? null,
    confirmedAt,
    createdAt,
  };
}

export async function saveBriefDraft(
  db: DatabaseConnection,
  ownerId: string,
  input: SaveBriefDraftInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand || brand.status !== "active") return denied("NOT_FOUND");

  const dao = new ContentDao(db);
  const now = clock();
  let briefId = input.briefId;
  let planId = input.planId ?? null;

  if (input.questionCluster) {
    const existing = await dao.getPlanByCluster(ownerId, input.brandId, input.questionCluster);
    if (existing) {
      planId = existing.id;
      const coverage = coverageFromCluster({
        questionCluster: input.questionCluster,
        existingPages: fieldsPrimary(input.fields),
        pendingPages: [],
        gapPages: contentBriefGaps(input.fields).length ? [input.fields.primaryPage || "planned"] : [],
      });
      await dao.updatePlanCoverage(existing.id, JSON.stringify(coverage), now);
    } else {
      planId = randomUUID();
      const coverage = coverageFromCluster({
        questionCluster: input.questionCluster,
        existingPages: fieldsPrimary(input.fields),
        pendingPages: [],
        gapPages: contentBriefGaps(input.fields).length ? [input.fields.primaryPage || "planned"] : [],
      });
      await dao.insertPlan({
        id: planId,
        brandId: input.brandId,
        ownerId,
        questionCluster: input.questionCluster,
        coverageJson: JSON.stringify(coverage),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (briefId) {
    const brief = await dao.getBrief(ownerId, input.brandId, briefId);
    if (!brief) return denied("NOT_FOUND");
    if (brief.status === "invalidated") return denied("INVALID_INPUT");
    const latest = await dao.latestBriefVersion(briefId);
    const revision = (latest?.revision ?? 0) + 1;
    const versionId = randomUUID();
    await dao.insertBriefVersion(versionFromFields(versionId, briefId, input.brandId, revision, input.fields, now, null));
    if (brief.status === "confirmed") {
      await dao.updateBriefStatus(briefId, "draft", now);
    } else {
      await dao.updateBriefStatus(briefId, "draft", now);
    }
    return { briefId, versionId, planId: brief.planId ?? planId, gaps: contentBriefGaps(input.fields) };
  }

  briefId = randomUUID();
  const versionId = randomUUID();
  await dao.insertBrief({
    id: briefId,
    brandId: input.brandId,
    ownerId,
    planId,
    optimizationTaskId: input.optimizationTaskId ?? null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  await dao.insertBriefVersion(versionFromFields(versionId, briefId, input.brandId, 1, input.fields, now, null));
  return { briefId, versionId, planId, gaps: contentBriefGaps(input.fields) };
}

function fieldsPrimary(fields: BriefDraftFields) {
  return fields.primaryPage.trim() ? [fields.primaryPage.trim()] : [];
}

export async function confirmBrief(
  db: DatabaseConnection,
  ownerId: string,
  input: ConfirmBriefInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand || brand.status !== "active") return denied("NOT_FOUND");

  const dao = new ContentDao(db);
  const brief = await dao.getBrief(ownerId, input.brandId, input.briefId);
  if (!brief) return denied("NOT_FOUND");
  if (brief.status === "invalidated") return denied("INVALID_INPUT");

  const latest = await dao.latestBriefVersion(brief.id);
  if (!latest) return denied("INVALID_INPUT");
  const fields = parseFields(latest);
  const gaps = contentBriefGaps(fields);
  if (gaps.length) return denied("EVIDENCE_REQUIRED", gaps);

  const now = clock();
  await dao.markBriefVersionConfirmed(latest.id, now);
  await dao.updateBriefStatus(brief.id, "confirmed", now);
  return { briefId: brief.id, status: "confirmed" as const, versionId: latest.id };
}

type CostLedger = {
  mode: "quota" | "unknown_pending";
  reservationId: string | null;
  attempts: Array<{ attemptId: string; briefId: string; outcome: string }>;
  upperMinor: number;
  currency: string;
};

async function settleGeneration(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  reservationId: string,
  clock: Clock,
) {
  await applyQuotaLedger(db, ownerId, {
    action: "settle",
    brandId,
    kind: "generation",
    reservationId,
  }, clock);
}

async function generateOneUnit(params: {
  db: DatabaseConnection;
  ownerId: string;
  brandId: string;
  unit: UnitRow;
  version: BriefVersionRow;
  fields: BriefDraftFields;
  failSet: Set<string>;
  reservationId: string | null;
  useQuota: boolean;
  upperMinor: number;
  currency: string;
  clock: Clock;
  ledger: CostLedger;
}) {
  const {
    db, ownerId, brandId, unit, version, fields, failSet, reservationId,
    useQuota, upperMinor, currency, clock, ledger,
  } = params;
  const dao = new ContentDao(db);
  const now = clock();
  const running: UnitRow = {
    ...unit,
    status: "running",
    attemptCount: unit.attemptCount + 1,
    lastError: null,
    blockedReason: null,
    updatedAt: now,
  };
  await dao.updateUnit(running);

  if (failSet.has(unit.briefId)) {
    const failed: UnitRow = {
      ...running,
      status: "failed",
      lastError: "fixture_forced_failure",
      updatedAt: clock(),
    };
    await dao.updateUnit(failed);
    ledger.attempts.push({ attemptId: randomUUID(), briefId: unit.briefId, outcome: "failed" });
    return failed;
  }

  const gaps = contentBriefGaps(fields);
  if (gaps.length) {
    const blocked: UnitRow = {
      ...running,
      status: "blocked",
      blockedReason: gaps.map((gap) => gap.code).join(","),
      updatedAt: clock(),
    };
    await dao.updateUnit(blocked);
    ledger.attempts.push({ attemptId: randomUUID(), briefId: unit.briefId, outcome: "blocked" });
    return blocked;
  }

  const contentVersionId = randomUUID();
  const attemptId = randomUUID();

  if (useQuota && reservationId) {
    const started = await applyQuotaLedger(db, ownerId, {
      action: "start",
      brandId,
      kind: "generation",
      reservationId,
      attemptId,
      upperMinor,
      currency: currency as "CNY" | "USD" | "JPY",
    }, clock);
    if (started !== "applied" && started !== "replayed") {
      const blocked: UnitRow = {
        ...running,
        status: "blocked",
        blockedReason: `quota_${started}`,
        updatedAt: clock(),
      };
      await dao.updateUnit(blocked);
      ledger.attempts.push({ attemptId, briefId: unit.briefId, outcome: "blocked" });
      return blocked;
    }
  }

  const bound = await withEligibleFacts(
    db,
    { ownerId, brandId },
    { factVersionIds: fields.factVersionIds, contentVersionId, stage: "review" },
    async (tx, facts) => {
      const filled = fillDraftFromTemplate({
        templateKind: fields.templateKind,
        titleCandidates: fields.titleCandidates,
        audience: fields.audience,
        targetGap: fields.targetGap,
        applicableBoundary: fields.applicableBoundary,
        primaryPage: fields.primaryPage,
        conversionAction: fields.conversionAction,
        competitorSource: fields.competitorSource,
        facts: facts.map((fact) => ({ id: fact.id, claim: fact.claim })),
      });
      const txDao = new ContentDao(tx);
      await txDao.insertContentVersion({
        id: contentVersionId,
        brandId,
        ownerId,
        briefId: unit.briefId,
        briefVersionId: version.id,
        batchUnitId: unit.id,
        templateKind: fields.templateKind,
        title: filled.title,
        bodyMarkdown: filled.bodyMarkdown,
        claimsJson: JSON.stringify(filled.claims),
        status: "draft",
        fingerprint: filled.fingerprint,
        createdAt: clock(),
      });
      return filled;
    },
    () => new Date(clock()),
  );

  if ("error" in bound) {
    if (useQuota && reservationId) {
      await applyQuotaLedger(db, ownerId, {
        action: "reconcile",
        brandId,
        kind: "generation",
        reservationId,
        attemptId,
        actualMinor: 0,
        currency: currency as "CNY" | "USD" | "JPY",
      }, clock);
    }
    if (bound.error === "factInvalid") {
      await dao.updateBriefStatus(unit.briefId, "invalidated", clock());
      const blocked: UnitRow = {
        ...running,
        status: "blocked",
        blockedReason: "facts_unusable",
        updatedAt: clock(),
      };
      await dao.updateUnit(blocked);
      ledger.attempts.push({ attemptId, briefId: unit.briefId, outcome: "blocked" });
      return blocked;
    }
    const failed: UnitRow = {
      ...running,
      status: "failed",
      lastError: String(bound.error),
      updatedAt: clock(),
    };
    await dao.updateUnit(failed);
    ledger.attempts.push({ attemptId, briefId: unit.briefId, outcome: "failed" });
    return failed;
  }

  if (useQuota && reservationId) {
    await applyQuotaLedger(db, ownerId, {
      action: "reconcile",
      brandId,
      kind: "generation",
      reservationId,
      attemptId,
      actualMinor: 0,
      currency: currency as "CNY" | "USD" | "JPY",
    }, clock);
  }

  const succeeded: UnitRow = {
    ...running,
    status: "succeeded",
    contentVersionId,
    lastError: null,
    blockedReason: null,
    updatedAt: clock(),
  };
  await dao.updateUnit(succeeded);
  ledger.attempts.push({ attemptId, briefId: unit.briefId, outcome: "succeeded" });
  return succeeded;
}

export async function generateBatch(
  db: DatabaseConnection,
  ownerId: string,
  input: GenerateBatchInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand || brand.status !== "active") return denied("NOT_FOUND");

  const dao = new ContentDao(db);
  const existing = await dao.getBatchByOperation(input.brandId, input.operationId);
  if (existing) {
    const units = await dao.listUnits(existing.id);
    if (units.length === input.briefIds.length
      && input.briefIds.every((id) => units.some((unit) => unit.briefId === id))) {
      return { batch: existing, units, replayed: true as const };
    }
    return denied("OPERATION_CONFLICT");
  }

  const briefPayloads: Array<{ briefId: string; version: BriefVersionRow; fields: BriefDraftFields }> = [];
  for (const briefId of input.briefIds) {
    const brief = await dao.getBrief(ownerId, input.brandId, briefId);
    if (!brief) return denied("NOT_FOUND");
    if (brief.status !== "confirmed") {
      const latest = await dao.latestBriefVersion(briefId);
      const gaps = latest ? contentBriefGaps(parseFields(latest)) : [{ code: "factsMissing" }];
      return denied("EVIDENCE_REQUIRED", gaps);
    }
    const version = await dao.latestBriefVersion(briefId);
    if (!version?.confirmedAt) return denied("INVALID_INPUT");
    const fields = parseFields(version);
    const gaps = contentBriefGaps(fields);
    if (gaps.length) return denied("EVIDENCE_REQUIRED", gaps);
    briefPayloads.push({ briefId, version, fields });
  }

  const now = clock();
  const quotaDao = new QuotaDao(db);
  const grant = await quotaDao.grant(input.brandId, "generation");
  const activeGrant = grant && grantState(grant, now) === "active" ? grant : null;
  const upperMinor = 100;
  const currency = activeGrant?.currency ?? "CNY";
  const reservationId = activeGrant ? randomUUID() : null;
  const ledger: CostLedger = {
    mode: activeGrant ? "quota" : "unknown_pending",
    reservationId,
    attempts: [],
    upperMinor,
    currency,
  };

  if (activeGrant && reservationId) {
    const reserved = await applyQuotaLedger(db, ownerId, {
      action: "reserve",
      brandId: input.brandId,
      kind: "generation",
      reservationId,
      version: activeGrant.version,
      upperMinor: upperMinor * input.briefIds.length,
      currency: currency as "CNY" | "USD" | "JPY",
    }, clock);
    if (reserved !== "applied" && reserved !== "replayed") {
      return denied("INVALID_INPUT");
    }
  }

  const batchId = randomUUID();
  await dao.insertBatch({
    id: batchId,
    brandId: input.brandId,
    ownerId,
    status: "running",
    reservationId,
    operationId: input.operationId,
    costLedgerJson: JSON.stringify(ledger),
    createdAt: now,
    updatedAt: now,
  });

  const failSet = new Set(input.fixtures?.failBriefIds ?? []);
  const pauseAfter = input.fixtures?.pauseAfter;
  const units: UnitRow[] = [];
  let processed = 0;
  for (const item of briefPayloads) {
    const unitId = randomUUID();
    const unit: UnitRow = {
      id: unitId,
      batchId,
      briefId: item.briefId,
      brandId: input.brandId,
      status: "queued",
      attemptCount: 0,
      contentVersionId: null,
      lastError: null,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    await dao.insertUnit(unit);
    if (pauseAfter !== undefined && processed >= pauseAfter) {
      units.push(unit);
      continue;
    }
    const result = await generateOneUnit({
      db,
      ownerId,
      brandId: input.brandId,
      unit,
      version: item.version,
      fields: item.fields,
      failSet,
      reservationId,
      useQuota: Boolean(activeGrant && reservationId),
      upperMinor,
      currency,
      clock,
      ledger,
    });
    units.push(result);
    processed += 1;
  }

  const paused = pauseAfter !== undefined && units.some((unit) => unit.status === "queued");
  if (!paused && activeGrant && reservationId) {
    await settleGeneration(db, ownerId, input.brandId, reservationId, clock);
  }

  const status = paused ? "paused" as const : deriveBatchStatus(units);
  await dao.updateBatch({
    id: batchId,
    status,
    reservationId,
    costLedgerJson: JSON.stringify(ledger),
    updatedAt: clock(),
  });
  const batch = await dao.getBatch(ownerId, input.brandId, batchId);
  return { batch: batch!, units, replayed: false as const };
}

export async function pauseBatch(
  db: DatabaseConnection,
  ownerId: string,
  input: BatchControlInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const dao = new ContentDao(db);
  const batch = await dao.getBatch(ownerId, input.brandId, input.batchId);
  if (!batch) return denied("NOT_FOUND");
  if (!canPause(batch.status)) return denied("INVALID_INPUT");
  await dao.updateBatch({
    id: batch.id,
    status: "paused",
    reservationId: batch.reservationId,
    costLedgerJson: batch.costLedgerJson,
    updatedAt: clock(),
  });
  return { batchId: batch.id, status: "paused" as const };
}

export async function cancelBatch(
  db: DatabaseConnection,
  ownerId: string,
  input: BatchControlInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const dao = new ContentDao(db);
  const batch = await dao.getBatch(ownerId, input.brandId, input.batchId);
  if (!batch) return denied("NOT_FOUND");
  if (!canCancel(batch.status)) return denied("INVALID_INPUT");
  const now = clock();
  const units = await dao.listUnits(batch.id);
  for (const unit of units) {
    if (unit.status === "queued" || unit.status === "running") {
      await dao.updateUnit({
        ...unit,
        status: "failed",
        lastError: "cancelled",
        updatedAt: now,
      });
    }
  }
  if (batch.reservationId) {
    const ledger = JSON.parse(batch.costLedgerJson) as CostLedger;
    if (ledger.mode === "quota") {
      await applyQuotaLedger(db, ownerId, {
        action: "release",
        brandId: input.brandId,
        kind: "generation",
        reservationId: batch.reservationId,
        noFurtherResult: true,
      }, clock).catch(() => undefined);
    }
  }
  await dao.updateBatch({
    id: batch.id,
    status: "cancelled",
    reservationId: batch.reservationId,
    costLedgerJson: batch.costLedgerJson,
    updatedAt: now,
  });
  return { batchId: batch.id, status: "cancelled" as const };
}

export async function resumeBatch(
  db: DatabaseConnection,
  ownerId: string,
  input: BatchControlInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand || brand.status !== "active") return denied("NOT_FOUND");

  const dao = new ContentDao(db);
  const batch = await dao.getBatch(ownerId, input.brandId, input.batchId);
  if (!batch) return denied("NOT_FOUND");
  if (!canResume(batch.status)) return denied("INVALID_INPUT");

  const ledger = JSON.parse(batch.costLedgerJson) as CostLedger;
  const units = await dao.listUnits(batch.id);
  const results: UnitRow[] = [];

  for (const unit of units) {
    if (unit.status === "succeeded") {
      results.push(unit);
      continue;
    }
    if (unit.status !== "queued" && unit.status !== "failed" && unit.status !== "blocked" && unit.status !== "running") {
      results.push(unit);
      continue;
    }

    const brief = await dao.getBrief(ownerId, input.brandId, unit.briefId);
    const version = await dao.latestBriefVersion(unit.briefId);
    if (!brief || !version) {
      const blocked: UnitRow = {
        ...unit,
        status: "blocked",
        blockedReason: "brief_missing",
        updatedAt: clock(),
      };
      await dao.updateUnit(blocked);
      results.push(blocked);
      continue;
    }
    const fields = parseFields(version);
    const result = await generateOneUnit({
      db,
      ownerId,
      brandId: input.brandId,
      unit: { ...unit, contentVersionId: null },
      version,
      fields,
      failSet: new Set(),
      reservationId: batch.reservationId,
      useQuota: ledger.mode === "quota" && Boolean(batch.reservationId),
      upperMinor: ledger.upperMinor || 100,
      currency: ledger.currency || "CNY",
      clock,
      ledger,
    });
    results.push(result);
  }

  if (ledger.mode === "quota" && batch.reservationId) {
    await settleGeneration(db, ownerId, input.brandId, batch.reservationId, clock).catch(() => undefined);
  }

  const status = deriveBatchStatus(results);
  await dao.updateBatch({
    id: batch.id,
    status,
    reservationId: batch.reservationId,
    costLedgerJson: JSON.stringify(ledger),
    updatedAt: clock(),
  });
  return { batchId: batch.id, status, units: results };
}

export async function retryFailed(
  db: DatabaseConnection,
  ownerId: string,
  input: BatchControlInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand || brand.status !== "active") return denied("NOT_FOUND");

  const dao = new ContentDao(db);
  const batch = await dao.getBatch(ownerId, input.brandId, input.batchId);
  if (!batch) return denied("NOT_FOUND");
  if (!canRetryFailed(batch.status)) return denied("INVALID_INPUT");

  const ledger = JSON.parse(batch.costLedgerJson) as CostLedger;
  const units = await dao.listUnits(batch.id);
  const succeededSnapshot = units
    .filter((unit) => unit.status === "succeeded")
    .map((unit) => ({ id: unit.id, contentVersionId: unit.contentVersionId }));

  const results: UnitRow[] = [];
  for (const unit of units) {
    if (unit.status !== "failed") {
      results.push(unit);
      continue;
    }
    const version = await dao.latestBriefVersion(unit.briefId);
    if (!version) {
      const blocked: UnitRow = {
        ...unit,
        status: "blocked",
        blockedReason: "brief_missing",
        updatedAt: clock(),
      };
      await dao.updateUnit(blocked);
      results.push(blocked);
      continue;
    }
    const fields = parseFields(version);
    // Clear fixture fail on retry so AC-2 can succeed after forced failure.
    const result = await generateOneUnit({
      db,
      ownerId,
      brandId: input.brandId,
      unit,
      version,
      fields,
      failSet: new Set(),
      reservationId: batch.reservationId,
      useQuota: ledger.mode === "quota" && Boolean(batch.reservationId),
      upperMinor: ledger.upperMinor || 100,
      currency: ledger.currency || "CNY",
      clock,
      ledger,
    });
    results.push(result);
  }

  if (ledger.mode === "quota" && batch.reservationId) {
    // Same reservation: additional attempts do not open a new reservation.
    await settleGeneration(db, ownerId, input.brandId, batch.reservationId, clock).catch(() => undefined);
  }

  const status = deriveBatchStatus(results);
  await dao.updateBatch({
    id: batch.id,
    status,
    reservationId: batch.reservationId,
    costLedgerJson: JSON.stringify(ledger),
    updatedAt: clock(),
  });

  for (const prior of succeededSnapshot) {
    const current = results.find((unit) => unit.id === prior.id);
    if (!current || current.contentVersionId !== prior.contentVersionId) {
      return denied("OPERATION_CONFLICT");
    }
  }

  return { batchId: batch.id, status, units: results, preservedSuccesses: succeededSnapshot };
}

export async function readPlan(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  planId: string,
) {
  const dao = new ContentDao(db);
  const plan = await dao.getPlan(ownerId, brandId, planId);
  if (!plan) return denied("NOT_FOUND");
  return { plan };
}

export async function listBriefs(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  limit = 20,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, brandId);
  if (!brand) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const [briefs, plans] = await Promise.all([
    dao.listBriefs(ownerId, brandId, limit),
    dao.listPlans(ownerId, brandId, limit),
  ]);
  const withVersions = await Promise.all(briefs.map(async (brief) => {
    const version = await dao.latestBriefVersion(brief.id);
    return { brief, version, gaps: version ? contentBriefGaps(parseFields(version)) : [] };
  }));
  return { briefs: withVersions, plans };
}

export async function readBatch(
  db: DatabaseConnection,
  ownerId: string,
  batchId: string,
) {
  const dao = new ContentDao(db);
  const batch = await dao.getBatchByIdForOwner(ownerId, batchId);
  if (!batch) return denied("NOT_FOUND");
  const units = await dao.listUnits(batch.id);
  return { batch, units };
}

export async function readContentVersion(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  const dao = new ContentDao(db);
  const version = await dao.getContentVersion(ownerId, versionId);
  if (!version) return denied("NOT_FOUND");
  return { version };
}

export async function readBriefDetail(
  db: DatabaseConnection,
  ownerId: string,
  briefId: string,
) {
  const dao = new ContentDao(db);
  const brief = await dao.getBriefByIdForOwner(ownerId, briefId);
  if (!brief) return denied("NOT_FOUND");
  const version = await dao.latestBriefVersion(brief.id);
  return {
    brief,
    version,
    gaps: version ? contentBriefGaps(parseFields(version)) : [],
    fields: version ? parseFields(version) : null,
  };
}
