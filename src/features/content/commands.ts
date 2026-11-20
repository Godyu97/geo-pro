import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { factGaps, factStatus } from "../brand-facts/rules.ts";
import { withEligibleFacts } from "../brand-facts/service.ts";
import { applyQuotaLedger, grantState } from "../quotas/ledger.ts";
import { QuotaDao } from "../quotas/dao.ts";
import {
  defaultLabelingProfileVersion,
  defaultTargetChannel,
  type ApproveContentInput,
  type BatchControlInput,
  type BriefDraftFields,
  type ConfirmBriefInput,
  type ContentError,
  type ExportConfirmInput,
  type ExportMode,
  type ExportPreflightInput,
  type GenerateBatchInput,
  type PackageKind,
  type PreflightBlockerCode,
  type RegisterAssetInput,
  type RejectContentInput,
  type SaveBriefDraftInput,
  type SubmitReviewInput,
  type UpdateVariantInput,
} from "./contracts.ts";
import { ContentDao, type BriefVersionRow, type ContentVersionRow, type PackageRow, type UnitRow } from "./dao.ts";
import {
  buildPackageFiles,
  computeApprovalFingerprint,
  preflightBlockers,
  resolveExportKind,
  validateExportSubset,
  type PackageFact,
} from "./package.ts";
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
export type ExportBlocker = { versionId: string; codes: PreflightBlockerCode[] };
type Failure = {
  error: ContentError;
  gaps?: Array<{ code: string }>;
  blockers?: ExportBlocker[];
};

function denied(error: ContentError, gaps?: Array<{ code: string }>, blockers?: ExportBlocker[]): Failure {
  return { error, ...(gaps ? { gaps } : {}), ...(blockers ? { blockers } : {}) };
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
      const draftTime = clock();
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
        targetChannel: defaultTargetChannel,
        labelingProfileVersion: defaultLabelingProfileVersion,
        labelingProfileStatus: "unverified",
        imageAssetIdsJson: "[]",
        factVersionIdsJson: JSON.stringify(fields.factVersionIds),
        createdAt: draftTime,
        updatedAt: draftTime,
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
  // Frozen or foreign brands never expose approvals or package metadata.
  const brand = await new BrandDao(db).owned(ownerId, version.brandId);
  if (!brand) return denied("NOT_FOUND");
  const [approvals, packageRows, assets] = await Promise.all([
    dao.listApprovals(ownerId, version.id),
    dao.listPackagesForVersion(ownerId, version.id),
    dao.getAssetsByIds(ownerId, version.brandId, parseIds(version.imageAssetIdsJson)),
  ]);
  const currentFingerprint = versionFingerprint(version);
  return {
    version,
    approvals,
    packages: packageRows.map(summarizePackage),
    assets,
    currentFingerprint,
    approvalCurrent: version.status === "approved"
      && approvals.some((item) => item.decision === "approved" && item.contentFingerprint === currentFingerprint),
    readOnly: brand.status !== "active",
  };
}

export type ContentVersionFilter = "pending_review" | "deliverable";

export async function listContentVersions(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  limit = 20,
  filter?: ContentVersionFilter,
) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  if (!brand) return denied("NOT_FOUND");
  const statuses = filter === "pending_review" ? ["in_review"] : filter === "deliverable" ? ["approved"] : undefined;
  const versions = await new ContentDao(db).listContentVersionsForBrand(ownerId, brandId, limit, statuses);
  return { versions };
}

