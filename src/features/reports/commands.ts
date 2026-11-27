import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { createObjectStorage } from "../../lib/storage/index.ts";
import { LeadFeedbackDao } from "../business-feedback/feedback-dao.ts";
import { LeadQualityDao } from "../business-feedback/quality-dao.ts";
import { BrandDao } from "../brands/dao.ts";
import { CrawlerObservationDao } from "../data-connections/crawler-dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { saveStoredObject, type ObjectStorageClient } from "../stored-objects/commands.ts";
import { MAX_STORED_OBJECT_BYTES } from "../stored-objects/contracts.ts";
import { loadBrandObjectsByIds, markObjectFailed } from "../stored-objects/dao.ts";
import type {
  GenerateReportInput,
  ReportDecisionAction,
  ReportError,
  RequestRetestInput,
  ReviseReportInput,
  SaveReportDecisionInput,
} from "./contracts.ts";
import { ReportDao, type ReportDecisionRow, type ReportSnapshotRow } from "./dao.ts";
import {
  snapshotCostSchema,
  snapshotLaborSchema,
  summarizeCostGroups,
  unrecordedLabor,
  type CostWindows,
  type SnapshotCost,
  type SnapshotLabor,
} from "./cost.ts";
import { compareWindows, computeD7DueAt, resolveLoopGate } from "./rules.ts";
import { readSnapshotBusiness, summarizeBusinessFeedback, type SnapshotBusinessView } from "./business-feedback.ts";
import { readExecution, readMetricConclusions, readVisits, type ExecutionReading, type MetricConclusion, type VisitReading } from "./reading.ts";
import { buildSnapshotDocument, fingerprintBytes, renderSnapshotHtml } from "./snapshot.ts";
import { loadSnapshotComparisons, snapshotMetrics, type SnapshotMetric } from "./snapshot-comparisons.ts";
import { orderedWindowBounds } from "./window-observations.ts";

type Clock = () => string;
const defaultClock: Clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
const decisionClock: Clock = () => new Date().toISOString();

async function requireOwnedBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  if (!brand) return null;
  return brand;
}

const reportHtmlName = "report.html";
const reportJsonName = "report.json";

export type SnapshotStorageOptions = {
  env?: Record<string, string | undefined>;
  storage?: ObjectStorageClient;
  now?: Date;
  connection?: QueryConnection;
};

function storageOptions(options: SnapshotStorageOptions) {
  return {
    ...(options.env ? { env: options.env } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.connection ? { connection: options.connection } : {}),
  };
}

type StoredReportFile = { ok: true; id: string; sha256: string } | { ok: false; error: ReportError };

