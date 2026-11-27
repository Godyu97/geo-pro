import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { readSnapshot, type SnapshotStorageOptions } from "../reports/commands.ts";
import { ReportDao } from "../reports/dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { TeamAccessDao } from "../team-access/dao.ts";
import { brandDutyAllows } from "../team-access/rules.ts";
import { whitelabelReport } from "./billing.ts";
import {
  hasGuaranteeCopy,
  shareSampleMax,
  type RegisterShareInput,
  type ShareRead,
  type ShareSampleSummary,
  type ShareView,
  type ShareWorkspace,
} from "./share-contracts.ts";
import { ShareDao } from "./share-dao.ts";

function clock() {
  return new Date().toISOString();
}

const comparisonMetricSchema = z.object({
  common_query_count: z.number().int().min(0).max(shareSampleMax).default(0),
  frozen_query_count: z.number().int().min(0).max(shareSampleMax).default(0),
  before_sample_count: z.number().int().min(0).max(shareSampleMax).default(0),
  after_sample_count: z.number().int().min(0).max(shareSampleMax).default(0),
});

const snapshotDocumentSchema = z.object({
  grade: z.enum(["exploratory", "incomparable"]).optional(),
  intent: z.enum(["business_loop", "diagnostic"]).optional(),
  loop_completed: z.boolean().optional(),
  source_missing: z.boolean().optional(),
  limitations: z.array(z.string().min(1).max(500)).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  comparisons: z.object({
    recommendation_rate: comparisonMetricSchema.optional(),
    mention_rate: comparisonMetricSchema.optional(),
    official_site_citation_rate: comparisonMetricSchema.optional(),
  }).optional(),
});

function extractSnapshotShareDetails(
  jsonText: string,
  snapshot: {
    grade: "exploratory" | "incomparable";
    intent: "business_loop" | "diagnostic";
    loopCompleted: number;
    sourceMissing: number;
  },
  liveSourceMissing: boolean,
): { sampleSize: number; sampleSummary: ShareSampleSummary; limitations: string[] } {
  let parsedDoc: z.infer<typeof snapshotDocumentSchema> = {};
  try {
    const candidate = snapshotDocumentSchema.safeParse(JSON.parse(jsonText));
    if (candidate.success) parsedDoc = candidate.data;
  } catch {
    // Fall back to snapshot metadata when legacy bytes cannot be parsed as JSON.
  }
  const primary = parsedDoc.comparisons?.recommendation_rate
    ?? parsedDoc.comparisons?.mention_rate
    ?? parsedDoc.comparisons?.official_site_citation_rate;
  const evidenceCount = parsedDoc.evidence ? Object.keys(parsedDoc.evidence).length : 0;
  const beforeSampleCount = primary?.before_sample_count ?? 0;
  const afterSampleCount = primary?.after_sample_count ?? 0;
  const commonQueryCount = primary?.common_query_count ?? 0;
  const frozenQueryCount = primary?.frozen_query_count ?? 0;
  const sampleSize = primary ? beforeSampleCount + afterSampleCount : evidenceCount;
  const loopCompleted = parsedDoc.loop_completed ?? snapshot.loopCompleted === 1;
  const sourceMissing = liveSourceMissing || Boolean(parsedDoc.source_missing) || snapshot.sourceMissing === 1;

  const limitations = (parsedDoc.limitations ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !hasGuaranteeCopy(line));
  if (limitations.length === 0) {
    limitations.push(snapshot.grade === "exploratory" ? "小样本探索，不代表稳定趋势" : "共同可判断题不足 3，不可比较");
    limitations.push(loopCompleted ? "存在核验生效点，可记经营闭环观察" : "无核验生效或仅为诊断复跑，经营闭环未完成");
  }
  const sourceNote = "部分源证据缺失，快照仍保留原字节但标注来源不可复核";
  if (sourceMissing && !limitations.includes(sourceNote)) {
    limitations.push(sourceNote);
  }

  return {
    sampleSize,
    sampleSummary: {
      beforeSampleCount,
      afterSampleCount,
      commonQueryCount,
      frozenQueryCount,
      evidenceCount,
      intent: parsedDoc.intent ?? snapshot.intent,
      loopCompleted,
      sourceMissing,
    },
    limitations,
  };
}

export async function loadShareWorkspace(
  db: QueryConnection,
  actorId: string,
  now = clock(),
): Promise<ShareWorkspace> {
  const dao = new ShareDao(db);
  const accessDao = new TeamAccessDao(db);
  const accessible = await accessDao.accessibleBrands(actorId, now);
  const archivedOwned = await dao.archivedOwnedBrandIds(actorId);
  const writableBrandIds = accessible
    .filter((row) => brandDutyAllows(row.role, "write"))
    .map((row) => row.brandId);
  const readableBrandIds = [...new Set([
    ...accessible.map((row) => row.brandId),
    ...archivedOwned.map((row) => row.id),
  ])];

  const [labels, shares, snapshots] = await Promise.all([
    accessDao.brandLabels(accessible.map((row) => row.brandId)),
    dao.sharesForBrands(readableBrandIds),
    dao.snapshotsForBrands(writableBrandIds),
  ]);

  const activeNameMap = new Map(labels.map((row) => [row.brandId, row.name]));
  const brands = writableBrandIds.map((id) => ({ id, name: activeNameMap.get(id) ?? id }));
  const brandNames: Record<string, string> = {};
  for (const label of labels) brandNames[label.brandId] = label.name;

  return {
    shares,
    brands,
    writableBrandIds,
    brandNames,
    snapshots,
  };
}

