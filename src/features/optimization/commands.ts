import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { queryWithParameters } from "../../lib/db/connection.ts";
import {
  fetchPublicPage,
  isPublicPageFetchEnabled,
  type PublicPageFetcher,
  type PublicPageFetchOutcome,
} from "../../lib/http/public-page-fetch.ts";
import { invalidateEvidenceOverview } from "../evidence/overview-cache.ts";
import { BrandDao } from "../brands/dao.ts";
import { readObservation } from "../evidence/commands.ts";
import type {
  CheckPagesInput,
  GenerateFromEvidenceInput,
  OptimizationError,
  UpdateTaskInput,
} from "./contracts.ts";
import { OptimizationDao } from "./dao.ts";
import {
  assertsNoCausalClaim,
  compareTaskPriority,
  diagnoseFromEvidence,
  inspectPage,
  normalizeQuestionCluster,
  normalizeTargetPage,
  priorityBucketOf,
  type FindingDraft,
  type PageFetchResult,
} from "./rules.ts";

type Clock = () => string;
type Failure = { error: OptimizationError };

function denied(error: OptimizationError): Failure {
  return { error };
}

async function brandNameOf(db: DatabaseConnection, ownerId: string, brandId: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT v.name
     FROM brand b
     JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
     WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`,
    [ownerId, brandId],
  );
  if (!row) return null;
  return z.object({ name: z.string() }).parse(row).name;
}

async function upsertDrafts(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  drafts: FindingDraft[],
  now: string,
  cache?: CacheStore,
) {
  const created: Array<{ taskId: string; findingId: string; merged: boolean; title: string }> = [];
  await db.transaction(async (tx) => {
    const txDao = new OptimizationDao(tx);
    for (const draft of drafts) {
      const findingId = randomUUID();
      await txDao.insertFinding({
        id: findingId,
        brandId,
        ownerId,
        gapType: draft.gapType,
        questionCluster: draft.questionCluster,
        targetPage: draft.targetPage,
        observationId: draft.observationId,
        analysisVersionId: draft.analysisVersionId,
        evidenceSummary: draft.evidenceSummary,
        problemStatement: draft.problemStatement,
        hypothesis: draft.hypothesis,
        assumptionLevel: draft.assumptionLevel,
        stepsJson: JSON.stringify(draft.steps),
        completionCriteria: draft.completionCriteria,
        retestMethod: draft.retestMethod,
        businessImportance: draft.businessImportance,
        estimatedEffort: draft.estimatedEffort,
        verifiedEvidence: draft.verifiedEvidence,
        privacyRisk: draft.privacyRisk,
        createdAt: now,
      });

      const existing = await txDao.findOpenTask({
        ownerId,
        brandId,
        questionCluster: draft.questionCluster,
        targetPage: draft.targetPage,
        gapType: draft.gapType,
      });

      if (existing) {
        await txDao.linkEvidence(existing.id, findingId, brandId, now);
        created.push({ taskId: existing.id, findingId, merged: true, title: existing.title });
        continue;
      }

      const taskId = randomUUID();
      await txDao.insertTask({
        id: taskId,
        brandId,
        ownerId,
        primaryFindingId: findingId,
        gapType: draft.gapType,
        questionCluster: draft.questionCluster,
        targetPage: draft.targetPage,
        title: draft.title,
        status: "todo",
        priorityBucket: priorityBucketOf(draft),
        manualRank: null,
        reorderReason: null,
        completionNote: null,
        dismissReason: null,
        retestConclusion: null,
        createdAt: now,
        updatedAt: now,
      });
      await txDao.linkEvidence(taskId, findingId, brandId, now);
      created.push({ taskId, findingId, merged: false, title: draft.title });
    }
  });
  if (drafts.length > 0) await invalidateEvidenceOverview(ownerId, brandId, cache ?? openCache());
  return created;
}

export async function generateFromEvidence(
  db: DatabaseConnection,
  ownerId: string,
  input: GenerateFromEvidenceInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand) return denied("NOT_FOUND");

  const detail = await readObservation(db, ownerId, input.observationId);
  if (!detail || detail.observation.brandId !== input.brandId) return denied("NOT_FOUND");

  const latest = detail.analyses.at(-1);
  if (!latest || detail.observation.evidenceState === "draft_evidence") {
    return denied("INVALID_INPUT");
  }

  const brandName = (await brandNameOf(db, ownerId, input.brandId)) ?? input.brandId;
  const drafts = diagnoseFromEvidence({
    observationId: detail.observation.id,
    analysisVersionId: latest.id,
    questionText: detail.observation.questionText,
    answerText: detail.observation.answerText,
    mentioned: latest.mentioned,
    recommended: latest.recommended,
    officialSiteCited: latest.officialSiteCited,
    citationSetState: detail.observation.citationSetState,
    citations: detail.citations.map((item) => ({
      normalizedUrl: item.normalizedUrl,
      pageStatus: item.pageStatus,
      ownership: item.ownership,
    })),
    brandName,
    businessImportance: input.businessImportance,
  });

  for (const draft of drafts) {
    if (!assertsNoCausalClaim(`${draft.problemStatement}${draft.hypothesis}${draft.title}`)) {
      return denied("INVALID_INPUT");
    }
  }

  const created = await upsertDrafts(db, ownerId, input.brandId, drafts, clock(), cache);
  return { tasks: created, draftCount: drafts.length };
}

function pageCheckDraft(url: string, publicStatus: string, cluster: string): FindingDraft {
  const targetPage = normalizeTargetPage(url);
  return {
    gapType: "page_unreadable",
    questionCluster: cluster,
    targetPage,
    observationId: null,
    analysisVersionId: null,
    evidenceSummary: `页面检查状态为 ${publicStatus}：${targetPage}`,
    problemStatement: "公开页面当前不可完整读取，需人工证据或待核验。",
    hypothesis: "访问受限不等于网站损坏，也不代表引擎无法收录。",
    assumptionLevel: "pending",
    steps: ["记录访问条件与时间", "必要时提交人工截图/正文证据", "恢复公开可读后再复测"],
    completionCriteria: "页面可达并保留检查记录，或明确人工核验级别。",
    retestMethod: "复查公开状态后，不把单次速度或 robots 线索当作收录结论。",
    businessImportance: 2,
    estimatedEffort: 2,
    verifiedEvidence: 1,
    privacyRisk: 0,
    title: "公开页面受限，待核验",
  };
}

function pageResultFromOutcome(url: string, outcome: PublicPageFetchOutcome): PageFetchResult {
  if (!outcome.ok) {
    return { url, status: "error", accessCondition: outcome.code.replace(/_/g, "-") };
  }
  if (outcome.accessClass === "public") {
    return {
      url,
      status: "ok",
      title: outcome.title,
      body: outcome.bodyText,
      accessCondition: "anonymous-get",
      discoverability: outcome.robots ? `robots:${outcome.robots}` : undefined,
    };
  }
  if (outcome.accessClass === "removed") {
    return { url, status: "error", title: outcome.title, accessCondition: "removed" };
  }
  return {
    url,
    status: "restricted",
    title: outcome.title,
    body: outcome.bodyText,
    accessCondition: outcome.accessClass === "draft_box" ? "draft-box" : "login-wall",
  };
}

async function resolvePageFetch(
  url: string,
  fixture: NonNullable<CheckPagesInput["fixtures"]>[number] | undefined,
  fetchPage: PublicPageFetcher,
): Promise<PageFetchResult> {
  if (fixture) {
    return {
      url,
      status: fixture.status,
      title: fixture.title,
      body: fixture.body,
      accessCondition: fixture.accessCondition,
    };
  }
  if (!isPublicPageFetchEnabled()) {
    return { url, status: "error", accessCondition: "public-fetch-disabled" };
  }
  try {
    return pageResultFromOutcome(url, await fetchPage(url));
  } catch {
    return { url, status: "error", accessCondition: "fetch-error" };
  }
}

export async function checkPages(
  db: DatabaseConnection,
  ownerId: string,
  input: CheckPagesInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
  fetchPage: PublicPageFetcher = fetchPublicPage,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand) return denied("NOT_FOUND");
  if (input.urls.length < 1 || input.urls.length > 5) return denied("INVALID_INPUT");

  const dao = new OptimizationDao(db);
  if (input.taskId) {
    const task = await dao.getTask(ownerId, input.brandId, input.taskId);
    if (!task) return denied("NOT_FOUND");
  }

  const fixtureByUrl = new Map((input.fixtures ?? []).map((item) => [item.url, item]));
  const now = clock();
  const records = [];
  const restrictedDrafts: FindingDraft[] = [];

  for (const url of input.urls) {
    const fetchResult = await resolvePageFetch(url, fixtureByUrl.get(url), fetchPage);

    const inspected = inspectPage(fetchResult, now);
    const id = randomUUID();
    await dao.insertPageCheck({
      id,
      brandId: input.brandId,
      ownerId,
      taskId: input.taskId ?? null,
      url: inspected.url,
      normalizedUrl: inspected.normalizedUrl,
      checkedAt: inspected.checkedAt,
      accessCondition: inspected.accessCondition,
      publicStatus: inspected.publicStatus,
      title: inspected.title,
      bodyExcerpt: inspected.bodyExcerpt,
      keyFactsJson: JSON.stringify(inspected.keyFacts),
      discoverabilityNotes: inspected.discoverabilityNotes,
      containsExecutableInstructions: inspected.containsExecutableInstructions,
      manualEvidenceRef: null,
      createdAt: now,
    });

    if (inspected.publicStatus === "restricted" || inspected.publicStatus === "pending_verification") {
      restrictedDrafts.push(
        pageCheckDraft(url, inspected.publicStatus, normalizeQuestionCluster(`page:${inspected.normalizedUrl}`)),
      );
    }

    records.push({
      id,
      url: inspected.url,
      normalizedUrl: inspected.normalizedUrl,
      publicStatus: inspected.publicStatus,
      accessCondition: inspected.accessCondition,
      containsExecutableInstructions: inspected.containsExecutableInstructions === 1,
      discoverabilityNotes: inspected.discoverabilityNotes,
      title: inspected.title,
      bodyExcerpt: inspected.bodyExcerpt,
    });
  }

  const tasks = restrictedDrafts.length > 0
    ? await upsertDrafts(db, ownerId, input.brandId, restrictedDrafts, now, cache)
    : [];

  return { checks: records, tasks };
}

export async function updateTask(
  db: DatabaseConnection,
  ownerId: string,
  input: UpdateTaskInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, input.brandId);
  if (!brand) return denied("NOT_FOUND");

  const dao = new OptimizationDao(db);
  const task = await dao.getTask(ownerId, input.brandId, input.taskId);
  if (!task) return denied("NOT_FOUND");

  const next = { ...task, updatedAt: clock() };

  if (input.manualRank != null) {
    if (!input.reorderReason) return denied("INVALID_INPUT");
    next.manualRank = input.manualRank;
    next.reorderReason = input.reorderReason;
  }

  if (input.status) {
    if (input.status === "dismissed") {
      if (!input.dismissReason) return denied("INVALID_INPUT");
      next.status = "dismissed";
      next.dismissReason = input.dismissReason;
    } else if (input.status === "implemented" || input.status === "retest_pending" || input.status === "closed") {
      if (!input.completionNote && !task.completionNote) return denied("INVALID_INPUT");
      next.status = input.status;
      if (input.completionNote) next.completionNote = input.completionNote;
      if (input.retestConclusion) next.retestConclusion = input.retestConclusion;
    } else {
      next.status = input.status;
    }
  } else if (input.completionNote) {
    next.completionNote = input.completionNote;
  }

  if (input.retestConclusion) next.retestConclusion = input.retestConclusion;

  await dao.updateTask(next);
  await invalidateEvidenceOverview(ownerId, input.brandId, cache ?? openCache());
  return { task: next };
}

export async function listPrioritizedTasks(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  limit = 20,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, brandId);
  if (!brand) return denied("NOT_FOUND");

  const dao = new OptimizationDao(db);
  const rows = await dao.listOpenTasksWithFindings(ownerId, brandId);
  const sorted = [...rows].sort((a, b) => compareTaskPriority({
    priorityBucket: a.task.priorityBucket,
    businessImportance: a.businessImportance,
    verifiedEvidence: a.verifiedEvidence,
    estimatedEffort: a.estimatedEffort,
    createdAt: a.task.createdAt,
    manualRank: a.task.manualRank,
  }, {
    priorityBucket: b.task.priorityBucket,
    businessImportance: b.businessImportance,
    verifiedEvidence: b.verifiedEvidence,
    estimatedEffort: b.estimatedEffort,
    createdAt: b.task.createdAt,
    manualRank: b.task.manualRank,
  }));

  return {
    tasks: sorted.slice(0, limit).map((item) => ({
      ...item.task,
      businessImportance: item.businessImportance,
      verifiedEvidence: item.verifiedEvidence,
      estimatedEffort: item.estimatedEffort,
    })),
  };
}

export async function readTaskDetail(
  db: DatabaseConnection,
  ownerId: string,
  taskId: string,
) {
  const dao = new OptimizationDao(db);
  const task = await dao.getTaskByIdForOwner(ownerId, taskId);
  if (!task) return denied("NOT_FOUND");
  const findings = await dao.listFindingsForTask(task.id);
  const checks = await dao.listPageChecks(ownerId, task.brandId, task.id);
  return { task, findings, checks };
}