async function storeReportFile(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  fileName: typeof reportHtmlName | typeof reportJsonName,
  contentType: "text/html" | "application/json",
  text: string,
  options: SnapshotStorageOptions,
): Promise<StoredReportFile> {
  const body = new TextEncoder().encode(text);
  if (body.byteLength < 1 || body.byteLength > MAX_STORED_OBJECT_BYTES) return { ok: false, error: "INVALID_INPUT" };
  const saved = await saveStoredObject(db, {
    actorId: ownerId,
    brandId,
    class: "report-snapshot",
    visibility: "internal",
    fileName,
    contentType,
    body,
  }, storageOptions(options));
  const sha256 = fingerprintBytes(text);
  if (!saved.ok) return { ok: false, error: saved.code === "failed" ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT" };
  if (saved.class !== "report-snapshot" || saved.visibility !== "internal" || saved.fileName !== fileName
    || saved.contentType !== contentType || saved.byteSize !== body.byteLength || saved.sha256 !== sha256) {
    return { ok: false, error: "SERVICE_UNAVAILABLE" };
  }
  return { ok: true, id: saved.id, sha256 };
}

async function storeSnapshotPair(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  jsonText: string,
  htmlText: string,
  now: string,
  options: SnapshotStorageOptions,
) {
  const storedOptions = { ...options, now: options.now ?? new Date(now) };
  const html = await storeReportFile(db, ownerId, brandId, reportHtmlName, "text/html", htmlText, storedOptions);
  if (!html.ok) return html;
  const json = await storeReportFile(db, ownerId, brandId, reportJsonName, "application/json", jsonText, storedOptions);
  if (!json.ok) return json;
  if (html.id === json.id) return { ok: false as const, error: "SERVICE_UNAVAILABLE" as ReportError };
  return { ok: true as const, html, json };
}

function inlineSnapshot(row: ReportSnapshotRow) {
  return row.htmlObjectId === null && row.jsonObjectId === null;
}

async function loadWindowCost(db: QueryConnection, brandId: string, windows: CostWindows) {
  const groups = await new ReportDao(db).samplingCostGroups(brandId, windows);
  return { cost: summarizeCostGroups(groups), labor: unrecordedLabor };
}

async function loadBusinessFeedback(db: QueryConnection, ownerId: string, brandId: string) {
  const leads = await new LeadFeedbackDao(db).currentForBrand(ownerId, brandId);
  const primaryCounts = { referral: 0, self_report: 0, landing_page: 0, unknown: 0 };
  const leadFeedback = {
    disqualified_inquiries: 0,
    unknown_qualification: 0,
    won_inquiries: 0,
    followed_up_inquiries: 0,
    unknown_follow_up: 0,
    records: leads.flatMap(({ leadId, feedbackId }) => feedbackId ? [{ leadId, feedbackId }] : []),
  };
  let qualified = 0;
  for (const lead of leads) {
    primaryCounts[lead.primary] += 1;
    if (lead.status === "qualified") qualified += 1;
    else if (lead.status === "disqualified") leadFeedback.disqualified_inquiries += 1;
    else leadFeedback.unknown_qualification += 1;
    if (lead.outcome === "won") leadFeedback.won_inquiries += 1;
    if (lead.outcome === "contacted" || lead.outcome === "won" || lead.outcome === "lost") {
      leadFeedback.followed_up_inquiries += 1;
    }
    if (!lead.outcome || lead.outcome === "unknown") leadFeedback.unknown_follow_up += 1;
  }
  const rollup = await new LeadQualityDao(db).observationRollup(ownerId, brandId);
  const crawler = await new CrawlerObservationDao(db).brandRollup(ownerId, brandId);
  return summarizeBusinessFeedback({
    primaryCounts,
    qualified,
    leadFeedback,
    identifiedReferrals: rollup.identified,
    sessionDenominator: rollup.denominator > 0 ? rollup.denominator : null,
    observationCrawlerVisits: rollup.crawlerVisits,
    observationAnswerCitations: rollup.answerCitations,
    crawlerVisitCount: crawler.visits,
    crawlerAnswerCitations: crawler.citations,
  });
}

async function readComparisonEvidence(
  db: QueryConnection,
  ownerId: string,
  input: GenerateReportInput | ReviseReportInput,
  scope: Parameters<typeof loadSnapshotComparisons>[4],
) {
  try {
    return await loadSnapshotComparisons(db, ownerId, input.brandId, input, scope);
  } catch {
    console.error("report-comparison-read-failed", { brandId: input.brandId });
    return null;
  }
}

type StoredSnapshotBody = { ok: true; html: string; json: string } | { ok: false; error: ReportError };

async function readStoredSnapshot(
  db: DatabaseConnection,
  ownerId: string,
  snapshot: ReportSnapshotRow,
  options: SnapshotStorageOptions,
): Promise<StoredSnapshotBody> {
  if (!snapshot.htmlObjectId || !snapshot.jsonObjectId || snapshot.htmlObjectId === snapshot.jsonObjectId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  const rows = await loadBrandObjectsByIds(db, ownerId, snapshot.brandId, [snapshot.htmlObjectId, snapshot.jsonObjectId]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const expected = [
    { id: snapshot.htmlObjectId, name: reportHtmlName, contentType: "text/html", sha256: snapshot.htmlSha256 },
    { id: snapshot.jsonObjectId, name: reportJsonName, contentType: "application/json", sha256: snapshot.jsonSha256 },
  ] as const;
  const storage = options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
  const files: Partial<Record<"report.html" | "report.json", string>> = {};
  for (const file of expected) {
    const row = byId.get(file.id);
    if (!row || row.status !== "ready" || row.class !== "report-snapshot" || row.visibility !== "internal"
      || row.immutable !== 1 || row.fileName !== file.name || row.contentType !== file.contentType
      || row.sha256 !== file.sha256 || !row.objectKey) {
      return { ok: false, error: "NOT_FOUND" };
    }
    let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
    try {
      loaded = await storage.getObject({ key: row.objectKey });
    } catch {
      return { ok: false, error: "SERVICE_UNAVAILABLE" };
    }
    if (!loaded.ok) return { ok: false, error: "SERVICE_UNAVAILABLE" };
    const text = new TextDecoder().decode(loaded.body);
    if (loaded.sha256 !== file.sha256 || loaded.byteSize !== row.byteSize || fingerprintBytes(text) !== file.sha256) {
      await storage.deleteObject({ key: row.objectKey });
      await db.transaction((tx) => markObjectFailed(tx, row.id, ownerId, "ready"));
      return { ok: false, error: "SERVICE_UNAVAILABLE" };
    }
    files[file.name] = text;
  }
  const html = files[reportHtmlName];
  const json = files[reportJsonName];
  if (html === undefined || json === undefined) return { ok: false, error: "NOT_FOUND" };
  return { ok: true, html, json };
}

export async function requestRetest(
  db: QueryConnection,
  ownerId: string,
  input: RequestRetestInput,
  clock: Clock = defaultClock,
) {
  const brand = await requireOwnedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };

  const dao = new ReportDao(db);
  const existing = await dao.findRetestByOperation(input.brandId, input.operationId);
  if (existing) return { retest: existing, todo: null as null, reused: true };

  const now = clock();
  const gate = resolveLoopGate({
    requestedIntent: input.intent,
    effectiveAt: input.effectiveAt,
  });

  if (input.kind === "d7_reminder") {
    if (!input.effectiveAt) {
      return { error: "LOOP_NOT_READY" as ReportError };
    }
    const progress = computeD7DueAt(input.effectiveAt, input.timezone, now);
    const retestId = randomUUID();
    const todoId = randomUUID();
    await dao.insertRetest({
      id: retestId,
      brandId: input.brandId,
      ownerId,
      kind: "d7_reminder",
      status: progress.due ? "due" : "scheduled",
      intent: gate.allowedIntent,
      track: input.track,
      timezone: input.timezone,
      entityVersion: input.entityVersion,
      beforeRunId: null,
      afterRunId: null,
      publicationId: input.publicationId ?? null,
      effectiveAt: input.effectiveAt,
      operationId: input.operationId,
      comparisonJson: null,
      blockReason: progress.progressOnly ? "window-not-due" : gate.reason,
      createdAt: now,
      updatedAt: now,
    });
    await dao.insertTodo({
      id: todoId,
      brandId: input.brandId,
      ownerId,
      retestId,
      kind: "d7_reminder",
      status: progress.due ? "due" : "scheduled",
      dueAt: progress.dueAt,
      progressJson: JSON.stringify({
        elapsedFullDays: progress.elapsedFullDays,
        remainingFullDays: progress.remainingFullDays,
        autoCharge: false,
      }),
      autoCharge: 0,
      createdAt: now,
      updatedAt: now,
    });
    const retest = await dao.findRetest(ownerId, retestId);
    const todos = await dao.listTodos(ownerId, input.brandId, 1);
    return {
      retest,
      todo: todos[0] ?? null,
      progressOnly: progress.progressOnly,
      reused: false,
    };
  }

  if (!input.after) return { error: "INVALID_INPUT" as ReportError };
  const bounds = orderedWindowBounds({ before: input.before, after: input.after }, input.timezone);
  if (bounds.error) return { error: bounds.error };

  const comparison = compareWindows(input.before.samples, input.after.samples);
  const retestId = randomUUID();
  const status = comparison.grade === "incomparable" ? "inconclusive" : "completed";
  await dao.insertRetest({
    id: retestId,
    brandId: input.brandId,
    ownerId,
    kind: input.kind === "diagnostic" || gate.allowedIntent === "diagnostic" ? "diagnostic" : "exploratory",
    status,
    intent: gate.allowedIntent,
    track: input.track,
    timezone: input.timezone,
    entityVersion: input.entityVersion,
    beforeRunId: null,
    afterRunId: null,
    publicationId: input.publicationId ?? null,
    effectiveAt: input.effectiveAt ?? null,
    operationId: input.operationId,
    comparisonJson: JSON.stringify(comparison),
    blockReason: gate.reason,
    createdAt: now,
    updatedAt: now,
  });

  return {
    retest: await dao.findRetest(ownerId, retestId),
    todo: null,
    comparison,
    loopCompleted: gate.loopCompleted,
    reused: false,
  };
}

export async function generateReport(
  db: DatabaseConnection,
  ownerId: string,
  input: GenerateReportInput,
  clock: Clock = defaultClock,
  options: SnapshotStorageOptions = {},
) {
  const brand = await requireOwnedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };

  const dao = new ReportDao(db);
  const existing = await dao.findSnapshotByOperation(input.brandId, input.operationId);
  if (existing) return { snapshot: existing, reused: true };

  const retest = await dao.findRetest(ownerId, input.retestId);
  if (!retest || retest.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  const bounds = orderedWindowBounds(input, retest.timezone);
  if (bounds.error) return { error: bounds.error };

  const now = clock();
  const gate = resolveLoopGate({
    requestedIntent: input.publicationId || input.effectiveAt ? "business_loop" : retest.intent,
    effectiveAt: input.effectiveAt ?? retest.effectiveAt,
  });
  const metrics = await readComparisonEvidence(db, ownerId, input, retest);
  if (!metrics) return { error: "SERVICE_UNAVAILABLE" as ReportError };
  const comparison = metrics.comparisons.recommendation_rate.result;
  const snapshotId = randomUUID();
  const document = buildSnapshotDocument({
    reportId: snapshotId,
    brandId: input.brandId,
    brandName: input.brandName ?? brand.id,
    entityVersion: retest.entityVersion,
    timezone: retest.timezone,
    locale: input.locale,
    intent: gate.allowedIntent,
    loopCompleted: gate.loopCompleted,
    metrics,
    windows: {
      before: { start: input.before.start, endExclusive: input.before.endExclusive },
      after: { start: input.after.start, endExclusive: input.after.endExclusive },
    },
    publication: input.publicationId && (input.effectiveAt ?? retest.effectiveAt)
      ? {
        id: input.publicationId,
        effectiveAt: input.effectiveAt ?? retest.effectiveAt!,
        verification: "verified",
      }
      : null,
    createdAt: now,
    ...(await loadWindowCost(db, input.brandId, {
      before: { start: input.before.start, endExclusive: input.before.endExclusive },
      after: { start: input.after.start, endExclusive: input.after.endExclusive },
    })),
    businessFeedback: await loadBusinessFeedback(db, ownerId, input.brandId),
  });
  const jsonText = JSON.stringify(document);
  const htmlText = renderSnapshotHtml(document);
  const stored = await storeSnapshotPair(db, ownerId, input.brandId, jsonText, htmlText, now, options);
  if (!stored.ok) return { error: stored.error };
  await dao.insertSnapshot({
    id: snapshotId,
    brandId: input.brandId,
    ownerId,
    retestId: retest.id,
    status: "created",
    grade: document.grade,
    intent: gate.allowedIntent,
    loopCompleted: gate.loopCompleted ? 1 : 0,
    predecessorId: null,
    entityVersion: retest.entityVersion,
    timezone: retest.timezone,
    locale: input.locale,
    sourceMissing: comparison.sourceMissing ? 1 : 0,
    jsonBytes: "",
    htmlBytes: "",
    jsonSha256: stored.json.sha256,
    htmlSha256: stored.html.sha256,
    operationId: input.operationId,
    createdAt: now,
    htmlObjectId: stored.html.id,
    jsonObjectId: stored.json.id,
  });
  await dao.updateRetest({
    id: retest.id,
    ownerId,
    status: document.grade === "incomparable" ? "inconclusive" : "completed",
    intent: gate.allowedIntent,
    comparisonJson: JSON.stringify(comparison),
    blockReason: gate.reason,
    effectiveAt: input.effectiveAt ?? retest.effectiveAt,
    publicationId: input.publicationId ?? retest.publicationId,
    updatedAt: now,
  });

  return {
    snapshot: await dao.findSnapshot(ownerId, snapshotId),
    comparison,
    loopCompleted: gate.loopCompleted,
    reused: false,
  };
}

export async function reviseReport(
  db: DatabaseConnection,
  ownerId: string,
  input: ReviseReportInput,
  clock: Clock = defaultClock,
  options: SnapshotStorageOptions = {},
) {
  const brand = await requireOwnedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };

  const dao = new ReportDao(db);
  const existingOp = await dao.findSnapshotByOperation(input.brandId, input.operationId);
  if (existingOp) return { snapshot: existingOp, previous: null, reused: true };

  const previous = await dao.findSnapshot(ownerId, input.snapshotId);
  if (!previous || previous.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  const retest = await dao.findRetest(ownerId, previous.retestId);
  if (!retest || retest.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  const bounds = orderedWindowBounds(input, previous.timezone);
  if (bounds.error) return { error: bounds.error };

  const now = clock();
  const metrics = await readComparisonEvidence(db, ownerId, input, {
    track: retest.track, entityVersion: previous.entityVersion, timezone: previous.timezone,
  });
  if (!metrics) return { error: "SERVICE_UNAVAILABLE" as ReportError };
  const snapshotId = randomUUID();
  const document = buildSnapshotDocument({
    reportId: snapshotId,
    brandId: input.brandId,
    brandName: input.brandName ?? brand.id,
    entityVersion: previous.entityVersion,
    timezone: previous.timezone,
    locale: input.locale,
    intent: previous.intent,
    loopCompleted: previous.loopCompleted === 1,
    metrics,
    windows: {
      before: { start: input.before.start, endExclusive: input.before.endExclusive },
      after: { start: input.after.start, endExclusive: input.after.endExclusive },
    },
    publication: null,
    createdAt: now,
    predecessorId: previous.id,
    limitations: input.note ? [input.note] : undefined,
    ...(await loadWindowCost(db, input.brandId, {
      before: { start: input.before.start, endExclusive: input.before.endExclusive },
      after: { start: input.after.start, endExclusive: input.after.endExclusive },
    })),
    businessFeedback: await loadBusinessFeedback(db, ownerId, input.brandId),
  });
  const jsonText = JSON.stringify(document);
  const htmlText = renderSnapshotHtml(document);
  const stored = await storeSnapshotPair(db, ownerId, input.brandId, jsonText, htmlText, now, options);
  if (!stored.ok) return { error: stored.error };
  await dao.supersedeSnapshot(ownerId, previous.id);
  await dao.insertSnapshot({
    id: snapshotId,
    brandId: input.brandId,
    ownerId,
    retestId: previous.retestId,
    status: "created",
    grade: document.grade,
    intent: previous.intent,
    loopCompleted: previous.loopCompleted,
    predecessorId: previous.id,
    entityVersion: previous.entityVersion,
    timezone: previous.timezone,
    locale: input.locale,
    sourceMissing: document.source_missing ? 1 : 0,
    jsonBytes: "",
    htmlBytes: "",
    jsonSha256: stored.json.sha256,
    htmlSha256: stored.html.sha256,
    operationId: input.operationId,
    createdAt: now,
    htmlObjectId: stored.html.id,
    jsonObjectId: stored.json.id,
  });

  return {
    snapshot: await dao.findSnapshot(ownerId, snapshotId),
    previous: await dao.findSnapshot(ownerId, previous.id),
    reused: false,
  };
}

export async function readSnapshot(
  db: DatabaseConnection,
  ownerId: string,
  snapshotId: string,
  options: SnapshotStorageOptions = {},
): Promise<{ error: ReportError } | { snapshot: ReportSnapshotRow; html: string; json: string; source: SnapshotSourceView }> {
  const identity = await new ReportDao(db).snapshotIdentity(snapshotId);
  if (!identity) return { error: "NOT_FOUND" };
  const adopted = await authorizeBrandActor(db, ownerId, identity.brandId, "read");
  if (!adopted || adopted.ownerId !== identity.ownerId) return { error: "NOT_FOUND" };
  ownerId = adopted.ownerId;
  const snapshot = await new ReportDao(db).findSnapshot(ownerId, snapshotId);
  if (!snapshot) return { error: "NOT_FOUND" };
  // Download re-checks the current owner and rejects a frozen brand before any object read.
  const brand = await requireOwnedBrand(db, ownerId, snapshot.brandId);
  if (!brand) return { error: "NOT_FOUND" };
  let html = snapshot.htmlBytes;
  let json = snapshot.jsonBytes;
  if (!inlineSnapshot(snapshot)) {
    const stored = await readStoredSnapshot(db, ownerId, snapshot, options);
    if (!stored.ok) return { error: stored.error };
    html = stored.html;
    json = stored.json;
  }
  const source = await sourceForSnapshot(db, ownerId, snapshot, parseSnapshotDocument(json));
  return { snapshot, html, json, source };
}

export async function listReports(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  limit = 20,
  options: SnapshotStorageOptions = {},
) {
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read");
  if (!adopted) return { error: "NOT_FOUND" as ReportError };
  ownerId = adopted.ownerId;
  const brand = await requireOwnedBrand(db, ownerId, brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const dao = new ReportDao(db);
  const [retests, snapshots, todos] = await Promise.all([
    dao.listRetests(ownerId, brandId, limit),
    dao.listSnapshots(ownerId, brandId, limit),
    dao.listTodos(ownerId, brandId, limit),
  ]);
  const loaded = await loadSnapshotDocuments(db, ownerId, snapshots, options);
  const sources = Object.fromEntries(await snapshotSourceViews(db, ownerId, snapshots, documentsFromLoaded(loaded)));
  return { retests, snapshots, todos, sources };
}

export type SnapshotCostView =
  | { state: "ready"; cost: SnapshotCost; labor: SnapshotLabor }
  | { state: "absent" }
  | { state: "unavailable" };

const comparisonOverview = z.object({
  common_query_count: z.number().int().nonnegative(),
  delta_pp: z.number().nullable(),
});
const savedOverview = z.object({
  metric: z.string().min(1).max(80).optional(),
  comparisons: z.object({
    mention_rate: comparisonOverview,
    recommendation_rate: comparisonOverview,
    official_site_citation_rate: comparisonOverview,
  }).optional(),
  cost: z.unknown(),
  labor: z.unknown(),
});

const excludedQuerySchema = z.object({
  queryId: z.string(),
  reason: z.enum(["modified", "missing_side", "not_judgable", "brand_question", "scope_mismatch"]),
});

export type SnapshotExclusion = z.infer<typeof excludedQuerySchema>;

type SnapshotBodyView = {
  cost: SnapshotCostView;
  metric?: string;
  comparisons?: z.infer<typeof savedOverview>["comparisons"];
  excluded: SnapshotExclusion[];
  business: SnapshotBusinessView;
  conclusions: Partial<Record<SnapshotMetric, MetricConclusion>>;
  execution: ExecutionReading;
  visits: VisitReading;
};

const unreadSnapshotBody = {
  cost: { state: "unavailable" as const },
  excluded: [],
  business: { state: "unavailable" as const },
  conclusions: {},
  execution: { state: "unavailable" as const },
  visits: { state: "unavailable" as const },
};

export type SnapshotSourceView = {
  sourceMissing: boolean;
  missingObservationCount: number;
};

export type SnapshotView = SnapshotBodyView & {
  source: SnapshotSourceView;
};

const observationIdValue = z.string().min(1).max(200);

function observationIdsOf(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== "object" || !("observation_ids" in value)) return;
  const parsed = z.array(observationIdValue).safeParse(value.observation_ids);
  if (!parsed.success) return;
  for (const id of parsed.data) ids.add(id);
}

function collectQueryIds(queries: unknown, ids: Set<string>) {
  if (!Array.isArray(queries)) return;
  for (const query of queries) {
    if (!query || typeof query !== "object") continue;
    if ("before" in query) observationIdsOf(query.before, ids);
    if ("after" in query) observationIdsOf(query.after, ids);
  }
}

/** report-v4 nests queries under each metric. Older files keep one query list. */
export function referencedObservationIds(document: unknown): string[] {
  const ids = new Set<string>();
  if (!document || typeof document !== "object") return [];
  if ("queries" in document) collectQueryIds(document.queries, ids);
  if ("comparisons" in document && document.comparisons && typeof document.comparisons === "object") {
    for (const block of Object.values(document.comparisons)) {
      if (!block || typeof block !== "object" || !("queries" in block)) continue;
      collectQueryIds(block.queries, ids);
    }
  }
  return [...ids];
}

export function snapshotSourceView(
  storedSourceMissing: number,
  document: unknown | undefined,
  presentIds: ReadonlySet<string>,
): SnapshotSourceView {
  if (document === undefined) {
    return { sourceMissing: storedSourceMissing === 1, missingObservationCount: 0 };
  }
  let missingObservationCount = 0;
  for (const id of referencedObservationIds(document)) {
    if (!presentIds.has(id)) missingObservationCount += 1;
  }
  return {
    sourceMissing: storedSourceMissing === 1 || missingObservationCount > 0,
    missingObservationCount,
  };
}

function parseSnapshotDocument(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function snapshotSourceViews(
  db: QueryConnection,
  ownerId: string,
  snapshots: readonly ReportSnapshotRow[],
  documents: ReadonlyMap<string, unknown | undefined>,
) {
  const idsByBrand = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    const document = documents.get(snapshot.id);
    if (document === undefined) continue;
    const bucket = idsByBrand.get(snapshot.brandId) ?? new Set<string>();
    for (const id of referencedObservationIds(document)) bucket.add(id);
    if (bucket.size > 0) idsByBrand.set(snapshot.brandId, bucket);
  }
  const presentByBrand = new Map<string, ReadonlySet<string>>();
  const dao = new ReportDao(db);
  for (const [brandId, ids] of idsByBrand) {
    presentByBrand.set(brandId, await dao.existingObservationIds(ownerId, brandId, [...ids]));
  }
  const views = new Map<string, SnapshotSourceView>();
  for (const snapshot of snapshots) {
    views.set(snapshot.id, snapshotSourceView(
      snapshot.sourceMissing,
      documents.get(snapshot.id),
      presentByBrand.get(snapshot.brandId) ?? new Set(),
    ));
  }
  return views;
}

async function sourceForSnapshot(
  db: QueryConnection,
  ownerId: string,
  snapshot: ReportSnapshotRow,
  document: unknown | undefined,
) {
  const views = await snapshotSourceViews(db, ownerId, [snapshot], new Map([[snapshot.id, document]]));
  return views.get(snapshot.id) ?? snapshotSourceView(snapshot.sourceMissing, undefined, new Set());
}

type LoadedSnapshotJson = { status: "ready"; text: string } | { status: "unavailable" };

async function loadSnapshotDocuments(
  db: QueryConnection,
  ownerId: string,
  snapshots: readonly ReportSnapshotRow[],
  options: SnapshotStorageOptions,
) {
  const loaded = new Map<string, LoadedSnapshotJson>();
  const stored: ReportSnapshotRow[] = [];
  for (const snapshot of snapshots) {
    if (inlineSnapshot(snapshot)) loaded.set(snapshot.id, { status: "ready", text: snapshot.jsonBytes });
    else stored.push(snapshot);
  }
  if (!stored.length) return loaded;

  const storage = options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
  const byBrand = new Map<string, ReportSnapshotRow[]>();
  for (const snapshot of stored) {
    const rows = byBrand.get(snapshot.brandId) ?? [];
    rows.push(snapshot);
    byBrand.set(snapshot.brandId, rows);
  }

  for (const [brandId, rows] of byBrand) {
    const ids = rows.flatMap((row) => row.jsonObjectId ? [row.jsonObjectId] : []);
    let objects: Awaited<ReturnType<typeof loadBrandObjectsByIds>>;
    try {
      objects = await loadBrandObjectsByIds(db, ownerId, brandId, ids);
    } catch {
      for (const row of rows) loaded.set(row.id, { status: "unavailable" });
      continue;
    }
    const byId = new Map(objects.map((row) => [row.id, row]));
    await Promise.all(rows.map(async (snapshot) => {
      const row = snapshot.jsonObjectId ? byId.get(snapshot.jsonObjectId) : undefined;
      if (!row || row.status !== "ready" || row.class !== "report-snapshot" || row.fileName !== reportJsonName
        || row.sha256 !== snapshot.jsonSha256 || !row.objectKey) {
        loaded.set(snapshot.id, { status: "unavailable" });
        return;
      }
      try {
        const loadedObject = await storage.getObject({ key: row.objectKey });
        if (!loadedObject.ok || loadedObject.sha256 !== snapshot.jsonSha256) {
          loaded.set(snapshot.id, { status: "unavailable" });
          return;
        }
        const text = new TextDecoder().decode(loadedObject.body);
        if (fingerprintBytes(text) !== snapshot.jsonSha256) {
          loaded.set(snapshot.id, { status: "unavailable" });
          return;
        }
        loaded.set(snapshot.id, { status: "ready", text });
      } catch {
        loaded.set(snapshot.id, { status: "unavailable" });
      }
    }));
  }
  return loaded;
}

function documentsFromLoaded(loaded: ReadonlyMap<string, LoadedSnapshotJson>) {
  const documents = new Map<string, unknown | undefined>();
  for (const [id, item] of loaded) {
    documents.set(id, item.status === "ready" ? parseSnapshotDocument(item.text) : undefined);
  }
  return documents;
}

function excludedQueries(saved: unknown): SnapshotExclusion[] {
  if (!saved || typeof saved !== "object" || !("comparisons" in saved)) return [];
  const comparisons = saved.comparisons;
  if (!comparisons || typeof comparisons !== "object") return [];
  const seen = new Set<string>();
  const items: SnapshotExclusion[] = [];
  for (const block of Object.values(comparisons)) {
    if (!block || typeof block !== "object" || !("excluded_queries" in block)) continue;
    const parsed = z.array(excludedQuerySchema).safeParse(block.excluded_queries);
    if (!parsed.success) continue;
    for (const item of parsed.data) {
      const key = `${item.queryId}:${item.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function parseSnapshotView(json: string): SnapshotBodyView {
  try {
    const saved = JSON.parse(json);
    const cost = snapshotCostSchema.safeParse(saved?.cost);
    const labor = snapshotLaborSchema.safeParse(saved?.labor);
    const summary = savedOverview.safeParse(saved);
    return {
      cost: cost.success && labor.success ? { state: "ready", cost: cost.data, labor: labor.data } : { state: "absent" },
      metric: summary.data?.metric,
      comparisons: summary.data?.comparisons,
      excluded: excludedQueries(saved),
      business: readSnapshotBusiness(saved),
      conclusions: readMetricConclusions(saved),
      execution: readExecution(saved),
      visits: readVisits(saved),
    };
  } catch {
    return unreadSnapshotBody;
  }
}

/** Read the list summary and cost from the same verified snapshot bytes. */
export async function snapshotViews(
  db: QueryConnection,
  ownerId: string,
  snapshots: readonly ReportSnapshotRow[],
  options: SnapshotStorageOptions = {},
): Promise<Map<string, SnapshotView>> {
  const loaded = await loadSnapshotDocuments(db, ownerId, snapshots, options);
  const sources = await snapshotSourceViews(db, ownerId, snapshots, documentsFromLoaded(loaded));
  const views = new Map<string, SnapshotView>();
  for (const snapshot of snapshots) {
    const source = sources.get(snapshot.id) ?? snapshotSourceView(snapshot.sourceMissing, undefined, new Set());
    const item = loaded.get(snapshot.id);
    const body = item?.status === "ready" ? parseSnapshotView(item.text) : unreadSnapshotBody;
    views.set(snapshot.id, { ...body, source });
  }
  return views;
}

export type ReportDecisionView = {
  id: string;
  snapshotId: string;
  action: ReportDecisionAction;
  decidedBy: string;
  decidedAt: string;
};

function presentDecision(row: ReportDecisionRow): ReportDecisionView {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    action: row.action,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  };
}

function hasSavedComparison(json: string): boolean {
  try {
    const conclusions = readMetricConclusions(JSON.parse(json));
    return snapshotMetrics.some((metric) => {
      const value = conclusions[metric];
      return value !== undefined && value !== "missing";
    });
  } catch {
    return false;
  }
}

export async function listBrandDecisions(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  snapshotIds: readonly string[],
) {
  const brand = await requireOwnedBrand(db, actorId, brandId);
  if (!brand) return { error: "NOT_FOUND" as const };
  if (snapshotIds.length === 0) return { decisions: [] as ReportDecisionView[] };
  const rows = await new ReportDao(db).listDecisions(actorId, brandId, snapshotIds);
  return { decisions: rows.map(presentDecision) };
}

export async function readSnapshotDecisions(
  db: QueryConnection,
  actorId: string,
  snapshotId: string,
) {
  const identity = await new ReportDao(db).snapshotIdentity(snapshotId);
  if (!identity || identity.ownerId !== actorId) return { error: "NOT_FOUND" as const };
  const brand = await requireOwnedBrand(db, actorId, identity.brandId);
  if (!brand) return { error: "NOT_FOUND" as const };
  const rows = await new ReportDao(db).listDecisions(actorId, identity.brandId, [snapshotId]);
  return { decisions: rows.map(presentDecision) };
}

export async function saveReportDecision(
  db: DatabaseConnection,
  actorId: string,
  input: SaveReportDecisionInput,
  clock: Clock = decisionClock,
  options: SnapshotStorageOptions = {},
) {
  const dao = new ReportDao(db);
  const identity = await dao.snapshotIdentity(input.snapshotId);
  if (!identity || identity.brandId !== input.brandId || identity.ownerId !== actorId) {
    return { error: "NOT_FOUND" as const };
  }
  const brand = await requireOwnedBrand(db, actorId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as const };
  const snapshot = await dao.findSnapshot(actorId, input.snapshotId);
  if (!snapshot || snapshot.brandId !== input.brandId) return { error: "NOT_FOUND" as const };

  let json = snapshot.jsonBytes;
  if (!inlineSnapshot(snapshot)) {
    const stored = await readStoredSnapshot(db, actorId, snapshot, options);
    if (!stored.ok) return { error: stored.error };
    json = stored.json;
  }
  if (!hasSavedComparison(json)) return { error: "NO_COMPARISON" as const };

  const now = clock();
  try {
    return await db.transaction(async (tx) => {
      const writer = new ReportDao(tx);
      const current = await writer.findSnapshot(actorId, input.snapshotId);
      if (!current || current.brandId !== input.brandId
        || current.jsonSha256 !== snapshot.jsonSha256
        || current.htmlSha256 !== snapshot.htmlSha256
        || current.jsonBytes !== snapshot.jsonBytes
        || current.htmlBytes !== snapshot.htmlBytes) {
        return { error: "NOT_FOUND" as const };
      }
      await writer.insertDecision({
        id: randomUUID(),
        brandId: input.brandId,
        ownerId: actorId,
        snapshotId: input.snapshotId,
        action: input.action,
        decidedBy: actorId,
        decidedAt: now,
        createdAt: now,
      });
      const decisions = (await writer.listDecisions(actorId, input.brandId, [input.snapshotId])).map(presentDecision);
      if (!decisions.some((row) => row.action === input.action)) return { error: "NOT_FOUND" as const };
      return { decisions };
    });
  } catch {
    console.error("report-decision-write-failed", { brandId: input.brandId });
    return { error: "SERVICE_UNAVAILABLE" as const };
  }
}

export async function saveSnapshotDecision(
  db: DatabaseConnection,
  actorId: string,
  snapshotId: string,
  action: ReportDecisionAction,
  clock: Clock = decisionClock,
  options: SnapshotStorageOptions = {},
) {
  const identity = await new ReportDao(db).snapshotIdentity(snapshotId);
  if (!identity || identity.ownerId !== actorId) return { error: "NOT_FOUND" as const };
  return saveReportDecision(db, actorId, { brandId: identity.brandId, snapshotId, action }, clock, options);
}
