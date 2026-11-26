import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryWithParameters, type DatabaseConnection, type QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { ContentDao } from "../content/dao.ts";
import { isTimeZone } from "../sampling-plans/due-window.ts";
import type { ReportError, WindowSample } from "./contracts.ts";
import { reportIntentSchema, reportTrackSchema } from "./contracts.ts";
import { ReportDao } from "./dao.ts";
import {
  generateReport,
  readSnapshot,
  requestRetest,
  reviseReport,
  type SnapshotStorageOptions,
} from "./commands.ts";
import { resolveLoopGate } from "./rules.ts";
import { loadSnapshotComparisons } from "./snapshot-comparisons.ts";
import { orderedWindowBounds, readSavedWindows, windowObservationsQuery, type SavedWindows } from "./window-observations.ts";

const day = z.iso.date();
const localeSchema = z.enum(["zh-CN", "en"]).default("zh-CN");

export const savedComparisonSchema = z.strictObject({
  brandId: brandIdSchema,
  operationId: z.string().uuid(),
  intent: reportIntentSchema,
  track: reportTrackSchema,
  timezone: z.string().min(1).max(80),
  beforeStart: day,
  beforeEnd: day,
  afterStart: day,
  afterEnd: day,
  publicationId: brandIdSchema.optional(),
  locale: localeSchema,
});
export type SavedComparisonInput = z.infer<typeof savedComparisonSchema>;

export const savedReminderSchema = z.strictObject({
  brandId: brandIdSchema,
  operationId: z.string().uuid(),
  track: reportTrackSchema,
  timezone: z.string().min(1).max(80),
  publicationId: brandIdSchema.optional(),
  locale: localeSchema,
});
export type SavedReminderInput = z.infer<typeof savedReminderSchema>;

export const savedGenerateSchema = z.strictObject({
  brandId: brandIdSchema,
  operationId: z.string().uuid(),
  retestId: z.string().uuid(),
  locale: localeSchema,
});
export type SavedGenerateInput = z.infer<typeof savedGenerateSchema>;

export const savedReviseSchema = z.strictObject({
  brandId: brandIdSchema,
  operationId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  locale: localeSchema,
});
export type SavedReviseInput = z.infer<typeof savedReviseSchema>;

type Clock = () => string;

const snapshotWindowSchema = z.object({
  windows: z.object({
    before: z.object({ start: day, endExclusive: day }),
    after: z.object({ start: day, endExclusive: day }),
  }),
});

function carrier(track: WindowSample["track"], entityVersion: number, observationId: string): WindowSample {
  return {
    observationId,
    queryId: observationId,
    queryVersion: "saved",
    track,
    channelVersion: "saved",
    protocolVersion: "saved",
    analysisRuleVersion: "saved",
    region: "CN",
    entityVersion,
    judgable: false,
    numerator: 0,
    denominator: 0,
  };
}

async function ownedBrand(db: QueryConnection, ownerId: string, brandId: string) {
  return new BrandDao(db).owned(ownerId, brandId);
}

async function publicationEffect(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  publicationId: string | undefined,
) {
  if (!publicationId) return { publicationId: null, effectiveAt: null as string | null };
  const row = await new ContentDao(db).getPublication(ownerId, publicationId);
  if (!row || row.brandId !== brandId) return { error: "NOT_FOUND" as const };
  return { publicationId: row.id, effectiveAt: row.effectiveAt };
}

async function idsInWindow(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  track: string,
  window: { start: number; endExclusive: number },
) {
  const query = windowObservationsQuery(ownerId, brandId, track,
    new Date(window.start).toISOString(), new Date(window.endExclusive).toISOString());
  const loaded = await queryWithParameters(db, query.sql, query.values);
  return z.array(z.object({ id: z.string() })).parse(loaded).map((row) => row.id);
}

async function windowIds(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  track: string,
  timezone: string,
  windows: SavedWindows,
) {
  const bounds = orderedWindowBounds(windows, timezone);
  if (bounds.error) return { error: bounds.error };
  const [beforeIds, afterIds] = await Promise.all([
    idsInWindow(db, ownerId, brandId, track, bounds.before),
    idsInWindow(db, ownerId, brandId, track, bounds.after),
  ]);
  if (beforeIds.length === 0 || afterIds.length === 0) {
    return { error: "WINDOWS_MISSING_ANSWERS" as const };
  }
  if (beforeIds.length > 500 || afterIds.length > 500) {
    return { error: "INVALID_INPUT" as const };
  }
  return { beforeIds, afterIds };
}

