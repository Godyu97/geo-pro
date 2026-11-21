import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { WindowSample } from "../reports/contracts.ts";
import { generateReport, requestRetest } from "../reports/commands.ts";
import { functionalMockMarker } from "./mode.ts";

function mockUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function failed(error: string) {
  return { ok: false as const, error };
}

function windowSamples(brandId: string, entityVersion: number, side: "before" | "after"): WindowSample[] {
  return [1, 2, 3].map((index) => ({
    observationId: mockUuid(`functional-mock:sample:${brandId}:${side}:${index}`),
    queryId: `functional-mock-q${index}`,
    queryVersion: "functional-mock-v1",
    track: "model_api",
    channelVersion: "functional-mock-1",
    protocolVersion: "functional-mock",
    analysisRuleVersion: "functional-mock",
    region: "CN",
    entityVersion,
    judgable: true,
    numerator: side === "after" ? 1 : 0,
    denominator: 1,
    sourceMissing: false,
    brandQuestion: false,
  }));
}

/** Compares two labeled synthetic windows and stores an immutable snapshot. Not an observation. */
export async function applyMockRetest(db: DatabaseConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).version(ownerId, brandId);
  if (!brand) return failed("brand-missing");
  const before = {
    start: "2026-11-01",
    endExclusive: "2026-11-08",
    samples: windowSamples(brandId, brand.entityVersion, "before"),
  };
  const after = {
    start: "2026-11-14",
    endExclusive: "2026-11-21",
    samples: windowSamples(brandId, brand.entityVersion, "after"),
  };
  const requested = await requestRetest(db, ownerId, {
    action: "request-retest",
    brandId,
    operationId: mockUuid(`functional-mock:retest:${brandId}`),
    kind: "exploratory",
    intent: "diagnostic",
    track: "model_api",
    timezone: "Asia/Shanghai",
    entityVersion: brand.entityVersion,
    before,
    after,
    locale: "zh-CN",
    metric: "recommendation_rate",
  });
  if ("error" in requested) return failed(requested.error ?? "retest-missing");
  if (!requested.retest) return failed("retest-missing");
  const retest = requested.retest;

  const brandName = brand.fields.name.includes(functionalMockMarker)
    ? brand.fields.name
    : `${functionalMockMarker} ${brand.fields.name}`;
  const report = await generateReport(db, ownerId, {
    action: "generate-report",
    brandId,
    operationId: mockUuid(`functional-mock:report:${brandId}`),
    retestId: retest.id,
    before,
    after,
    locale: "zh-CN",
    metric: "recommendation_rate",
    brandName,
  });
  if ("error" in report) return failed(report.error ?? "snapshot-missing");
  if (!report.snapshot) return failed("snapshot-missing");
  return {
    ok: true as const,
    mock: true as const,
    retestId: retest.id,
    snapshotId: report.snapshot.id,
    grade: report.snapshot.grade,
  };
}
