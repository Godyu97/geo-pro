import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import {
  fetchPublicPage,
  isPublicPageFetchEnabled,
  type PublicPageFetcher,
} from "../../lib/http/public-page-fetch.ts";
import { containsExecutableInstruction } from "../../lib/http/public-page-policy.ts";
import { delegatedOwnerId, openApprovalScope, rejectIfSeparated } from "../approval-policy/enforce.ts";
import { BrandDao } from "../brands/dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import type { BrandAccessAction } from "../team-access/rules.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { factGaps, factStatus } from "../brand-facts/rules.ts";
import { withEligibleFacts } from "../brand-facts/service.ts";
import { OptimizationDao } from "../optimization/dao.ts";
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
  type ApproveChannelVariantInput,
  type BlockChannelVariantInput,
  type ExportChannelVariantInput,
  type ExportConfirmInput,
  type ExportMode,
  type ExportPreflightInput,
  type SaveChannelVariantInput,
  type GenerateBatchInput,
  type MarkPublicationRemovedInput,
  type PackageKind,
  type PreflightBlockerCode,
  type RegisterAssetInput,
  type RejectContentInput,
  type SaveBriefDraftInput,
  type SubmitManualEvidenceInput,
  type SubmitPublicationInput,
  type SubmitReviewInput,
  type UpdateVariantInput,
  type VerifyPublicationInput,
} from "./contracts.ts";
import { ContentDao, type AssetRow, type BriefVersionRow, type ChannelVariantRow, type ContentVersionRow, type PackageRow, type PublicationRow, type UnitRow } from "./dao.ts";
import { ContentMaintenanceAbort, openLinkedPublicationMaintenance } from "./maintenance.ts";
import { ChannelProfileDao } from "../channel-variants/dao.ts";
import {
  channelVariantFingerprint,
  exceedsPinnedCharacterLimit,
  variantNeedsOwnApproval,
  variantRejection,
  type VariantRejectionCode,
} from "../channel-variants/rules.ts";
import {
  buildPackageFiles,
  computeApprovalFingerprint,
  inlinePackageFiles,
  packageContentType,
  packageSha256,
  packageUtf8,
  preflightBlockers,
  resealPackageManifest,
  resolveExportKind,
  storedPackageIndex,
  validateExportSubset,
  type PackageFact,
  type PackageFileDescriptor,
  type PackageFileName,
  type PackageStoredMedia,
  type StoredPackageIndex,
} from "./package.ts";
import { createObjectStorage } from "../../lib/storage/index.ts";
import { saveStoredObject, type ObjectStorageClient } from "../stored-objects/commands.ts";
import { CONTENT_TYPES, MAX_STORED_OBJECT_BYTES, sanitizeObjectFileName } from "../stored-objects/contracts.ts";
import { loadBrandObjectsByIds, markObjectFailed, type StoredObjectRow } from "../stored-objects/dao.ts";
import {
  buildClusterPlanViews,
  canCancel,
  canPause,
  canResume,
  canRetryFailed,
  contentBriefGaps,
  coverageFromCluster,
  deriveBatchStatus,
  fillDraftFromTemplate,
  type BriefGap,
} from "./rules.ts";
import {
  evaluateManualEvidence,
  evaluatePublicCheck,
  manualScreenshotSummary,
  nextEffectiveAt,
  type FixturePage,
} from "./verify.ts";

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

