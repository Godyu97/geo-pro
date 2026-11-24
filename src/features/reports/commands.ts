import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { createObjectStorage } from "../../lib/storage/index.ts";
import { BrandDao } from "../brands/dao.ts";
import { saveStoredObject, type ObjectStorageClient } from "../stored-objects/commands.ts";
import { MAX_STORED_OBJECT_BYTES } from "../stored-objects/contracts.ts";
import { loadBrandObjectsByIds, markObjectFailed } from "../stored-objects/dao.ts";
import type {
  GenerateReportInput,
  ReportError,
  RequestRetestInput,
  ReviseReportInput,
} from "./contracts.ts";
import { ReportDao, type ReportSnapshotRow } from "./dao.ts";
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
import { buildSnapshotDocument, fingerprintBytes, renderSnapshotHtml } from "./snapshot.ts";

type Clock = () => string;
const defaultClock: Clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");

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

  const now = clock();
  const gate = resolveLoopGate({
    requestedIntent: input.publicationId || input.effectiveAt ? "business_loop" : retest.intent,
    effectiveAt: input.effectiveAt ?? retest.effectiveAt,
  });
  const comparison = compareWindows(input.before.samples, input.after.samples);
  const snapshotId = randomUUID();
  const document = buildSnapshotDocument({
    reportId: snapshotId,
    brandId: input.brandId,
    brandName: input.brandName ?? brand.id,
    entityVersion: retest.entityVersion,
    timezone: retest.timezone,
    locale: input.locale,
    metric: input.metric,
    intent: gate.allowedIntent,
    loopCompleted: gate.loopCompleted,
    grade: comparison.grade,
    comparison,
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
    grade: comparison.grade,
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
    status: comparison.grade === "incomparable" ? "inconclusive" : "completed",
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

  const now = clock();
  const comparison = compareWindows(input.before.samples, input.after.samples);
  const snapshotId = randomUUID();
  const document = buildSnapshotDocument({
    reportId: snapshotId,
    brandId: input.brandId,
    brandName: input.brandName ?? brand.id,
    entityVersion: previous.entityVersion,
    timezone: previous.timezone,
    locale: input.locale,
    metric: input.metric,
    intent: previous.intent,
    loopCompleted: previous.loopCompleted === 1,
    grade: comparison.grade,
    comparison,
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
    grade: comparison.grade,
    intent: previous.intent,
    loopCompleted: previous.loopCompleted,
    predecessorId: previous.id,
    entityVersion: previous.entityVersion,
    timezone: previous.timezone,
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
): Promise<{ error: ReportError } | { snapshot: ReportSnapshotRow; html: string; json: string }> {
  const snapshot = await new ReportDao(db).findSnapshot(ownerId, snapshotId);
  if (!snapshot) return { error: "NOT_FOUND" };
  // Download re-checks the current owner and rejects a frozen brand before any object read.
  const brand = await requireOwnedBrand(db, ownerId, snapshot.brandId);
  if (!brand) return { error: "NOT_FOUND" };
  if (inlineSnapshot(snapshot)) return { snapshot, html: snapshot.htmlBytes, json: snapshot.jsonBytes };
  const stored = await readStoredSnapshot(db, ownerId, snapshot, options);
  if (!stored.ok) return { error: stored.error };
  return { snapshot, html: stored.html, json: stored.json };
}

export async function listReports(db: QueryConnection, ownerId: string, brandId: string, limit = 20) {
  const brand = await requireOwnedBrand(db, ownerId, brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const dao = new ReportDao(db);
  const [retests, snapshots, todos] = await Promise.all([
    dao.listRetests(ownerId, brandId, limit),
    dao.listSnapshots(ownerId, brandId, limit),
    dao.listTodos(ownerId, brandId, limit),
  ]);
  return { retests, snapshots, todos };
}

export type SnapshotCostView =
  | { state: "ready"; cost: SnapshotCost; labor: SnapshotLabor }
  | { state: "absent" }
  | { state: "unavailable" };

export function parseSnapshotCost(json: string): SnapshotCostView {
  try {
    const parsed = JSON.parse(json) as { cost?: unknown; labor?: unknown };
    const cost = snapshotCostSchema.safeParse(parsed?.cost);
    const labor = snapshotLaborSchema.safeParse(parsed?.labor);
    if (!cost.success || !labor.success) return { state: "absent" };
    return { state: "ready", cost: cost.data, labor: labor.data };
  } catch {
    return { state: "unavailable" };
  }
}

/** Read frozen cost and labor from snapshot bytes. A miss is not rewritten as zero. */
export async function snapshotCostViews(
  db: QueryConnection,
  ownerId: string,
  snapshots: readonly ReportSnapshotRow[],
  options: SnapshotStorageOptions = {},
): Promise<Map<string, SnapshotCostView>> {
  const views = new Map<string, SnapshotCostView>();
  const stored: ReportSnapshotRow[] = [];
  for (const snapshot of snapshots) {
    if (inlineSnapshot(snapshot)) views.set(snapshot.id, parseSnapshotCost(snapshot.jsonBytes));
    else stored.push(snapshot);
  }
  if (!stored.length) return views;

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
      for (const row of rows) views.set(row.id, { state: "unavailable" });
      continue;
    }
    const byId = new Map(objects.map((row) => [row.id, row]));
    await Promise.all(rows.map(async (snapshot) => {
      const row = snapshot.jsonObjectId ? byId.get(snapshot.jsonObjectId) : undefined;
      if (!row || row.status !== "ready" || row.class !== "report-snapshot" || row.fileName !== reportJsonName
        || row.sha256 !== snapshot.jsonSha256 || !row.objectKey) {
        views.set(snapshot.id, { state: "unavailable" });
        return;
      }
      try {
        const loaded = await storage.getObject({ key: row.objectKey });
        if (!loaded.ok || loaded.sha256 !== snapshot.jsonSha256) {
          views.set(snapshot.id, { state: "unavailable" });
          return;
        }
        const text = new TextDecoder().decode(loaded.body);
        if (fingerprintBytes(text) !== snapshot.jsonSha256) {
          views.set(snapshot.id, { state: "unavailable" });
          return;
        }
        views.set(snapshot.id, parseSnapshotCost(text));
      } catch {
        views.set(snapshot.id, { state: "unavailable" });
      }
    }));
  }
  return views;
}
