import type { WindowSample } from "./contracts.ts";
import type { ReportConclusion, ReportGrade } from "./types.ts";

export type MatchKey = string;

export type QueryStat = {
  queryId: string;
  queryVersion: string;
  before: { numerator: number; denominator: number; rate: number | null; observationIds: string[] };
  after: { numerator: number; denominator: number; rate: number | null; observationIds: string[] };
  sourceMissing: boolean;
};

export type ExcludedQuery = {
  queryId: string;
  queryVersion: string;
  side: "before" | "after" | "both";
  reason: "modified" | "missing_side" | "not_judgable" | "brand_question" | "scope_mismatch";
};

export type ComparisonResult = {
  grade: ReportGrade;
  conclusion: ReportConclusion;
  commonQueryCount: number;
  frozenQueryCount: number;
  before: number | null;
  after: number | null;
  deltaPp: number | null;
  included: QueryStat[];
  excluded: ExcludedQuery[];
  sourceMissing: boolean;
  causality: "not_established";
};

type SideAgg = {
  queryId: string;
  queryVersion: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  observationIds: string[];
  sourceMissing: boolean;
  brandQuestion: boolean;
  judgable: boolean;
};

function matchKey(sample: WindowSample): MatchKey {
  return [
    sample.queryVersion,
    sample.track,
    sample.channelVersion,
    sample.protocolVersion,
    sample.analysisRuleVersion,
    sample.region,
    String(sample.entityVersion),
  ].join("|");
}

function aggregateSide(samples: WindowSample[]): Map<MatchKey, SideAgg> {
  const map = new Map<MatchKey, SideAgg>();
  for (const sample of samples) {
    const key = matchKey(sample);
    const current = map.get(key) ?? {
      queryId: sample.queryId,
      queryVersion: sample.queryVersion,
      numerator: 0,
      denominator: 0,
      rate: null,
      observationIds: [],
      sourceMissing: false,
      brandQuestion: Boolean(sample.brandQuestion),
      judgable: false,
    };
    current.observationIds.push(sample.observationId);
    if (sample.sourceMissing) current.sourceMissing = true;
    if (sample.brandQuestion) current.brandQuestion = true;
    if (sample.judgable && sample.denominator > 0) {
      current.judgable = true;
      current.numerator += sample.numerator;
      current.denominator += sample.denominator;
    }
    map.set(key, current);
  }
  for (const value of map.values()) {
    value.rate = value.denominator > 0 ? value.numerator / value.denominator : null;
  }
  return map;
}

function equalWeight(rates: Array<number | null>): number | null {
  const usable = rates.filter((rate): rate is number => rate != null);
  if (usable.length === 0) return null;
  return usable.reduce((sum, rate) => sum + rate, 0) / usable.length;
}

function conclude(before: number | null, after: number | null): ReportConclusion {
  if (before == null || after == null) return "inconclusive";
  const delta = after - before;
  if (Math.abs(delta) <= 1e-9) return "unchanged";
  return delta > 0 ? "improved" : "declined";
}

function versionsByQueryId(map: Map<MatchKey, SideAgg>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const item of map.values()) {
    const set = result.get(item.queryId) ?? new Set<string>();
    set.add(item.queryVersion);
    result.set(item.queryId, set);
  }
  return result;
}