async function adoptOwner(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  action: BrandAccessAction,
  now = new Date().toISOString(),
) {
  const scope = await authorizeBrandActor(db, actorId, brandId, action, now);
  return scope?.ownerId ?? null;
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

function briefDisplayTitle(briefId: string, version: BriefVersionRow | null) {
  if (!version) return briefId;
  const titles = JSON.parse(version.titleCandidatesJson) as string[];
  return titles.find((item) => item.trim())?.trim() || version.targetGap.trim() || briefId;
}

async function ensureClusterPlan(
  dao: ContentDao,
  ownerId: string,
  brandId: string,
  questionCluster: string,
  now: string,
) {
  const existing = await dao.getPlanByCluster(ownerId, brandId, questionCluster);
  if (existing) return existing;
  const id = randomUUID();
  const coverageJson = JSON.stringify(coverageFromCluster({
    questionCluster,
    existingPages: [],
    pendingPages: [],
    gapPages: [],
  }));
  const row = {
    id,
    brandId,
    ownerId,
    questionCluster,
    coverageJson,
    createdAt: now,
    updatedAt: now,
  };
  await dao.insertPlan(row);
  return row;
}

async function syncClusterPlanCoverage(
  dao: ContentDao,
  ownerId: string,
  brandId: string,
  planId: string,
  now: string,
  ownedCitations?: Awaited<ReturnType<ContentDao["listOwnedPageCitations"]>>,
  publications?: Awaited<ReturnType<ContentDao["listClusterPublications"]>>,
) {
  const plan = await dao.getPlan(ownerId, brandId, planId);
  if (!plan) return;
  const planBriefs = await dao.listBriefsByPlan(ownerId, brandId, planId, 100);
  const versionsByBrief = await dao.latestBriefVersionsByBriefIds(
    brandId,
    planBriefs.map((item) => item.id),
  );
  const citations = ownedCitations ?? await dao.listOwnedPageCitations(ownerId, brandId, 200);
  const pubs = publications ?? await dao.listClusterPublications(ownerId, brandId, 200);
  const briefInputs = planBriefs.map((brief) => {
    const version = versionsByBrief.get(brief.id) ?? null;
    const gaps = version ? contentBriefGaps(parseFields(version)) : [];
    return {
      id: brief.id,
      planId: brief.planId,
      status: brief.status,
      title: briefDisplayTitle(brief.id, version),
      primaryPage: version?.primaryPage ?? "",
      gaps,
    };
  });
  const [view] = buildClusterPlanViews({
    plans: [{ ...plan, coverageJson: "{}" }],
    briefs: briefInputs,
    ownedCitations: citations,
    publications: pubs,
  });
  const coverage = coverageFromCluster({
    questionCluster: plan.questionCluster,
    existingPages: view ? view.existingPages.map((item) => item.url) : [],
    pendingPages: view ? view.plannedPages.map((item) => item.url) : [],
    gapPages: view ? view.gaps.map((item) => item.primaryPage || item.briefId) : [],
  });
  await dao.updatePlanCoverage(plan.id, JSON.stringify(coverage), now);
}

export async function saveBriefDraft(
  db: DatabaseConnection,
  ownerId: string,
  input: SaveBriefDraftInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const now = clock();
  return db.transaction(async (tx) => {
    const adopted = await adoptOwner(tx, ownerId, input.brandId, "write", now);
    if (!adopted) return denied("NOT_FOUND");
    const effectiveOwnerId = adopted;
    const brands = new BrandDao(tx);
    const brand = await brands.owned(effectiveOwnerId, input.brandId);
    if (!brand || brand.status !== "active") return denied("NOT_FOUND");

    const dao = new ContentDao(tx);
    let briefId = input.briefId;
    let planId = input.planId ?? null;
    let previousPlanId: string | null = null;

    if (briefId) {
      const brief = await dao.getBrief(effectiveOwnerId, input.brandId, briefId);
      if (!brief) return denied("NOT_FOUND");
      if (brief.status === "invalidated") return denied("INVALID_INPUT");
      previousPlanId = brief.planId;
      if (input.questionCluster) {
        const plan = await ensureClusterPlan(dao, effectiveOwnerId, input.brandId, input.questionCluster, now);
        planId = plan.id;
      } else {
        planId = planId ?? brief.planId;
      }
      const latest = await dao.latestBriefVersion(briefId);
      const revision = (latest?.revision ?? 0) + 1;
      const versionId = randomUUID();
      await dao.insertBriefVersion(
        versionFromFields(versionId, briefId, input.brandId, revision, input.fields, now, null),
      );
      if (planId !== brief.planId) {
        await dao.updateBriefPlanAndStatus(briefId, planId, "draft", now);
      } else {
        await dao.updateBriefStatus(briefId, "draft", now);
      }
      const planIdsToSync = [...new Set([previousPlanId, planId].filter((id): id is string => Boolean(id)))];
      if (planIdsToSync.length > 0) {
        const ownedCitations = await dao.listOwnedPageCitations(effectiveOwnerId, input.brandId, 200);
        const publications = await dao.listClusterPublications(effectiveOwnerId, input.brandId, 200);
        for (const syncId of planIdsToSync) {
          await syncClusterPlanCoverage(dao, effectiveOwnerId, input.brandId, syncId, now, ownedCitations, publications);
        }
      }
      return { briefId, versionId, planId, gaps: contentBriefGaps(input.fields) };
    }

    if (input.optimizationTaskId && !await new OptimizationDao(tx).getTask(effectiveOwnerId, input.brandId, input.optimizationTaskId)) {
      return denied("NOT_FOUND");
    }
    if (input.questionCluster) {
      const plan = await ensureClusterPlan(dao, effectiveOwnerId, input.brandId, input.questionCluster, now);
      planId = plan.id;
    }

    briefId = randomUUID();
    const versionId = randomUUID();
    await dao.insertBrief({
      id: briefId,
      brandId: input.brandId,
      ownerId: effectiveOwnerId,
      planId,
      optimizationTaskId: input.optimizationTaskId ?? null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await dao.insertBriefVersion(versionFromFields(versionId, briefId, input.brandId, 1, input.fields, now, null));
    if (planId) {
      await syncClusterPlanCoverage(dao, effectiveOwnerId, input.brandId, planId, now);
    }
    return { briefId, versionId, planId, gaps: contentBriefGaps(input.fields) };
  });
}

export async function confirmBrief(
  db: DatabaseConnection,
  ownerId: string,
  input: ConfirmBriefInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read");
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted.ownerId;
  const dao = new ContentDao(db);
  const plan = await dao.getPlan(ownerId, brandId, planId);
  if (!plan) return denied("NOT_FOUND");
  const [briefs, ownedCitations, publications] = await Promise.all([
    dao.listBriefsByPlan(ownerId, brandId, planId, 100),
    adopted.role === "read_only" ? [] : dao.listOwnedPageCitations(ownerId, brandId, 200),
    dao.listClusterPublications(ownerId, brandId, 200),
  ]);
  const versionsByBrief = await dao.latestBriefVersionsByBriefIds(
    brandId,
    briefs.map((item) => item.id),
  );
  const briefInputs = briefs.map((brief) => {
    const version = versionsByBrief.get(brief.id) ?? null;
    const gaps = version ? contentBriefGaps(parseFields(version)) : [];
    return {
      id: brief.id,
      planId: brief.planId,
      status: brief.status,
      title: briefDisplayTitle(brief.id, version),
      primaryPage: version?.primaryPage ?? "",
      gaps,
    };
  });
  const [clusterPlan] = buildClusterPlanViews({
    plans: [plan],
    briefs: briefInputs,
    ownedCitations,
    publications,
  });
  return { plan, clusterPlan };
}

export async function listBriefs(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  limit = 20,
  now = new Date().toISOString(),
) {
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read", now);
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted.ownerId;
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, brandId);
  if (!brand) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const [briefs, plans, ownedCitations, publications] = await Promise.all([
    dao.listBriefs(ownerId, brandId, limit),
    dao.listPlans(ownerId, brandId, limit),
    adopted.role === "read_only" ? [] : dao.listOwnedPageCitations(ownerId, brandId, 200),
    dao.listClusterPublications(ownerId, brandId, 200),
  ]);
  const versionsByBrief = await dao.latestBriefVersionsByBriefIds(
    brandId,
    briefs.map((brief) => brief.id),
  );
  const withVersions = briefs.map((brief) => {
    const version = versionsByBrief.get(brief.id) ?? null;
    const gaps: BriefGap[] = version ? contentBriefGaps(parseFields(version)) : [];
    return { brief, version, gaps };
  });
  const clusterPlans = buildClusterPlanViews({
    plans,
    briefs: withVersions.map(({ brief, version, gaps }) => ({
      id: brief.id,
      planId: brief.planId,
      status: brief.status,
      title: briefDisplayTitle(brief.id, version),
      primaryPage: version?.primaryPage ?? "",
      gaps,
    })),
    ownedCitations,
    publications,
  });
  return { briefs: withVersions, plans, clusterPlans };
}

/** List latest approved, gap-free brand facts available for content brief binding. */
export async function listApprovedBriefFacts(
  db: DatabaseConnection,
  actorId: string,
  brandId: string,
  now = new Date().toISOString(),
) {
  const adopted = await adoptOwner(db, actorId, brandId, "read", now);
  if (!adopted) return [] as Array<{ id: string; title: string; claim: string }>;
  const today = now.slice(0, 10);
  const versions = await new FactDao(db, { ownerId: adopted, brandId }).latestVersions();
  return versions
    .filter((fact) => factStatus(fact, today) === "approved" && factGaps(fact.fields, today).length === 0)
    .map((fact) => ({ id: fact.id, title: fact.fields.title, claim: fact.fields.claim }));
}

export async function readBatch(
  db: DatabaseConnection,
  ownerId: string,
  batchId: string,
) {
  const dao = new ContentDao(db);
  const identity = await dao.batchIdentity(batchId);
  if (!identity) return denied("NOT_FOUND");
  const adopted = await adoptOwner(db, ownerId, identity.brandId, "read");
  if (!adopted || adopted !== identity.ownerId) return denied("NOT_FOUND");
  ownerId = adopted;
  const batch = await dao.getBatchByIdForOwner(ownerId, batchId);
  if (!batch) return denied("NOT_FOUND");
  const units = await dao.listUnits(batch.id);
  return { batch, units };
}

export async function readContentVersion(
  db: DatabaseConnection,
  actorId: string,
  versionId: string,
) {
  const dao = new ContentDao(db);
  const identity = await dao.contentVersionIdentity(versionId);
  if (!identity) return denied("NOT_FOUND");
  let ownerId = actorId;
  if (identity.ownerId !== actorId) {
    const delegated = await delegatedOwnerId(db, actorId, identity.brandId, "content");
    const adopted = await adoptOwner(db, actorId, identity.brandId, "read");
    if (delegated && delegated === identity.ownerId) ownerId = identity.ownerId;
    else if (adopted && adopted === identity.ownerId) ownerId = adopted;
    else return denied("NOT_FOUND");
  }
  const version = await dao.getContentVersion(ownerId, versionId);
  if (!version || version.brandId !== identity.brandId) return denied("NOT_FOUND");
  // Frozen or foreign brands never expose approvals or package metadata.
  const brand = await new BrandDao(db).owned(ownerId, version.brandId);
  if (!brand) return denied("NOT_FOUND");
  const [approvals, packageRows, assets, publications, publicationPredecessors] = await Promise.all([
    dao.listApprovals(ownerId, version.id),
    dao.listPackagesForVersion(ownerId, version.id),
    dao.getAssetsByIds(ownerId, version.brandId, parseIds(version.imageAssetIdsJson)),
    dao.listPublicationsForVersion(ownerId, version.id),
    actorId === ownerId && brand.status === "active" && version.status === "approved"
      ? dao.listPublicationPredecessors(ownerId, version.brandId, 30)
      : [],
  ]);
  const currentFingerprint = versionFingerprint(version);
  return {
    version,
    approvals,
    packages: packageRows.map(summarizePackage),
    assets,
    publications,
    publicationPredecessors,
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
  const adopted = await adoptOwner(db, ownerId, brandId, "read");
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  options: ObjectCommandOptions = {},
) {
  const dao = new ContentDao(db);
  const identity = await dao.packageIdentity(packageId);
  if (!identity) return denied("NOT_FOUND");
  const adopted = await adoptOwner(db, ownerId, identity.brandId, "download");
  if (!adopted || adopted !== identity.ownerId) return denied("NOT_FOUND");
  ownerId = adopted;
  const row = await dao.getPackage(ownerId, packageId);
  if (!row) return denied("NOT_FOUND");
  if (!await new BrandDao(db).owned(ownerId, row.brandId)) return denied("NOT_FOUND");
  const parsed: unknown = JSON.parse(row.filesJson);
  const inline = inlinePackageFiles(parsed);
  if (inline) return { package: summarizePackage(row), files: inline };
  const index = storedPackageIndex(parsed);
  if (!index) return denied("NOT_FOUND");
  const loaded = await readStoredPackageFiles(db, ownerId, row.brandId, index, options);
  if (!loaded.ok) return denied(loaded.error);
  return { package: summarizePackage(row), files: loaded.files };
}

export async function readBriefDetail(
  db: DatabaseConnection,
  ownerId: string,
  briefId: string,
) {
  const dao = new ContentDao(db);
  const identity = await dao.briefIdentity(briefId);
  if (!identity) return denied("NOT_FOUND");
  const adopted = await adoptOwner(db, ownerId, identity.brandId, "read");
  if (!adopted || adopted !== identity.ownerId) return denied("NOT_FOUND");
  ownerId = adopted;
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

function claimsRecord(claimsJson: string): Record<string, string> {
  const parsed: unknown = JSON.parse(claimsJson);
  if (Array.isArray(parsed)) {
    const record: Record<string, string> = {};
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const text = "text" in item && typeof item.text === "string" ? item.text : "";
      const factVersionId = "factVersionId" in item && typeof item.factVersionId === "string"
        ? item.factVersionId
        : "";
      if (text.trim() && factVersionId) record[text] = factVersionId;
    }
    return record;
  }
  if (parsed && typeof parsed === "object") {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") record[key] = value;
    }
    return record;
  }
  return {};
}

function versionFingerprint(version: ContentVersionRow) {
  return computeApprovalFingerprint({
    title: version.title,
    bodyMarkdown: version.bodyMarkdown,
    claims: claimsRecord(version.claimsJson),
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

function catchMaintenance<T>(work: Promise<T>): Promise<T | Failure> {
  return work.catch((error: unknown) => {
    if (error instanceof ContentMaintenanceAbort) return denied(error.code);
    throw error;
  });
}

export async function submitReview(
  db: DatabaseConnection,
  ownerId: string,
  input: SubmitReviewInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const adopted = await adoptOwner(db, ownerId, input.brandId, "write", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
  actorId: string,
  input: ApproveContentInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const scope = await openApprovalScope(db, actorId, input.brandId, "content");
  if ("error" in scope) return denied(scope.error);
  const dao = new ContentDao(db);
  const version = scope.dual
    ? await dao.getContentVersionInBrand(input.brandId, input.versionId)
    : await ownedVersion(dao, actorId, input.brandId, input.versionId);
  if (!version || version.brandId !== input.brandId) return denied("NOT_FOUND");
  if (!scope.dual && version.ownerId !== actorId) return denied("NOT_FOUND");
  const now = clock();
  if (scope.dual && !scope.matchingDuty) {
    const rejected = await rejectIfSeparated(db, {
      scope, brandId: input.brandId, versionId: version.id, kind: "content",
      authorId: version.ownerId, actorId, now,
    });
    return denied(rejected.ok ? "DUTY" : rejected.error);
  }

  if (version.status === "approved") {
    const fingerprint = versionFingerprint(version);
    const approval = (await dao.listApprovals(version.ownerId, version.id))
      .find((item) => item.decision === "approved" && item.contentFingerprint === fingerprint);
    if (!approval) return denied("INVALID_INPUT");
    return { versionId: version.id, approvalId: approval.id, status: "approved" as const, replayed: true };
  }
  if (version.status !== "in_review") return denied("INVALID_INPUT");
  const separated = await rejectIfSeparated(db, {
    scope, brandId: input.brandId, versionId: version.id, kind: "content",
    authorId: version.ownerId, actorId, now,
  });
  if (!separated.ok) return denied(separated.error);
  const factVersionIds = parseIds(version.factVersionIdsJson);
  if (factVersionIds.length === 0) return denied("FACT_INVALID");

  // Facts are rechecked under the owner lock so a concurrent revoke cannot slip through.
  const gate = await withEligibleFacts(
    db,
    { ownerId: scope.brandOwnerId, brandId: input.brandId },
    { factVersionIds, contentVersionId: version.id, stage: "review" },
    async (transaction) => {
      const separatedNow = await rejectIfSeparated(transaction, {
        scope, brandId: input.brandId, versionId: version.id, kind: "content",
        authorId: version.ownerId, actorId, now,
      });
      if (!separatedNow.ok) return { outcome: "denied" as const, error: separatedNow.error };
      const txDao = new ContentDao(transaction);
      const current = await txDao.getContentVersion(version.ownerId, input.versionId);
      if (!current || current.brandId !== input.brandId || current.status !== "in_review") return null;
      const fingerprint = versionFingerprint(current);
      const approvalId = randomUUID();
      await txDao.insertApproval({
        id: approvalId,
        brandId: input.brandId,
        ownerId: current.ownerId,
        contentVersionId: current.id,
        contentFingerprint: fingerprint,
        factVersionIdsJson: current.factVersionIdsJson,
        decision: "approved",
        actorId,
        createdAt: now,
      });
      await txDao.updateContentVersionStatus(current.id, "approved", now);
      await txDao.markPackagesDoNotReuse(current.ownerId, current.id, fingerprint);
      return { outcome: "approved" as const, approvalId, fingerprint };
    },
    () => new Date(now),
  );
  if ("error" in gate) return factFailure(gate);
  if (!gate.data) return denied("INVALID_INPUT");
  if (gate.data.outcome === "denied") return denied(gate.data.error);
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

const deliverableImageTypes = new Set(CONTENT_TYPES["authorized-media"]);

export type AssetObjectFile = {
  fileName: string;
  contentType: string;
  body: Uint8Array;
};

export type ObjectCommandOptions = {
  env?: Record<string, string | undefined>;
  storage?: ObjectStorageClient;
  now?: Date;
  connection?: QueryConnection;
};

export type RegisterAssetOptions = ObjectCommandOptions & {
  file?: AssetObjectFile;
};

function assetFingerprint(input: RegisterAssetInput, storedObjectId: string | null) {
  const material = storedObjectId
    ? [input.kind, input.source, input.rightsStatement, input.visibility, input.contentRef, storedObjectId]
    : [input.kind, input.source, input.rightsStatement, input.visibility, input.contentRef];
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}

export async function registerAsset(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterAssetInput,
  clock: Clock = () => new Date().toISOString(),
  options: RegisterAssetOptions = {},
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const file = options.file;
  const internal = input.visibility === "internal";
  let storedObjectId: string | null = null;
  if (file) {
    if (!input.source.trim() || !input.rightsStatement.trim() || !input.kind.trim()) return denied("INVALID_INPUT");
    if (!sanitizeObjectFileName(file.fileName)) return denied("INVALID_INPUT");
    if (!(file.body instanceof Uint8Array) || file.body.byteLength < 1) return denied("INVALID_INPUT");
    if (file.body.byteLength > MAX_STORED_OBJECT_BYTES) return denied("ASSET_TOO_LARGE");
    if (!deliverableImageTypes.has(file.contentType)) return denied("ASSET_TYPE_REJECTED");
    const saved = await saveStoredObject(db, {
      actorId: ownerId,
      brandId: input.brandId,
      class: internal ? "internal-material" : "authorized-media",
      visibility: internal ? "internal" : "public",
      fileName: file.fileName,
      contentType: file.contentType,
      body: file.body,
    }, {
      ...(options.env ? { env: options.env } : {}),
      ...(options.storage ? { storage: options.storage } : {}),
      now: options.now ?? new Date(clock()),
    });
    if (!saved.ok) return denied(saved.code === "failed" ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT");
    storedObjectId = saved.id;
  }
  const asset: AssetRow = {
    id: randomUUID(),
    brandId: input.brandId,
    ownerId,
    kind: input.kind,
    source: input.source,
    rightsStatement: input.rightsStatement,
    visibility: internal ? "internal" : input.visibility,
    reviewStatus: input.reviewStatus,
    contentRef: input.contentRef,
    storedObjectId,
    fingerprint: assetFingerprint(input, storedObjectId),
    createdAt: clock(),
  };
  await new ContentDao(db).insertAsset(asset);
  return { asset };
}

function packageStoredMedia(row: StoredObjectRow | undefined): PackageStoredMedia | null {
  if (!row || !row.fileName) return null;
  return {
    id: row.id,
    class: row.class,
    visibility: row.visibility,
    status: row.status,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    fileName: row.fileName,
  };
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
  const adopted = await adoptOwner(db, ownerId, input.brandId, "download", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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

function storageCommandOptions(options: ObjectCommandOptions) {
  return {
    ...(options.env ? { env: options.env } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.connection ? { connection: options.connection } : {}),
  };
}

async function storeDeliveryFile(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  name: string,
  content: string,
  options: ObjectCommandOptions,
): Promise<{ ok: true; descriptor: PackageFileDescriptor } | { ok: false; error: ContentError }> {
  const contentType = packageContentType(name);
  const body = packageUtf8(content);
  if (!contentType || body.byteLength < 1 || body.byteLength > MAX_STORED_OBJECT_BYTES) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const fileName = name as PackageFileName;
  const saved = await saveStoredObject(db, {
    actorId: ownerId,
    brandId,
    class: "delivery-package",
    visibility: "internal",
    fileName,
    contentType,
    body,
  }, storageCommandOptions(options));
  if (!saved.ok) return { ok: false, error: saved.code === "failed" ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT" };
  if (saved.class !== "delivery-package"
    || saved.visibility !== "internal"
    || saved.fileName !== fileName
    || saved.contentType !== contentType
    || saved.byteSize !== body.byteLength
    || saved.sha256 !== packageSha256(body)) {
    return { ok: false, error: "SERVICE_UNAVAILABLE" };
  }
  return {
    ok: true,
    descriptor: {
      objectId: saved.id,
      name: fileName,
      contentType,
      byteSize: saved.byteSize,
      sha256: saved.sha256,
    },
  };
}

async function readStoredPackageFiles(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  index: StoredPackageIndex,
  options: ObjectCommandOptions,
): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: ContentError }> {
  const rows = await loadBrandObjectsByIds(db, ownerId, brandId, index.files.map((file) => file.objectId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const storage = options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
  const files: Record<string, string> = {};
  for (const file of index.files) {
    const row = byId.get(file.objectId);
    if (!row || row.status !== "ready" || row.class !== "delivery-package" || row.visibility !== "internal"
      || row.fileName !== file.name || row.contentType !== file.contentType
      || row.byteSize !== file.byteSize || row.sha256 !== file.sha256 || !row.objectKey) {
      return { ok: false, error: "NOT_FOUND" };
    }
    let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
    try {
      loaded = await storage.getObject({ key: row.objectKey });
    } catch {
      return { ok: false, error: "SERVICE_UNAVAILABLE" };
    }
    if (!loaded.ok) return { ok: false, error: "SERVICE_UNAVAILABLE" };
    if (loaded.sha256 !== file.sha256 || loaded.byteSize !== file.byteSize) {
      await storage.deleteObject({ key: row.objectKey });
      await db.transaction((tx) => markObjectFailed(tx, row.id, ownerId, "ready"));
      return { ok: false, error: "SERVICE_UNAVAILABLE" };
    }
    files[file.name] = new TextDecoder().decode(loaded.body);
  }
  return { ok: true, files };
}

type VariantPackageSource = {
  bodyMarkdown: string;
  targetChannel: string;
  approvalId: string;
};

async function assemblePackage(
  db: QueryConnection,
  objectDb: DatabaseConnection,
  ownerId: string,
  brandId: string,
  versionId: string,
  kind: PackageKind,
  now: string,
  options: ObjectCommandOptions,
  source?: VariantPackageSource,
): Promise<AssembleResult> {
  const dao = new ContentDao(db);
  const version = await ownedVersion(dao, ownerId, brandId, versionId);
  if (!version) return { ok: false, error: "NOT_FOUND" };
  const projected = source
    ? { ...version, bodyMarkdown: source.bodyMarkdown, targetChannel: source.targetChannel }
    : version;
  const fingerprint = versionFingerprint(projected);
  const approvals = await dao.listApprovalsForVersions(ownerId, [version.id]);
  const approval = source
    ? approvals.find((item) => item.id === source.approvalId && item.contentFingerprint === fingerprint) ?? null
    : approvals.find((item) => item.contentFingerprint === fingerprint) ?? null;
  if (kind === "formal") {
    if ((!source && version.status !== "approved") || !approval) return { ok: false, error: "APPROVAL_REQUIRED" };
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
  const ordered = assetIds.flatMap((id) => (assetById.has(id) ? [assetById.get(id)!] : []));
  const objectIds = [...new Set(ordered.flatMap((asset) => asset.storedObjectId ? [asset.storedObjectId] : []))];
  const storedRows = await loadBrandObjectsByIds(db, ownerId, brandId, objectIds);
  const storedById = new Map(storedRows.map((row) => [row.id, row]));
  const assets = ordered.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    rightsStatement: asset.rightsStatement,
    visibility: asset.visibility,
    reviewStatus: asset.reviewStatus,
    contentRef: asset.contentRef,
    fingerprint: asset.fingerprint,
    linkedObject: asset.storedObjectId !== null,
    stored: packageStoredMedia(asset.storedObjectId ? storedById.get(asset.storedObjectId) : undefined),
  }));

  const built = buildPackageFiles({
    kind,
    approvalId: approval?.id ?? null,
    contentFingerprint: fingerprint,
    version: {
      id: version.id,
      title: version.title,
      bodyMarkdown: projected.bodyMarkdown,
      targetChannel: projected.targetChannel,
      labelingProfileVersion: version.labelingProfileVersion,
      labelingProfileStatus: version.labelingProfileStatus,
      factVersionIds: factIds,
    },
    facts,
    assets,
  });
  const storedOptions = { ...options, now: options.now ?? new Date(now) };
  const descriptors: PackageFileDescriptor[] = [];
  for (const file of built.manifest.files) {
    const stored = await storeDeliveryFile(objectDb, ownerId, brandId, file.name, built.files[file.name], storedOptions);
    if (!stored.ok) return stored;
    descriptors.push(stored.descriptor);
  }
  const sealed = resealPackageManifest(built, descriptors);
  if (!sealed) return { ok: false, error: "SERVICE_UNAVAILABLE" };
  const manifestFile = await storeDeliveryFile(
    objectDb, ownerId, brandId, "manifest.json", sealed.files["manifest.json"], storedOptions,
  );
  if (!manifestFile.ok) return manifestFile;
  const row: PackageRow = {
    id: randomUUID(),
    brandId,
    ownerId,
    contentVersionId: version.id,
    approvalId: approval?.id ?? null,
    targetChannel: projected.targetChannel,
    kind,
    contentFingerprint: fingerprint,
    factVersionIdsJson: JSON.stringify([...factIds].sort()),
    labelingProfileVersion: version.labelingProfileVersion,
    doNotReuse: 0,
    nonPublishable: kind === "review" ? 1 : 0,
    manifestJson: JSON.stringify(sealed.manifest),
    filesJson: JSON.stringify({ version: 1, files: [...descriptors, manifestFile.descriptor] }),
    packageFingerprint: sealed.packageFingerprint,
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
  options: ObjectCommandOptions = {},
) {
  const adopted = await adoptOwner(db, ownerId, input.brandId, "download", clock());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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
        (transaction) => assemblePackage(
          transaction, db, ownerId, input.brandId, version.id, "formal", now, { ...options, connection: transaction },
        ),
        () => new Date(now),
      );
      result = "error" in gate
        ? { ok: false, error: factFailure(gate).error }
        : gate.data;
    } else {
      result = await assemblePackage(db, db, ownerId, input.brandId, item.versionId, "review", now, options);
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

export async function readContentAssetBytes(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; objectId: string },
  options: RegisterAssetOptions = {},
) {
  const adopted = await adoptOwner(db, ownerId, input.brandId, "download");
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const [object] = await loadBrandObjectsByIds(db, ownerId, input.brandId, [input.objectId]);
  if (!object || object.status !== "ready" || !object.objectKey || !object.fileName) return denied("NOT_FOUND");
  const asset = await new ContentDao(db).findAssetByObject(ownerId, input.brandId, object.id);
  if (!asset || asset.storedObjectId !== object.id) return denied("NOT_FOUND");
  if (object.class === "authorized-media" && asset.reviewStatus !== "approved") return denied("ASSET_UNREVIEWED");
  if (object.class === "authorized-media" && (object.visibility !== "public" || asset.visibility !== "public")) {
    return denied("NOT_FOUND");
  }
  if (object.class !== "authorized-media" && object.class !== "internal-material") return denied("NOT_FOUND");
  const storage = options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
  let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
  try {
    loaded = await storage.getObject({ key: object.objectKey });
  } catch {
    return denied("SERVICE_UNAVAILABLE");
  }
  if (!loaded.ok || loaded.sha256 !== object.sha256 || loaded.byteSize !== object.byteSize) return denied("SERVICE_UNAVAILABLE");
  return {
    id: object.id,
    contentType: object.contentType,
    byteSize: loaded.byteSize,
    sha256: loaded.sha256,
    fileName: object.fileName,
    body: loaded.body,
  };
}

export async function readExportJob(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  operationId: string,
) {
  const adopted = await adoptOwner(db, ownerId, brandId, "read");
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted;
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

function parseClaims(version: ContentVersionRow): string[] {
  const parsed: unknown = JSON.parse(version.claimsJson);
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    return parsed.map((item) => item.trim()).filter((claim) => claim.length > 0);
  }
  return Object.keys(claimsRecord(version.claimsJson))
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0);
}

const preservedOnFetchFailure = new Set([
  "draft_only",
  "access_limited",
  "verified_public",
  "verified_manual",
  "mismatch",
  "removed",
]);

async function observePublicationPage(
  fixture: FixturePage | undefined,
  pageUrl: string,
  fetchPage: PublicPageFetcher,
) {
  if (fixture) return { ok: true as const, source: "fixture" as const, fixture, robots: null };
  if (!isPublicPageFetchEnabled()) return { ok: false as const, code: "public_fetch_disabled" };
  try {
    const outcome = await fetchPage(pageUrl);
    if (!outcome.ok) return { ok: false as const, code: outcome.code };
    return {
      ok: true as const,
      source: "public_fetch" as const,
      robots: outcome.robots,
      fixture: {
        accessClass: outcome.accessClass,
        httpStatus: outcome.httpStatus,
        title: outcome.title,
        bodyText: outcome.bodyText,
      },
    };
  } catch {
    return { ok: false as const, code: "fetch_error" };
  }
}

async function eligiblePublicationPredecessor(
  dao: ContentDao,
  ownerId: string,
  predecessorId: string,
  target: Pick<PublicationRow, "brandId" | "targetAccount" | "pageUrl">,
) {
  const previous = await dao.getPublication(ownerId, predecessorId);
  return Boolean(previous?.effectiveAt && previous.supersededBy === null
    && previous.brandId === target.brandId && previous.targetAccount === target.targetAccount
    && previous.pageUrl === target.pageUrl);
}

async function publicationApprovalCurrent(dao: ContentDao, publication: PublicationRow, version: ContentVersionRow) {
  return versionFingerprint(version) === publication.contentFingerprint
    && await dao.hasPinnedPublicationApproval(publication);
}

async function applyPublicCheck(
  dao: ContentDao,
  db: TransactionConnection,
  publication: PublicationRow,
  version: ContentVersionRow,
  fixture: FixturePage | undefined,
  checkedAt: string,
  fetchPage: PublicPageFetcher,
) {
  const { id: publicationId, brandId, ownerId } = publication;
  const observed = await observePublicationPage(fixture, publication.pageUrl, fetchPage);
  const checkId = randomUUID();
  if (!observed.ok) {
    const keep = preservedOnFetchFailure.has(publication.status);
    const status = keep ? publication.status : "pending_check" as const;
    await dao.insertPublicationCheck({
      id: checkId,
      publicationId,
      brandId,
      ownerId,
      method: "public_fetch",
      resultStatus: "pending_check",
      evidenceJson: JSON.stringify({
        source: "public_fetch",
        reason: observed.code,
        matches: [],
        claimedPublishedAt: publication.claimedPublishedAt,
      }),
      actorId: ownerId,
      checkedAt,
      notes: observed.code,
    });
    if (!keep) {
      await dao.updatePublicationOutcome({
        id: publicationId,
        status,
        effectiveAt: publication.effectiveAt,
        evidenceGrade: publication.evidenceGrade,
        updatedAt: checkedAt,
      });
    }
    return {
      publicationId,
      checkId,
      status,
      effectiveAt: publication.effectiveAt,
      evidenceGrade: publication.evidenceGrade,
      claimedPublishedAt: publication.claimedPublishedAt,
      matches: [],
    };
  }

  const result = evaluatePublicCheck({
    fixture: observed.fixture,
    claims: parseClaims(version),
    alreadyHasEffectiveAt: Boolean(publication.effectiveAt),
  });
  const instructionMarked = containsExecutableInstruction(observed.fixture.bodyText);
  await dao.insertPublicationCheck({
    id: checkId,
    publicationId,
    brandId,
    ownerId,
    method: "public_fetch",
    resultStatus: result.status,
    evidenceJson: JSON.stringify({
      source: observed.source,
      fixture: observed.source === "fixture" ? observed.fixture : {
        accessClass: observed.fixture.accessClass,
        httpStatus: observed.fixture.httpStatus,
        title: observed.fixture.title,
        bodyExcerpt: observed.fixture.bodyText.slice(0, 500),
      },
      robots: observed.robots,
      matches: result.matches,
      reason: result.reason,
      containsExecutableInstructions: instructionMarked,
      claimedPublishedAt: publication.claimedPublishedAt,
    }),
    actorId: ownerId,
    checkedAt,
    notes: instructionMarked ? `${result.reason}; instruction_marked` : result.reason,
  });
  const effectiveAt = nextEffectiveAt(publication.effectiveAt, result.setsEffectiveAt, checkedAt);
  const evidenceGrade = result.evidenceGrade ?? publication.evidenceGrade;
  await dao.updatePublicationOutcome({
    id: publicationId,
    status: result.status,
    effectiveAt,
    evidenceGrade,
    updatedAt: checkedAt,
  });
  if (result.setsEffectiveAt && publication.predecessorId) {
    await dao.markPublicationSuperseded(publication, publication.predecessorId, checkedAt);
  }
  if (result.status === "mismatch") {
    await dao.insertPublicationAction({
      id: randomUUID(),
      publicationId,
      brandId,
      ownerId,
      kind: "repair_mismatch",
      status: "open",
      reason: "Public page facts diverge from the approved version.",
      createdAt: checkedAt,
      updatedAt: checkedAt,
    });
  }
  if (result.status === "mismatch" || result.status === "removed") {
    await openLinkedPublicationMaintenance(db, ownerId, brandId, version.id, result.status, checkedAt);
  }
  return {
    publicationId,
    checkId,
    status: result.status,
    effectiveAt,
    evidenceGrade,
    claimedPublishedAt: publication.claimedPublishedAt,
    matches: result.matches,
  };
}

export async function submitPublication(
  db: DatabaseConnection,
  ownerId: string,
  input: SubmitPublicationInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return catchMaintenance(locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const existing = await dao.getPublicationByOperation(ownerId, input.brandId, input.operationId);
    const predecessorId = input.predecessorId ?? null;
    if (existing) {
      if (existing.predecessorId !== predecessorId) return denied("OPERATION_CONFLICT");
      return {
        publicationId: existing.id,
        status: existing.status,
        effectiveAt: existing.effectiveAt,
        evidenceGrade: existing.evidenceGrade,
        claimedPublishedAt: existing.claimedPublishedAt,
        replayed: true,
      };
    }

    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    if (version.status !== "approved") return denied("APPROVAL_REQUIRED");

    const fingerprint = versionFingerprint(version);
    const approval = (await dao.listApprovals(ownerId, version.id))
      .find((item) => item.decision === "approved" && item.contentFingerprint === fingerprint);
    if (!approval) return denied("APPROVAL_INVALID");
    if (predecessorId && !await eligiblePublicationPredecessor(dao, ownerId, predecessorId, input)) {
      return denied("PUBLICATION_PREDECESSOR_CONFLICT");
    }

    const now = clock();
    const publicationId = randomUUID();
    const publication: PublicationRow = {
      id: publicationId,
      brandId: input.brandId,
      ownerId,
      contentVersionId: version.id,
      approvalId: approval.id,
      contentFingerprint: fingerprint,
      targetAccount: input.targetAccount,
      pageUrl: input.pageUrl,
      publisherId: input.publisherId,
      claimedPublishedAt: input.claimedPublishedAt,
      channelDeclaration: input.channelDeclaration,
      status: input.fixturePage ? "pending_check" : "submitted",
      effectiveAt: null,
      evidenceGrade: null,
      supersededBy: null,
      predecessorId,
      operationId: input.operationId,
      createdAt: now,
      updatedAt: now,
    };
    await dao.insertPublication(publication);

    if (!input.fixturePage) {
      return {
        publicationId,
        status: "submitted" as const,
        effectiveAt: null,
        evidenceGrade: null,
        claimedPublishedAt: input.claimedPublishedAt,
        replayed: false,
      };
    }

    const checked = await applyPublicCheck(
      dao, transaction, publication, version, input.fixturePage, now, fetchPublicPage,
    );
    return { ...checked, replayed: false };
  }));
}

export async function verifyPublication(
  db: DatabaseConnection,
  ownerId: string,
  input: VerifyPublicationInput,
  clock: Clock = () => new Date().toISOString(),
  fetchPage: PublicPageFetcher = fetchPublicPage,
) {
  return catchMaintenance(locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const publication = await dao.getPublication(ownerId, input.publicationId);
    if (!publication || publication.brandId !== input.brandId) return denied("NOT_FOUND");

    const version = await ownedVersion(dao, ownerId, input.brandId, publication.contentVersionId);
    if (!version) return denied("NOT_FOUND");
    if (version.status !== "approved") return denied("APPROVAL_REQUIRED");
    if (!await publicationApprovalCurrent(dao, publication, version)) return denied("APPROVAL_INVALID");
    if (!publication.effectiveAt && publication.predecessorId
      && !await eligiblePublicationPredecessor(dao, ownerId, publication.predecessorId, publication)) {
      return denied("PUBLICATION_PREDECESSOR_CONFLICT");
    }

    const checked = await applyPublicCheck(
      dao, transaction, publication, version, input.fixturePage, clock(), fetchPage,
    );
    return { ...checked, replayed: false };
  }));
}

const evidenceImageTypes = new Set(CONTENT_TYPES["publication-evidence"]);

export type ManualEvidenceOptions = ObjectCommandOptions & {
  file?: AssetObjectFile;
};

export async function submitManualEvidence(
  db: DatabaseConnection,
  actorId: string,
  input: SubmitManualEvidenceInput,
  clock: Clock = () => new Date().toISOString(),
  options: ManualEvidenceOptions = {},
) {
  const scope = await openApprovalScope(db, actorId, input.brandId, "content");
  if ("error" in scope) return denied(scope.error);
  const ownerId = scope.brandOwnerId;
  return catchMaintenance(db.transaction(async (transaction) => {
    if (!await new BrandDao(transaction).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const publication = await dao.getPublication(ownerId, input.publicationId);
    if (!publication || publication.brandId !== input.brandId) return denied("NOT_FOUND");

    // Manual evidence is for restricted pages; refuse if already publicly verified.
    if (publication.status === "verified_public") return denied("PUBLICATION_CONFLICT");

    const version = await ownedVersion(dao, ownerId, input.brandId, publication.contentVersionId);
    if (!version) return denied("NOT_FOUND");
    if (version.status !== "approved") return denied("APPROVAL_REQUIRED");
    if (!await publicationApprovalCurrent(dao, publication, version)) return denied("APPROVAL_INVALID");
    if (!publication.effectiveAt && publication.predecessorId
      && !await eligiblePublicationPredecessor(dao, ownerId, publication.predecessorId, publication)) {
      return denied("PUBLICATION_PREDECESSOR_CONFLICT");
    }

    const now = clock();
    const separated = await rejectIfSeparated(transaction, {
      scope,
      brandId: input.brandId,
      versionId: publication.id,
      kind: "content",
      authorId: publication.publisherId,
      actorId,
      now,
    });
    if (!separated.ok) return denied(separated.error);

    const file = options.file;
    const fileName = file ? sanitizeObjectFileName(file.fileName) : undefined;
    if (file) {
      if (!fileName) return denied("INVALID_INPUT");
      if (!(file.body instanceof Uint8Array) || file.body.byteLength < 1) return denied("INVALID_INPUT");
      if (file.body.byteLength > MAX_STORED_OBJECT_BYTES) return denied("EVIDENCE_TOO_LARGE");
      if (!evidenceImageTypes.has(file.contentType)) return denied("EVIDENCE_TYPE_REJECTED");
    }

    const result = evaluateManualEvidence({
      evidence: {
        screenshotRef: fileName ?? input.screenshotRef,
        pageMarker: input.pageMarker,
        observedAt: input.observedAt,
        bodyExcerpt: input.bodyExcerpt,
        reviewerNote: input.reviewerNote,
      },
      claims: parseClaims(version),
      alreadyHasEffectiveAt: Boolean(publication.effectiveAt),
    });
    if (result.reason === "incomplete_evidence") return denied("EVIDENCE_REQUIRED");

    let screenshot: {
      objectId: string;
      fileName: string;
      contentType: string;
      byteSize: number;
      sha256: string;
    } | null = null;
    if (file && fileName) {
      const saved = await saveStoredObject(db, {
        actorId: ownerId,
        brandId: input.brandId,
        class: "publication-evidence",
        visibility: "internal",
        fileName,
        contentType: file.contentType,
        body: file.body,
      }, {
        ...storageCommandOptions(options),
        connection: transaction,
      });
      const digest = createHash("sha256").update(file.body).digest("hex");
      if (!saved.ok) return denied(saved.code === "failed" ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT");
      if (saved.class !== "publication-evidence"
        || saved.visibility !== "internal"
        || saved.fileName !== fileName
        || saved.contentType !== file.contentType
        || saved.byteSize !== file.body.byteLength
        || saved.sha256 !== digest) {
        await markObjectFailed(transaction, saved.id, ownerId, "ready");
        return denied("SERVICE_UNAVAILABLE");
      }
      screenshot = {
        objectId: saved.id,
        fileName: saved.fileName,
        contentType: saved.contentType,
        byteSize: saved.byteSize,
        sha256: saved.sha256,
      };
    }

    const screenshotRef = screenshot?.objectId ?? input.screenshotRef;
    const checkId = randomUUID();
    await dao.insertPublicationCheck({
      id: checkId,
      publicationId: publication.id,
      brandId: input.brandId,
      ownerId,
      method: "manual_evidence",
      resultStatus: result.status,
      evidenceJson: JSON.stringify({
        screenshotRef,
        ...(screenshot ? {
          screenshotObjectId: screenshot.objectId,
          fileName: screenshot.fileName,
          contentType: screenshot.contentType,
          byteSize: screenshot.byteSize,
          sha256: screenshot.sha256,
        } : {}),
        pageMarker: input.pageMarker,
        observedAt: input.observedAt,
        bodyExcerpt: input.bodyExcerpt,
        reviewerNote: input.reviewerNote ?? null,
        matches: result.matches,
        reason: result.reason,
        claimedPublishedAt: publication.claimedPublishedAt,
        evidenceGrade: result.evidenceGrade,
      }),
      actorId,
      checkedAt: now,
      notes: result.reason,
    });

    const effectiveAt = nextEffectiveAt(publication.effectiveAt, result.setsEffectiveAt, now);
    await dao.updatePublicationOutcome({
      id: publication.id,
      status: result.status,
      effectiveAt,
      evidenceGrade: result.evidenceGrade,
      updatedAt: now,
    });
    if (result.setsEffectiveAt && publication.predecessorId) {
      await dao.markPublicationSuperseded(publication, publication.predecessorId, now);
    }
    if (result.status === "mismatch") {
      await dao.insertPublicationAction({
        id: randomUUID(),
        publicationId: publication.id,
        brandId: input.brandId,
        ownerId,
        kind: "repair_mismatch",
        status: "open",
        reason: "Manual evidence does not match approved claims.",
        createdAt: now,
        updatedAt: now,
      });
      await openLinkedPublicationMaintenance(
        transaction, ownerId, input.brandId, publication.contentVersionId, "mismatch", now,
      );
    }
    return {
      publicationId: publication.id,
      checkId,
      status: result.status,
      effectiveAt,
      evidenceGrade: result.evidenceGrade,
      claimedPublishedAt: publication.claimedPublishedAt,
      matches: result.matches,
      replayed: false,
      ...(screenshot ? { screenshot } : {}),
    };
  }));
}

export async function readPublicationEvidence(
  db: DatabaseConnection,
  ownerId: string,
  publicationId: string,
  objectId: string,
  options: ObjectCommandOptions = {},
) {
  const dao = new ContentDao(db);
  const publication = await dao.getPublication(ownerId, publicationId);
  if (!publication) return denied("NOT_FOUND");
  if (!await activeBrand(db, ownerId, publication.brandId)) return denied("NOT_FOUND");
  const checks = await dao.listPublicationChecks(ownerId, publication.id);
  const linked = checks
    .map((check) => manualScreenshotSummary(check.evidenceJson))
    .find((item) => item?.objectId === objectId);
  if (!linked) return denied("NOT_FOUND");
  const [object] = await loadBrandObjectsByIds(db, ownerId, publication.brandId, [objectId]);
  if (!object || object.status !== "ready" || !object.objectKey || !object.fileName) return denied("NOT_FOUND");
  if (object.class !== "publication-evidence" || object.visibility !== "internal" || object.immutable !== 1) {
    return denied("NOT_FOUND");
  }
  if (object.fileName !== linked.fileName || object.contentType !== linked.contentType
    || object.byteSize !== linked.byteSize || object.sha256 !== linked.sha256) {
    return denied("NOT_FOUND");
  }
  const storage = options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
  let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
  try {
    loaded = await storage.getObject({ key: object.objectKey });
  } catch {
    return denied("SERVICE_UNAVAILABLE");
  }
  if (!loaded.ok) return denied("SERVICE_UNAVAILABLE");
  if (loaded.sha256 !== object.sha256 || loaded.byteSize !== object.byteSize) {
    await storage.deleteObject({ key: object.objectKey });
    await db.transaction((tx) => markObjectFailed(tx, object.id, ownerId, "ready"));
    return denied("SERVICE_UNAVAILABLE");
  }
  return {
    objectId: object.id,
    fileName: object.fileName,
    contentType: object.contentType,
    byteSize: loaded.byteSize,
    sha256: loaded.sha256,
    body: loaded.body,
    evidenceGrade: "manual",
  };
}

export async function markPublicationRemoved(
  db: DatabaseConnection,
  ownerId: string,
  input: MarkPublicationRemovedInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return catchMaintenance(locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const publication = await dao.getPublication(ownerId, input.publicationId);
    if (!publication || publication.brandId !== input.brandId) return denied("NOT_FOUND");
    const now = clock();
    await dao.insertPublicationCheck({
      id: randomUUID(),
      publicationId: publication.id,
      brandId: input.brandId,
      ownerId,
      method: "public_fetch",
      resultStatus: "removed",
      evidenceJson: JSON.stringify({ reason: input.reason, claimedPublishedAt: publication.claimedPublishedAt }),
      actorId: ownerId,
      checkedAt: now,
      notes: input.reason,
    });
    await dao.updatePublicationOutcome({
      id: publication.id,
      status: "removed",
      effectiveAt: publication.effectiveAt,
      evidenceGrade: publication.evidenceGrade,
      updatedAt: now,
    });
    await dao.insertPublicationAction({
      id: randomUUID(),
      publicationId: publication.id,
      brandId: input.brandId,
      ownerId,
      kind: "confirm_removal",
      status: "open",
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
    });
    await openLinkedPublicationMaintenance(
      transaction, ownerId, input.brandId, publication.contentVersionId, "removed", now,
    );
    return {
      publicationId: publication.id,
      status: "removed" as const,
      effectiveAt: publication.effectiveAt,
      replayed: false,
    };
  }));
}

export async function readPublication(
  db: DatabaseConnection,
  actorId: string,
  publicationId: string,
) {
  const dao = new ContentDao(db);
  const owned = await dao.getPublication(actorId, publicationId);
  const publication = owned ?? await dao.getPublicationById(publicationId);
  if (!publication) return denied("NOT_FOUND");
  let ownerId = actorId;
  if (!owned) {
    const delegated = await delegatedOwnerId(db, actorId, publication.brandId, "content");
    if (!delegated || delegated !== publication.ownerId) return denied("NOT_FOUND");
    ownerId = publication.ownerId;
  }
  const brand = await new BrandDao(db).owned(ownerId, publication.brandId);
  if (!brand) return denied("NOT_FOUND");
  const [checks, actions, version] = await Promise.all([
    dao.listPublicationChecks(ownerId, publication.id),
    dao.listPublicationActions(ownerId, publication.id),
    dao.getContentVersion(ownerId, publication.contentVersionId),
  ]);
  if (!version) return denied("NOT_FOUND");
  return {
    publication,
    checks,
    actions,
    version: { id: version.id, title: version.title, status: version.status },
    readOnly: brand.status !== "active",
  };
}

function asChannelVariant(row: ChannelVariantRow) {
  return {
    id: row.id,
    channel: row.channel,
    approved: row.approvalStatus === "approved",
    body: row.bodyMarkdown,
  };
}

function presentChannelVariant(row: ChannelVariantRow, version: ContentVersionRow) {
  const variant = asChannelVariant(row);
  const masterApproved = version.status === "approved";
  const rejection: VariantRejectionCode | null = variantRejection({
    masterApproved,
    variant,
    masterBody: version.bodyMarkdown,
    blocked: row.blocked === 1,
  });
  return {
    id: row.id,
    brandId: row.brandId,
    contentVersionId: row.contentVersionId,
    channel: row.channel,
    bodyMarkdown: row.bodyMarkdown,
    approvalStatus: row.approvalStatus,
    approvalId: row.approvalId,
    needsOwnApproval: row.needsOwnApproval === 1,
    blocked: row.blocked === 1,
    rejection,
    fingerprint: row.fingerprint,
    channelProfileVersionId: row.channelProfileVersionId,
    profileVersionNumber: row.profileVersionNumber,
    profileMaxCharacters: row.profileMaxCharacters,
    profileChannelKey: row.profileChannelKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function profileLimitExceeded(row: ChannelVariantRow) {
  if (row.channelProfileVersionId && row.profileVersionNumber == null) return denied("NOT_FOUND");
  if (exceedsPinnedCharacterLimit(row.bodyMarkdown, row.profileMaxCharacters)) return denied("PROFILE_LIMIT_EXCEEDED");
  return null;
}

export async function readChannelVariants(
  db: DatabaseConnection,
  ownerId: string,
  versionId: string,
) {
  const dao = new ContentDao(db);
  const version = await dao.getContentVersion(ownerId, versionId);
  if (!version) return denied("NOT_FOUND");
  const brand = await new BrandDao(db).owned(ownerId, version.brandId);
  if (!brand) return denied("NOT_FOUND");
  const rows = await dao.listChannelVariants(ownerId, version.id);
  return {
    version: {
      id: version.id,
      brandId: version.brandId,
      title: version.title,
      bodyMarkdown: version.bodyMarkdown,
      status: version.status,
      targetChannel: version.targetChannel,
    },
    variants: rows.map((row) => presentChannelVariant(row, version)),
    readOnly: brand.status !== "active",
  };
}

export async function readChannelVariant(
  db: DatabaseConnection,
  ownerId: string,
  variantId: string,
) {
  const dao = new ContentDao(db);
  const row = await dao.getChannelVariant(ownerId, variantId);
  if (!row) return denied("NOT_FOUND");
  const version = await dao.getContentVersion(ownerId, row.contentVersionId);
  if (!version || version.brandId !== row.brandId) return denied("NOT_FOUND");
  const brand = await new BrandDao(db).owned(ownerId, row.brandId);
  if (!brand) return denied("NOT_FOUND");
  return { variant: presentChannelVariant(row, version), readOnly: brand.status !== "active" };
}

export async function saveChannelVariant(
  db: DatabaseConnection,
  ownerId: string,
  input: SaveChannelVariantInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    const now = clock();
    const existing = await dao.getChannelVariantForVersion(ownerId, version.id, input.channel);
    const profiles = new ChannelProfileDao(transaction);
    let pinnedId: string | null = existing?.channelProfileVersionId ?? null;
    let pinnedNumber = existing?.profileVersionNumber ?? null;
    let pinnedMax = existing?.profileMaxCharacters ?? null;
    let pinnedKey = existing?.profileChannelKey ?? null;
    if (!existing) {
      if (!input.profileVersionId) return denied("PROFILE_VERSION_REQUIRED");
      const pin = await profiles.getVersion(ownerId, input.profileVersionId);
      if (!pin || pin.brandId !== input.brandId) return denied("NOT_FOUND");
      if (pin.channelKey !== input.channel) return denied("PROFILE_VERSION_REQUIRED");
      pinnedId = pin.id;
      pinnedNumber = pin.versionNumber;
      pinnedMax = pin.maxCharacters;
      pinnedKey = pin.channelKey;
    } else if (input.profileVersionId && input.profileVersionId !== existing.channelProfileVersionId) {
      return denied("PROFILE_PIN_LOCKED");
    }
    const bodyChanged = !existing || existing.bodyMarkdown !== input.bodyMarkdown;
    const approvalStatus = bodyChanged || !existing ? "draft" as const : existing.approvalStatus;
    const approvalId = bodyChanged || !existing ? null : existing.approvalId;
    const needs = variantNeedsOwnApproval(version.status === "approved", {
      id: existing?.id ?? version.id,
      channel: input.channel,
      approved: approvalStatus === "approved",
      body: input.bodyMarkdown,
    }, version.bodyMarkdown);
    const fingerprint = channelVariantFingerprint(input.channel, input.bodyMarkdown);
    const needsFlag = needs ? 1 : 0;
    if (!existing) {
      const row: ChannelVariantRow = {
        id: randomUUID(),
        brandId: input.brandId,
        ownerId,
        contentVersionId: version.id,
        channel: input.channel,
        bodyMarkdown: input.bodyMarkdown,
        approvalStatus,
        approvalId,
        needsOwnApproval: needsFlag,
        blocked: 0,
        fingerprint,
        channelProfileVersionId: pinnedId,
        profileVersionNumber: pinnedNumber,
        profileMaxCharacters: pinnedMax,
        profileChannelKey: pinnedKey,
        createdAt: now,
        updatedAt: now,
      };
      await dao.insertChannelVariant(row);
      return { variant: presentChannelVariant(row, version), replayed: false };
    }
    if (!bodyChanged && existing.needsOwnApproval === needsFlag && existing.fingerprint === fingerprint) {
      return { variant: presentChannelVariant(existing, version), replayed: true };
    }
    const next: ChannelVariantRow = {
      ...existing,
      bodyMarkdown: input.bodyMarkdown,
      approvalStatus,
      approvalId,
      needsOwnApproval: needsFlag,
      fingerprint,
      updatedAt: now,
    };
    await dao.updateChannelVariantBody(next);
    return { variant: presentChannelVariant(next, version), replayed: false };
  });
}

export async function approveChannelVariant(
  db: DatabaseConnection,
  ownerId: string,
  input: ApproveChannelVariantInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    const variant = await dao.getChannelVariantForVersion(ownerId, version.id, input.channel);
    if (!variant) return denied("NOT_FOUND");
    const projected = { ...version, bodyMarkdown: variant.bodyMarkdown, targetChannel: variant.channel };
    const contentFingerprint = versionFingerprint(projected);
    const now = clock();
    if (variant.approvalStatus === "approved" && variant.approvalId) {
      const own = (await dao.listApprovals(ownerId, version.id)).find((item) =>
        item.id === variant.approvalId
        && item.decision === "approved"
        && item.contentFingerprint === contentFingerprint);
      if (own) return { variant: presentChannelVariant(variant, version), approvalId: own.id, replayed: true };
    }
    const approvalId = randomUUID();
    await dao.insertApproval({
      id: approvalId,
      brandId: input.brandId,
      ownerId,
      contentVersionId: version.id,
      contentFingerprint,
      factVersionIdsJson: version.factVersionIdsJson,
      decision: "approved",
      actorId: ownerId,
      createdAt: now,
    });
    const needs = variantNeedsOwnApproval(version.status === "approved", {
      id: variant.id,
      channel: variant.channel,
      approved: true,
      body: variant.bodyMarkdown,
    }, version.bodyMarkdown);
    const next: ChannelVariantRow = {
      ...variant,
      approvalStatus: "approved",
      approvalId,
      needsOwnApproval: needs ? 1 : 0,
      updatedAt: now,
    };
    await dao.updateChannelVariantApproval(next);
    return { variant: presentChannelVariant(next, version), approvalId, replayed: false };
  });
}

export async function blockChannelVariant(
  db: DatabaseConnection,
  ownerId: string,
  input: BlockChannelVariantInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return locked(db, ownerId, async (transaction) => {
    if (!await activeBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const dao = new ContentDao(transaction);
    const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
    if (!version) return denied("NOT_FOUND");
    const variant = await dao.getChannelVariantForVersion(ownerId, version.id, input.channel);
    if (!variant) return denied("NOT_FOUND");
    if (variant.blocked === 1) return { variant: presentChannelVariant(variant, version), replayed: true };
    const now = clock();
    await dao.blockChannelVariant(ownerId, variant.id, now);
    const next: ChannelVariantRow = { ...variant, blocked: 1, updatedAt: now };
    return { variant: presentChannelVariant(next, version), replayed: false };
  });
}

export async function exportChannelVariant(
  db: DatabaseConnection,
  ownerId: string,
  input: ExportChannelVariantInput,
  clock: Clock = () => new Date().toISOString(),
  options: ObjectCommandOptions = {},
) {
  if (!await activeBrand(db, ownerId, input.brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const version = await ownedVersion(dao, ownerId, input.brandId, input.versionId);
  if (!version) return denied("NOT_FOUND");
  const variant = await dao.getChannelVariantForVersion(ownerId, version.id, input.channel);
  if (!variant) return denied("NOT_FOUND");
  const limited = profileLimitExceeded(variant);
  if (limited) return limited;
  if (variant.blocked === 1) return denied("VARIANT_CHANNEL_BLOCKED");
  const gateVariant = asChannelVariant(variant);
  if (variantNeedsOwnApproval(version.status === "approved", gateVariant, version.bodyMarkdown) || !variant.approvalId) {
    return denied("VARIANT_REAPPROVAL_REQUIRED");
  }

  const now = clock();
  const gate = await withEligibleFacts(
    db,
    { ownerId, brandId: input.brandId },
    { factVersionIds: parseIds(version.factVersionIdsJson), contentVersionId: version.id, stage: "delivery" },
    async (transaction) => {
      const txDao = new ContentDao(transaction);
      const currentVersion = await ownedVersion(txDao, ownerId, input.brandId, input.versionId);
      const current = currentVersion
        ? await txDao.getChannelVariantForVersion(ownerId, currentVersion.id, input.channel)
        : null;
      if (!currentVersion || !current || !current.approvalId) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      if (current.channelProfileVersionId && current.profileVersionNumber == null) {
        return { ok: false as const, error: "NOT_FOUND" as const };
      }
      if (exceedsPinnedCharacterLimit(current.bodyMarkdown, current.profileMaxCharacters)) {
        return { ok: false as const, error: "PROFILE_LIMIT_EXCEEDED" as const };
      }
      if (current.blocked === 1) return { ok: false as const, error: "VARIANT_CHANNEL_BLOCKED" as const };
      if (variantNeedsOwnApproval(currentVersion.status === "approved", asChannelVariant(current), currentVersion.bodyMarkdown)) {
        return { ok: false as const, error: "VARIANT_REAPPROVAL_REQUIRED" as const };
      }
      return assemblePackage(
        transaction,
        db,
        ownerId,
        input.brandId,
        currentVersion.id,
        "formal",
        now,
        { ...options, connection: transaction },
        {
          bodyMarkdown: current.bodyMarkdown,
          targetChannel: current.channel,
          approvalId: current.approvalId,
        },
      );
    },
    () => new Date(now),
  );
  if ("error" in gate) return factFailure(gate);
  if (!gate.data.ok) return denied(gate.data.error);
  return {
    package: summarizePackage(gate.data.row),
    approvalId: gate.data.row.approvalId,
    replayed: false,
  };
}