export async function readDeliveryPackage(
  db: DatabaseConnection,
  ownerId: string,
  packageId: string,
) {
  const dao = new ContentDao(db);
  const row = await dao.getPackage(ownerId, packageId);
  if (!row) return denied("NOT_FOUND");
  if (!await new BrandDao(db).owned(ownerId, row.brandId)) return denied("NOT_FOUND");
  return { package: summarizePackage(row), files: JSON.parse(row.filesJson) as Record<string, string> };
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

// ---------------------------------------------------------------------------
// S-M0-10: review, approval, assets, and single-channel delivery packages
// ---------------------------------------------------------------------------

function parseIds(json: string): string[] {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function versionFingerprint(version: ContentVersionRow) {
  return computeApprovalFingerprint({
    title: version.title,
    bodyMarkdown: version.bodyMarkdown,
    claims: JSON.parse(version.claimsJson) as Record<string, string>,
    imageAssetIds: parseIds(version.imageAssetIdsJson),
    targetChannel: version.targetChannel,
    labelingProfileVersion: version.labelingProfileVersion,
    labelingProfileStatus: version.labelingProfileStatus,
    factVersionIds: parseIds(version.factVersionIdsJson),
  });
}

function summarizePackage(row: PackageRow) {
  const { filesJson, manifestJson, doNotReuse, nonPublishable, ...rest } = row;
  void filesJson; // List/summary views never expose file bytes.
  return {
    ...rest,
    doNotReuse: doNotReuse === 1,
    nonPublishable: nonPublishable === 1,
    manifest: JSON.parse(manifestJson) as Record<string, unknown>,
  };
}

function factFailure(result: { error?: string }): Failure {
  if (result.error === "factInvalid") return denied("FACT_INVALID");
  if (result.error === "conflict") return denied("OPERATION_CONFLICT");
  return denied("NOT_FOUND");
}

async function activeBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  return brand && brand.status === "active" ? brand : null;
}

async function ownedVersion(dao: ContentDao, ownerId: string, brandId: string, versionId: string) {
  const version = await dao.getContentVersion(ownerId, versionId);
  return version && version.brandId === brandId ? version : null;
}

async function locked<T>(
  db: DatabaseConnection,
  ownerId: string,
  work: (transaction: TransactionConnection) => Promise<T>,
): Promise<T | Failure> {
  return db.transaction(async (transaction) => {
    if (!await new BrandDao(transaction).lockOwner(ownerId)) return denied("NOT_FOUND");
    return work(transaction);
  });
}

export async function submitReview(
  db: DatabaseConnection,
  ownerId: string,
  input: SubmitReviewInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    if (version.status === "in_review") {
      return { versionId: version.id, status: "in_review" as const, replayed: true };
    }
    if (version.status === "approved") return denied("INVALID_INPUT");
    await dao.updateContentVersionStatus(version.id, "in_review", clock());
    return { versionId: version.id, status: "in_review" as const, replayed: false };
  });
}

export async function approveContent(
  db: DatabaseConnection,
  ownerId: string,
  input: ApproveContentInput,
  clock: Clock = () => new Date().toISOString(),
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
  if (!version) return denied("NOT_FOUND");

  if (version.status === "approved") {
    const fingerprint = versionFingerprint(version);
    const approval = (await dao.listApprovals(ownerId, version.id))
      .find((item) => item.decision === "approved" && item.contentFingerprint === fingerprint);
    if (!approval) return denied("INVALID_INPUT");
    return { versionId: version.id, approvalId: approval.id, status: "approved" as const, replayed: true };
  }
  if (version.status !== "in_review") return denied("INVALID_INPUT");
  const factVersionIds = parseIds(version.factVersionIdsJson);
  if (factVersionIds.length === 0) return denied("FACT_INVALID");

  // Facts are rechecked under the owner lock so a concurrent revoke cannot slip through.
  const gate = await withEligibleFacts(
    db,
    { ownerId, brandId: input.brandId },
    { factVersionIds, contentVersionId: version.id, stage: "review" },
    async (transaction) => {
      const txDao = new ContentDao(transaction);
      const current = await ownedVersion(txDao, ownerId, input.brandId, input.versionId);
      if (!current || current.status !== "in_review") return null;
      const fingerprint = versionFingerprint(current);
      const now = clock();
      const approvalId = randomUUID();
      await txDao.insertApproval({
        id: approvalId,
        brandId: input.brandId,
        ownerId,
        contentVersionId: current.id,
        contentFingerprint: fingerprint,
        factVersionIdsJson: current.factVersionIdsJson,
        decision: "approved",
        actorId: ownerId,
        createdAt: now,
      });
      await txDao.updateContentVersionStatus(current.id, "approved", now);
      await txDao.markPackagesDoNotReuse(ownerId, current.id, fingerprint);
      return { approvalId, fingerprint };
    },
    () => new Date(clock()),
  );
  if ("error" in gate) return factFailure(gate);
  if (!gate.data) return denied("INVALID_INPUT");
  return {
    versionId: version.id,
    approvalId: gate.data.approvalId,
    contentFingerprint: gate.data.fingerprint,
    status: "approved" as const,
    replayed: false,
  };
}