export async function requestSavedComparison(
  db: DatabaseConnection,
  ownerId: string,
  input: SavedComparisonInput,
  clock: Clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
) {
  const brand = await ownedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const dao = new ReportDao(db);
  const existing = await dao.findRetestByOperation(input.brandId, input.operationId);
  if (existing) {
    return {
      retest: existing,
      comparison: null,
      loopCompleted: existing.intent === "business_loop" && Boolean(existing.effectiveAt),
      downgraded: false,
      reused: true,
    };
  }

  const publication = await publicationEffect(db, ownerId, input.brandId, input.publicationId);
  if ("error" in publication) return { error: publication.error };

  const windows: SavedWindows = {
    before: { start: input.beforeStart, endExclusive: input.beforeEnd },
    after: { start: input.afterStart, endExclusive: input.afterEnd },
  };
  const ids = await windowIds(db, ownerId, input.brandId, input.track, input.timezone, windows);
  if ("error" in ids) return { error: ids.error };

  const gate = resolveLoopGate({
    requestedIntent: input.intent,
    effectiveAt: publication.effectiveAt,
  });
  const scope = { track: input.track, entityVersion: brand.entityVersion, timezone: input.timezone };
  let metrics: Awaited<ReturnType<typeof loadSnapshotComparisons>>;
  try {
    metrics = await loadSnapshotComparisons(db, ownerId, input.brandId, {
      before: { ...windows.before, samples: ids.beforeIds.map((id) => carrier(input.track, brand.entityVersion, id)) },
      after: { ...windows.after, samples: ids.afterIds.map((id) => carrier(input.track, brand.entityVersion, id)) },
    }, scope);
  } catch {
    console.error("report-comparison-read-failed", { brandId: input.brandId });
    return { error: "SERVICE_UNAVAILABLE" as ReportError };
  }

  const comparison = metrics.comparisons.recommendation_rate.result;
  const now = clock();
  const retestId = randomUUID();
  await dao.insertRetest({
    id: retestId,
    brandId: input.brandId,
    ownerId,
    kind: gate.allowedIntent === "diagnostic" ? "diagnostic" : "exploratory",
    status: comparison.grade === "incomparable" ? "inconclusive" : "completed",
    intent: gate.allowedIntent,
    track: input.track,
    timezone: input.timezone,
    entityVersion: brand.entityVersion,
    beforeRunId: null,
    afterRunId: null,
    publicationId: publication.effectiveAt ? publication.publicationId : null,
    effectiveAt: publication.effectiveAt,
    operationId: input.operationId,
    comparisonJson: JSON.stringify({ source: "saved-observations", windows, comparison }),
    blockReason: gate.reason,
    createdAt: now,
    updatedAt: now,
  });
  const retest = await dao.findRetest(ownerId, retestId);
  if (!retest) return { error: "SERVICE_UNAVAILABLE" as ReportError };
  return {
    retest,
    comparison,
    loopCompleted: gate.loopCompleted,
    downgraded: input.intent === "business_loop" && gate.allowedIntent === "diagnostic",
    reused: false,
  };
}

export async function requestSavedReminder(
  db: QueryConnection,
  ownerId: string,
  input: SavedReminderInput,
  clock?: Clock,
) {
  const brand = await ownedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const publication = await publicationEffect(db, ownerId, input.brandId, input.publicationId);
  if ("error" in publication) return { error: publication.error };
  if (!publication.effectiveAt || !publication.publicationId) return { error: "LOOP_NOT_READY" as ReportError };
  if (!isTimeZone(input.timezone)) return { error: "INVALID_INPUT" as ReportError };
  return requestRetest(db, ownerId, {
    action: "request-retest",
    brandId: input.brandId,
    operationId: input.operationId,
    kind: "d7_reminder",
    intent: "business_loop",
    track: input.track,
    timezone: input.timezone,
    entityVersion: brand.entityVersion,
    before: {
      start: "1970-01-01",
      endExclusive: "1970-01-02",
      samples: [carrier(input.track, brand.entityVersion, "00000000-0000-4000-8000-000000000000")],
    },
    publicationId: publication.publicationId,
    effectiveAt: publication.effectiveAt,
    locale: input.locale,
    metric: "recommendation_rate",
  }, clock);
}