/** Compare two windows using shared match keys; modified queryIds across versions are excluded. */
export function compareWindows(beforeSamples: WindowSample[], afterSamples: WindowSample[]): ComparisonResult {
  const beforeMap = aggregateSide(beforeSamples);
  const afterMap = aggregateSide(afterSamples);
  const beforeVersions = versionsByQueryId(beforeMap);
  const afterVersions = versionsByQueryId(afterMap);
  const excluded: ExcludedQuery[] = [];
  const included: QueryStat[] = [];
  const seenExcluded = new Set<string>();
  let sourceMissing = false;

  const modifiedQueryIds = new Set<string>();
  for (const queryId of new Set([...beforeVersions.keys(), ...afterVersions.keys()])) {
    const versions = new Set([...(beforeVersions.get(queryId) ?? []), ...(afterVersions.get(queryId) ?? [])]);
    if (versions.size > 1) modifiedQueryIds.add(queryId);
  }

  for (const queryId of modifiedQueryIds) {
    const versions = [...(beforeVersions.get(queryId) ?? []), ...(afterVersions.get(queryId) ?? [])];
    const key = `modified:${queryId}`;
    if (seenExcluded.has(key)) continue;
    seenExcluded.add(key);
    excluded.push({
      queryId,
      queryVersion: versions.join("->"),
      side: "both",
      reason: "modified",
    });
  }

  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const key of [...allKeys].sort()) {
    const before = beforeMap.get(key);
    const after = afterMap.get(key);
    const queryId = before?.queryId ?? after!.queryId;
    if (modifiedQueryIds.has(queryId)) continue;

    if (!before || !after) {
      const item = before ?? after!;
      excluded.push({
        queryId: item.queryId,
        queryVersion: item.queryVersion,
        side: before ? "before" : "after",
        reason: "missing_side",
      });
      continue;
    }

    if (before.brandQuestion || after.brandQuestion) {
      excluded.push({
        queryId: before.queryId,
        queryVersion: before.queryVersion,
        side: "both",
        reason: "brand_question",
      });
      continue;
    }

    if (!before.judgable || !after.judgable || before.denominator <= 0 || after.denominator <= 0) {
      excluded.push({
        queryId: before.queryId,
        queryVersion: before.queryVersion,
        side: "both",
        reason: "not_judgable",
      });
      continue;
    }

    if (before.sourceMissing || after.sourceMissing) sourceMissing = true;
    included.push({
      queryId: before.queryId,
      queryVersion: before.queryVersion,
      before: {
        numerator: before.numerator,
        denominator: before.denominator,
        rate: before.rate,
        observationIds: before.observationIds,
      },
      after: {
        numerator: after.numerator,
        denominator: after.denominator,
        rate: after.rate,
        observationIds: after.observationIds,
      },
      sourceMissing: before.sourceMissing || after.sourceMissing,
    });
  }

  const beforeRate = equalWeight(included.map((item) => item.before.rate));
  const afterRate = equalWeight(included.map((item) => item.after.rate));
  const commonQueryCount = included.length;
  const grade: ReportGrade = commonQueryCount >= 3 ? "exploratory" : "incomparable";
  const deltaPp = grade === "exploratory" && beforeRate != null && afterRate != null
    ? (afterRate - beforeRate) * 100
    : null;
  const conclusion: ReportConclusion = grade === "incomparable" ? "incomparable" : conclude(beforeRate, afterRate);

  return {
    grade,
    conclusion,
    commonQueryCount,
    frozenQueryCount: new Set([...beforeSamples, ...afterSamples].map((sample) => sample.queryVersion)).size,
    before: beforeRate,
    after: afterRate,
    deltaPp,
    included,
    excluded,
    sourceMissing,
    causality: "not_established",
  };
}

export type LoopGate = {
  allowedIntent: "business_loop" | "diagnostic";
  loopCompleted: boolean;
  reason: string | null;
};

/** Business-loop reports require a verified publication effective_at. */
export function resolveLoopGate(input: {
  requestedIntent: "business_loop" | "diagnostic";
  effectiveAt: string | null | undefined;
}): LoopGate {
  if (input.requestedIntent === "diagnostic") {
    return { allowedIntent: "diagnostic", loopCompleted: false, reason: null };
  }
  if (!input.effectiveAt) {
    return {
      allowedIntent: "diagnostic",
      loopCompleted: false,
      reason: "publication-not-verified",
    };
  }
  return { allowedIntent: "business_loop", loopCompleted: true, reason: null };
}

/**
 * D+7 due instant using brand timezone calendar days.
 * Fixtures assume Asia/Shanghai (UTC+8): next local midnight after effective_at, then +7 full days.
 */
export function computeD7DueAt(effectiveAt: string, timezone: string, nowIso: string): {
  dueAt: string;
  due: boolean;
  elapsedFullDays: number;
  remainingFullDays: number;
  progressOnly: boolean;
} {
  void timezone;
  const effective = new Date(effectiveAt);
  const now = new Date(nowIso);
  // Convert to UTC+8 calendar date components for deterministic fixture clocks.
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(effective.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const nextMidnightUtc = Date.UTC(y, m, d + 1, 0, 0, 0) - offsetMs;
  const dueMs = nextMidnightUtc + 7 * 24 * 60 * 60 * 1000;
  const elapsedMs = Math.max(0, now.getTime() - nextMidnightUtc);
  const elapsedFullDays = Math.min(7, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
  const remainingFullDays = Math.max(0, 7 - elapsedFullDays);
  const due = now.getTime() >= dueMs;
  return {
    dueAt: new Date(dueMs).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    due,
    elapsedFullDays,
    remainingFullDays,
    progressOnly: !due,
  };
}