export async function rejectContent(
  db: DatabaseConnection,
  ownerId: string,
  input: RejectContentInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    if (version.status !== "in_review") return denied("INVALID_INPUT");
    const now = clock();
    const approvalId = randomUUID();
    await dao.insertApproval({
      id: approvalId,
      brandId: input.brandId,
      ownerId,
      contentVersionId: version.id,
      contentFingerprint: versionFingerprint(version),
      factVersionIdsJson: version.factVersionIdsJson,
      decision: "rejected",
      actorId: ownerId,
      createdAt: now,
    });
    await dao.updateContentVersionStatus(version.id, "rejected", now);
    return { versionId: version.id, approvalId, status: "rejected" as const };
  });
}

export async function updateVariant(
  db: DatabaseConnection,
  ownerId: string,
  input: UpdateVariantInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");

    const imageAssetIds = input.imageAssetIds ? [...new Set(input.imageAssetIds)] : parseIds(version.imageAssetIdsJson);
    if (input.imageAssetIds) {
      const found = await dao.getAssetsByIds(ownerId, input.brandId, imageAssetIds);
      if (found.length !== imageAssetIds.length) return denied("NOT_FOUND");
    }
    const next: ContentVersionRow = {
      ...version,
      title: input.title ?? version.title,
      bodyMarkdown: input.bodyMarkdown ?? version.bodyMarkdown,
      targetChannel: input.targetChannel ?? version.targetChannel,
      labelingProfileVersion: input.labelingProfileVersion ?? version.labelingProfileVersion,
      labelingProfileStatus: input.labelingProfileStatus ?? version.labelingProfileStatus,
      imageAssetIdsJson: JSON.stringify(imageAssetIds),
    };
    if (versionFingerprint(next) === versionFingerprint(version)) {
      return { versionId: version.id, status: version.status, changed: false, invalidated: false };
    }

    // Any variant change voids an approval; old approvals and packages stay readable.
    const invalidated = version.status === "approved";
    const status = invalidated ? "invalidated" as const : version.status;
    await dao.updateContentVersionVariant({ ...next, status, updatedAt: clock() });
    if (invalidated) await dao.markPackagesDoNotReuse(ownerId, version.id, null);
    return { versionId: version.id, status, changed: true, invalidated };
  });
}

export async function registerAsset(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterAssetInput,
  clock: Clock = () => new Date().toISOString(),
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.kind, input.source, input.rightsStatement, input.visibility, input.contentRef]), "utf8")
    .digest("hex");
  const asset = {
    id: randomUUID(),
    brandId: input.brandId,
    ownerId,
    kind: input.kind,
    source: input.source,
    rightsStatement: input.rightsStatement,
    visibility: input.visibility,
    reviewStatus: input.reviewStatus,
    contentRef: input.contentRef,
    fingerprint,
    createdAt: clock(),
  };
  await new ContentDao(db).insertAsset(asset);
  return { asset };
}

type PreflightItem = {
  versionId: string;
  title: string;
  status: ContentVersionRow["status"];
  targetChannel: string;
  labelingProfileStatus: ContentVersionRow["labelingProfileStatus"];
  kind: PackageKind;
  blockers: PreflightBlockerCode[];
  invalidFactVersionIds: string[];
  eligible: boolean;
};