async function brandName(db: QueryConnection, ownerId: string, brandId: string, fallback: string) {
  const version = await new BrandDao(db).version(ownerId, brandId);
  return version?.fields.name || fallback;
}

export async function generateSavedSnapshot(
  db: DatabaseConnection,
  ownerId: string,
  input: SavedGenerateInput,
  clock?: Clock,
  options: SnapshotStorageOptions = {},
) {
  const brand = await ownedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const dao = new ReportDao(db);
  const retest = await dao.findRetest(ownerId, input.retestId);
  if (!retest || retest.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  if (retest.kind === "d7_reminder" || (retest.status !== "completed" && retest.status !== "inconclusive")) {
    return { error: "CONFLICT" as ReportError };
  }
  if (await dao.findCreatedSnapshotForRetest(ownerId, retest.id)) return { error: "CONFLICT" as ReportError };
  const windows = readSavedWindows(retest.comparisonJson);
  if (!windows) return { error: "INVALID_INPUT" as ReportError };
  const ids = await windowIds(db, ownerId, input.brandId, retest.track, retest.timezone, windows);
  if ("error" in ids) return { error: ids.error };
  const effectiveAt = z.iso.datetime({ precision: 3 }).safeParse(retest.effectiveAt).success ? retest.effectiveAt ?? undefined : undefined;
  return generateReport(db, ownerId, {
    action: "generate-report",
    brandId: input.brandId,
    operationId: input.operationId,
    retestId: retest.id,
    before: {
      ...windows.before,
      samples: ids.beforeIds.map((id) => carrier(retest.track, retest.entityVersion, id)),
    },
    after: {
      ...windows.after,
      samples: ids.afterIds.map((id) => carrier(retest.track, retest.entityVersion, id)),
    },
    ...(retest.intent === "business_loop" && retest.publicationId && effectiveAt
      ? { publicationId: retest.publicationId, effectiveAt }
      : {}),
    locale: input.locale,
    metric: "recommendation_rate",
    brandName: await brandName(db, ownerId, input.brandId, brand.id),
  }, clock, options);
}

export async function reviseSavedSnapshot(
  db: DatabaseConnection,
  ownerId: string,
  input: SavedReviseInput,
  clock?: Clock,
  options: SnapshotStorageOptions = {},
) {
  const brand = await ownedBrand(db, ownerId, input.brandId);
  if (!brand) return { error: "NOT_FOUND" as ReportError };
  const dao = new ReportDao(db);
  const current = await dao.findSnapshot(ownerId, input.snapshotId);
  if (!current || current.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  if (current.status !== "created") return { error: "CONFLICT" as ReportError };
  const retest = await dao.findRetest(ownerId, current.retestId);
  if (!retest || retest.brandId !== input.brandId) return { error: "NOT_FOUND" as ReportError };
  const opened = await readSnapshot(db, ownerId, current.id, options);
  if ("error" in opened) return opened;
  let windows: SavedWindows;
  try {
    windows = snapshotWindowSchema.parse(JSON.parse(opened.json)).windows;
  } catch {
    return { error: "INVALID_INPUT" as ReportError };
  }
  const ids = await windowIds(db, ownerId, input.brandId, retest.track, current.timezone, windows);
  if ("error" in ids) return { error: ids.error };
  return reviseReport(db, ownerId, {
    action: "revise-report",
    brandId: input.brandId,
    operationId: input.operationId,
    snapshotId: current.id,
    before: {
      ...windows.before,
      samples: ids.beforeIds.map((id) => carrier(retest.track, current.entityVersion, id)),
    },
    after: {
      ...windows.after,
      samples: ids.afterIds.map((id) => carrier(retest.track, current.entityVersion, id)),
    },
    locale: input.locale,
    metric: "recommendation_rate",
    brandName: await brandName(db, ownerId, input.brandId, brand.id),
    note: "analysis-label-correction",
  }, clock, options);
}