export async function registerWhitelabelShare(
  db: DatabaseConnection,
  actorId: string,
  input: RegisterShareInput,
  now = clock(),
  options: SnapshotStorageOptions = {},
): Promise<{ error: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "SERVICE_UNAVAILABLE" } | { share: ShareRead }> {
  if (input.expiresAt <= now) return { error: "INVALID_INPUT" };
  const writeScope = await authorizeBrandActor(db, actorId, input.brandId, "write", now);
  if (!writeScope) {
    const readScope = await authorizeBrandActor(db, actorId, input.brandId, "read", now);
    return { error: readScope ? "FORBIDDEN" : "NOT_FOUND" };
  }

  const opened = await readSnapshot(db, actorId, input.snapshotId, options);
  if ("error" in opened) {
    return { error: opened.error === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "NOT_FOUND" };
  }
  if (opened.snapshot.brandId !== input.brandId || opened.snapshot.ownerId !== writeScope.ownerId) {
    return { error: "NOT_FOUND" };
  }

  const retest = await new ReportDao(db).findRetest(writeScope.ownerId, opened.snapshot.retestId);
  if (!retest || retest.brandId !== input.brandId) return { error: "NOT_FOUND" };

  const details = extractSnapshotShareDetails(opened.json, opened.snapshot, opened.source.sourceMissing);
  const report = whitelabelReport({
    track: retest.track,
    sampleSize: details.sampleSize,
    grade: opened.snapshot.grade,
  });

  const dao = new ShareDao(db);
  const labels = await new TeamAccessDao(db).brandLabels([input.brandId]);
  const brandName = labels[0]?.name ?? input.brandId;
  const id = randomUUID();
  const inserted = await dao.insertForBrand({
    id,
    brandId: input.brandId,
    ownerId: writeScope.ownerId,
    snapshotId: opened.snapshot.id,
    track: report.track,
    sampleSize: report.sampleSize,
    grade: report.grade,
    limitationsJson: JSON.stringify(details.limitations),
    sampleSummaryJson: JSON.stringify(details.sampleSummary),
    expiresAt: input.expiresAt,
    createdAt: now,
  });
  if (!inserted) return { error: "NOT_FOUND" };

  return {
    share: {
      id,
      brandId: input.brandId,
      brandName,
      snapshotId: opened.snapshot.id,
      track: report.track,
      sampleSize: report.sampleSize,
      sampleSummary: details.sampleSummary,
      grade: report.grade,
      limitations: details.limitations,
      expiresAt: input.expiresAt,
      revoked: 0,
      createdAt: now,
    },
  };
}

export async function viewWhitelabelShare(
  db: QueryConnection,
  actorId: string,
  shareId: string,
  now = clock(),
): Promise<{ error: "NOT_FOUND" } | { share: ShareRead }> {
  const dao = new ShareDao(db);
  const share = await dao.shareById(shareId);
  if (!share || share.revoked === 1 || share.expiresAt <= now) return { error: "NOT_FOUND" };

  const scope = await authorizeBrandActor(db, actorId, share.brandId, "read", now);
  if (!scope || scope.ownerId !== share.ownerId) return { error: "NOT_FOUND" };

  const recorded = await dao.insertAccess({ id: randomUUID(), shareId, visitorId: actorId, accessedAt: now });
  if (!recorded) return { error: "NOT_FOUND" };

  return {
    share: {
      id: share.id,
      brandId: share.brandId,
      brandName: share.brandName,
      snapshotId: share.snapshotId,
      track: share.track,
      sampleSize: share.sampleSize,
      sampleSummary: share.sampleSummary,
      grade: share.grade,
      limitations: share.limitations,
      expiresAt: share.expiresAt,
      revoked: 0,
      createdAt: share.createdAt,
    },
  };
}

export async function revokeWhitelabelShare(
  db: QueryConnection,
  actorId: string,
  shareId: string,
  now = clock(),
): Promise<{ error: "FORBIDDEN" | "NOT_FOUND" } | { share: { id: string; revoked: 1 } }> {
  const dao = new ShareDao(db);
  const share = await dao.shareById(shareId);
  if (!share) return { error: "NOT_FOUND" };

  const writeScope = await authorizeBrandActor(db, actorId, share.brandId, "write", now);
  if (!writeScope) {
    const readScope = await authorizeBrandActor(db, actorId, share.brandId, "read", now);
    return { error: readScope ? "FORBIDDEN" : "NOT_FOUND" };
  }
  if (writeScope.ownerId !== share.ownerId) return { error: "NOT_FOUND" };

  const revoked = await dao.revokeForBrand(shareId, share.brandId);
  if (!revoked) return { error: "NOT_FOUND" };
  return { share: { id: shareId, revoked: 1 } };
}

export async function sharesOwnedBy(db: QueryConnection, ownerId: string): Promise<ShareView[]> {
  return new ShareDao(db).sharesForOwner(ownerId);
}
