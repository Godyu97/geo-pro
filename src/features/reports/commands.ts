import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type {
  GenerateReportInput,
  ReportError,
  RequestRetestInput,
  ReviseReportInput,
} from "./contracts.ts";
import { ReportDao } from "./dao.ts";
import { compareWindows, computeD7DueAt, resolveLoopGate } from "./rules.ts";
import { buildSnapshotDocument, fingerprintBytes, renderSnapshotHtml } from "./snapshot.ts";

type Clock = () => string;
const defaultClock: Clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");

async function requireOwnedBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  if (!brand) return null;
  return brand;
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
  db: QueryConnection,
  ownerId: string,
  input: GenerateReportInput,
  clock: Clock = defaultClock,
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
  });
  const jsonBytes = JSON.stringify(document);
  const htmlBytes = renderSnapshotHtml(document);
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
    jsonBytes,
    htmlBytes,
    jsonSha256: fingerprintBytes(jsonBytes),
    htmlSha256: fingerprintBytes(htmlBytes),
    operationId: input.operationId,
    createdAt: now,
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
  db: QueryConnection,
  ownerId: string,
  input: ReviseReportInput,
  clock: Clock = defaultClock,
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
  });
  const jsonBytes = JSON.stringify(document);
  const htmlBytes = renderSnapshotHtml(document);
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
    jsonBytes,
    htmlBytes,
    jsonSha256: fingerprintBytes(jsonBytes),
    htmlSha256: fingerprintBytes(htmlBytes),
    operationId: input.operationId,
    createdAt: now,
  });

  return {
    snapshot: await dao.findSnapshot(ownerId, snapshotId),
    previous: await dao.findSnapshot(ownerId, previous.id),
    reused: false,
  };
}

export async function readSnapshot(db: QueryConnection, ownerId: string, snapshotId: string) {
  const snapshot = await new ReportDao(db).findSnapshot(ownerId, snapshotId);
  if (!snapshot) return { error: "NOT_FOUND" as ReportError };
  return { snapshot };
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