type ExportSelection = { versionIds: string[]; mode: ExportMode };

async function computePreflight(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  versions: ContentVersionRow[],
  mode: ExportMode,
  now: string,
): Promise<PreflightItem[]> {
  const dao = new ContentDao(db);
  const approvals = await dao.listApprovalsForVersions(ownerId, versions.map((version) => version.id));
  const factIds = [...new Set(versions.flatMap((version) => parseIds(version.factVersionIdsJson)))];
  const facts = factIds.length ? await new FactDao(db, { ownerId, brandId }).versionsById(factIds) : [];
  const today = now.slice(0, 10);
  const usable = new Set(facts
    .filter((fact) => factStatus(fact, today) === "approved" && factGaps(fact.fields, today).length === 0)
    .map((fact) => fact.id));

  return versions.map((version) => {
    const ids = parseIds(version.factVersionIdsJson);
    const invalid = ids.length ? ids.filter((id) => !usable.has(id)) : ["unbound"];
    const kind = resolveExportKind(mode, version.labelingProfileStatus);
    const blockers = preflightBlockers({
      kind,
      status: version.status,
      labelingStatus: version.labelingProfileStatus,
      currentFingerprint: versionFingerprint(version),
      approvedFingerprints: approvals
        .filter((approval) => approval.contentVersionId === version.id)
        .map((approval) => approval.contentFingerprint),
      invalidFactVersionIds: invalid,
    });
    return {
      versionId: version.id,
      title: version.title,
      status: version.status,
      targetChannel: version.targetChannel,
      labelingProfileStatus: version.labelingProfileStatus,
      kind,
      blockers,
      invalidFactVersionIds: invalid,
      eligible: blockers.length === 0,
    };
  });
}

function sameSelection(a: ExportSelection, b: ExportSelection) {
  return a.mode === b.mode && [...a.versionIds].sort().join() === [...b.versionIds].sort().join();
}

export async function exportPreflight(
  db: DatabaseConnection,
  ownerId: string,
  input: ExportPreflightInput,
  clock: Clock = () => new Date().toISOString(),
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const found = await dao.getContentVersionsByIds(ownerId, input.brandId, input.versionIds);
  if (found.length !== input.versionIds.length) return denied("NOT_FOUND");
  const byId = new Map(found.map((version) => [version.id, version]));
  const versions = input.versionIds.map((id) => byId.get(id)!);

  const selection: ExportSelection = { versionIds: input.versionIds, mode: input.mode };
  const existing = await dao.getExportJobByOperation(ownerId, input.brandId, input.operationId);
  if (existing) {
    if (!sameSelection(JSON.parse(existing.selectionJson) as ExportSelection, selection)) {
      return denied("OPERATION_CONFLICT");
    }
    if (existing.status === "ready") {
      const stored = JSON.parse(existing.preflightJson) as { items: PreflightItem[]; eligibleVersionIds: string[] };
      return {
        jobId: existing.id,
        operationId: existing.operationId,
        status: existing.status,
        items: stored.items,
        eligibleVersionIds: stored.eligibleVersionIds,
        replayed: true,
      };
    }
  }

  const now = clock();
  const items = await computePreflight(db, ownerId, input.brandId, versions, input.mode, now);
  const eligibleVersionIds = items.filter((item) => item.eligible).map((item) => item.versionId);
  const preflightJson = JSON.stringify({ items, eligibleVersionIds, checkedAt: now });
  let jobId: string;
  if (existing) {
    jobId = existing.id;
    await dao.updateExportJob({
      id: existing.id,
      status: "queued",
      selectionJson: JSON.stringify(selection),
      preflightJson,
      chosenSubsetJson: "[]",
      resultPackageIdsJson: "[]",
      error: null,
      updatedAt: now,
    });
  } else {
    jobId = randomUUID();
    await dao.insertExportJob({
      id: jobId,
      brandId: input.brandId,
      ownerId,
      operationId: input.operationId,
      status: "queued",
      selectionJson: JSON.stringify(selection),
      preflightJson,
      chosenSubsetJson: "[]",
      resultPackageIdsJson: "[]",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    jobId,
    operationId: input.operationId,
    status: "queued" as const,
    items,
    eligibleVersionIds,
    replayed: false,
  };
}

type AssembleResult = { ok: true; row: PackageRow } | { ok: false; error: ContentError };

async function assemblePackage(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  versionId: string,
  kind: PackageKind,
  now: string,
): Promise<AssembleResult> {
  const dao = new ContentDao(db);
  const version = await ownedVersion(dao, ownerId, brandId, versionId);
  if (!version) return { ok: false, error: "NOT_FOUND" };
  const fingerprint = versionFingerprint(version);
  const approval = (await dao.listApprovalsForVersions(ownerId, [version.id]))
    .find((item) => item.contentFingerprint === fingerprint) ?? null;
  if (kind === "formal") {
    if (version.status !== "approved" || !approval) return { ok: false, error: "APPROVAL_REQUIRED" };
    if (version.labelingProfileStatus !== "verified") return { ok: false, error: "LABELING_UNVERIFIED" };
  }

  const factIds = parseIds(version.factVersionIdsJson);
  const factRows = factIds.length ? await new FactDao(db, { ownerId, brandId }).versionsById(factIds) : [];
  const factById = new Map(factRows.map((fact) => [fact.id, fact]));
  const facts: PackageFact[] = factIds.flatMap((id) => {
    const fact = factById.get(id);
    if (!fact) return [];
    return [{
      id: fact.id,
      factId: fact.factId,
      version: fact.version,
      claim: fact.fields.claim,
      title: fact.fields.title,
      sourceType: fact.fields.sourceType,
      sourceReference: fact.fields.sourceReference,
      sourceLocator: fact.fields.sourceLocator,
      sourceExcerpt: fact.fields.sourceExcerpt,
      sourceDate: fact.fields.sourceDate,
    }];
  });
  const assetIds = parseIds(version.imageAssetIdsJson);
  const assetRows = await dao.getAssetsByIds(ownerId, brandId, assetIds);
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const assets = assetIds.flatMap((id) => (assetById.has(id) ? [assetById.get(id)!] : []));

  const built = buildPackageFiles({
    kind,
    approvalId: approval?.id ?? null,
    contentFingerprint: fingerprint,
    version: {
      id: version.id,
      title: version.title,
      bodyMarkdown: version.bodyMarkdown,
      targetChannel: version.targetChannel,
      labelingProfileVersion: version.labelingProfileVersion,
      labelingProfileStatus: version.labelingProfileStatus,
      factVersionIds: factIds,
    },
    facts,
    assets,
  });
  const row: PackageRow = {
    id: randomUUID(),
    brandId,
    ownerId,
    contentVersionId: version.id,
    approvalId: approval?.id ?? null,
    targetChannel: version.targetChannel,
    kind,
    contentFingerprint: fingerprint,
    factVersionIdsJson: JSON.stringify([...factIds].sort()),
    labelingProfileVersion: version.labelingProfileVersion,
    doNotReuse: 0,
    nonPublishable: kind === "review" ? 1 : 0,
    manifestJson: JSON.stringify(built.manifest),
    filesJson: JSON.stringify(built.files),
    packageFingerprint: built.packageFingerprint,
    createdAt: now,
  };
  await dao.insertPackage(row);
  return { ok: true, row };
}

export async function exportConfirm(
  db: DatabaseConnection,
  ownerId: string,
  input: ExportConfirmInput,
  clock: Clock = () => new Date().toISOString(),
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const job = await dao.getExportJobByOperation(ownerId, input.brandId, input.operationId);
  if (!job) return denied("PREFLIGHT_REQUIRED");

  const chosen = input.chosenVersionIds;
  if (job.status === "ready") {
    const previous = parseIds(job.chosenSubsetJson);
    if ([...previous].sort().join() !== [...chosen].sort().join()) return denied("OPERATION_CONFLICT");
    const rows = await dao.getPackagesByIds(ownerId, input.brandId, parseIds(job.resultPackageIdsJson));
    return {
      jobId: job.id,
      operationId: job.operationId,
      status: "ready" as const,
      packages: rows.map(summarizePackage),
      replayed: true,
    };
  }

  const selection = JSON.parse(job.selectionJson) as ExportSelection;
  const stored = JSON.parse(job.preflightJson) as { eligibleVersionIds: string[] };
  const subset = validateExportSubset(selection.versionIds, stored.eligibleVersionIds, chosen);
  if (!subset.ok) {
    return denied("SUBSET_INVALID", undefined, subset.invalid.map((versionId) => ({ versionId, codes: [] })));
  }

  // Re-run the gates on the chosen subset: facts or approvals may have changed since preflight.
  const found = await dao.getContentVersionsByIds(ownerId, input.brandId, chosen);
  if (found.length !== chosen.length) return denied("NOT_FOUND");
  const byId = new Map(found.map((version) => [version.id, version]));
  const now = clock();
  const items = await computePreflight(
    db, ownerId, input.brandId, chosen.map((id) => byId.get(id)!), selection.mode, now,
  );
  const blocked = items.filter((item) => !item.eligible);
  if (blocked.length) {
    return denied(
      blocked[0].blockers[0],
      undefined,
      blocked.map((item) => ({ versionId: item.versionId, codes: item.blockers })),
    );
  }

  const created: PackageRow[] = [];
  let failure: ContentError | null = null;
  for (const item of items) {
    let result: AssembleResult;
    if (item.kind === "formal") {
      const version = byId.get(item.versionId)!;
      const gate = await withEligibleFacts(
        db,
        { ownerId, brandId: input.brandId },
        { factVersionIds: parseIds(version.factVersionIdsJson), contentVersionId: version.id, stage: "delivery" },
        (transaction) => assemblePackage(transaction, ownerId, input.brandId, version.id, "formal", now),
        () => new Date(now),
      );
      result = "error" in gate
        ? { ok: false, error: factFailure(gate).error }
        : gate.data;
    } else {
      result = await assemblePackage(db, ownerId, input.brandId, item.versionId, "review", now);
    }
    if (!result.ok) {
      failure = result.error;
      break;
    }
    created.push(result.row);
  }

  await dao.updateExportJob({
    id: job.id,
    status: failure ? "failed" : "ready",
    selectionJson: job.selectionJson,
    preflightJson: job.preflightJson,
    chosenSubsetJson: JSON.stringify(chosen),
    resultPackageIdsJson: JSON.stringify(created.map((row) => row.id)),
    error: failure,
    updatedAt: clock(),
  });
  if (failure) return denied(failure);
  return {
    jobId: job.id,
    operationId: job.operationId,
    status: "ready" as const,
    packages: created.map(summarizePackage),
    replayed: false,
  };
}

export async function readExportJob(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  operationId: string,
) {
  if (!await new BrandDao(db).owned(ownerId, brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const job = await dao.getExportJobByOperation(ownerId, brandId, operationId);
  if (!job) return denied("NOT_FOUND");
  const stored = JSON.parse(job.preflightJson) as { items: PreflightItem[]; eligibleVersionIds: string[] };
  const packages = await dao.getPackagesByIds(ownerId, brandId, parseIds(job.resultPackageIdsJson));
  return {
    job: { id: job.id, operationId: job.operationId, status: job.status, error: job.error },
    items: stored.items,
    eligibleVersionIds: stored.eligibleVersionIds,
    packages: packages.map(summarizePackage),
  };
}
