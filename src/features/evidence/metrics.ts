import type { z } from "zod";
import { primaryTypes, questionType } from "../prompts/contracts.ts";
import type { TriState } from "./contracts.ts";

export type MetricKind = "mentioned" | "recommended" | "officialSiteCited" | "ownedPageCited";
export type QuestionType = z.infer<typeof questionType> | "unknown";
export type PlanSlotStatus = "scheduled" | "completed" | "failed" | "paused";
type NetworkMode = "on" | "off" | "unknown";
type NetworkTrigger = "triggered" | "not_triggered" | "unknown";

export type OverviewSample = {
  observationId: string;
  questionKey: string;
  questionText: string;
  questionType: QuestionType;
  sourceMode: "model_api" | "consumer_ui";
  region: string;
  requestedNetworkMode: NetworkMode;
  capturedAt: string;
  evidenceState: "draft_evidence" | "complete" | "incomplete" | "contested";
  citationSetState: "complete" | "partial" | "unsupported" | "missing";
  mentioned: TriState;
  recommended: TriState;
  officialSiteCited: TriState;
  ownedPageCited: TriState;
  hasOfficialWebsite: boolean;
};

export type RateBreakdown = {
  status: "ready" | "na";
  reason: string | null;
  equalWeight: number | null;
  pooled: { numerator: number; denominator: number; rate: number | null };
  coveredQuestions: number;
  fixedQuestions: number;
  unknownRatio: number | null;
  judgedCount: number;
  consideredCount: number;
  citationComplete: number | null;
  citationJudged: number | null;
  perQuestion: Array<{
    questionKey: string;
    questionText: string;
    numerator: number;
    denominator: number;
    rate: number | null;
    unknown: number;
    sampleIds: string[];
  }>;
};

export type OverviewMetrics = {
  viewStatus: "empty" | "partial" | "ready" | "insufficient";
  eligibleCount: number;
  sampleCount: number;
  smallSample: boolean;
  metrics: Record<MetricKind, RateBreakdown>;
  sampleIds: string[];
};

export const overviewMetricKinds = ["mentioned", "recommended", "officialSiteCited", "ownedPageCited"] as const;

export type QuestionMetricCell = {
  numerator: number;
  denominator: number;
  rate: number | null;
  unknown: number;
};

export type QuestionMetricRow = {
  questionKey: string;
  questionText: string;
  cells: Record<MetricKind, QuestionMetricCell>;
};

const PRIMARY = primaryTypes;
const OWNED = new Set(["owned_domain", "owned_account"]);

function labelOf(sample: OverviewSample, kind: MetricKind): TriState {
  return sample[kind];
}

/** Owned-page judgement uses stored citation ownership only. Unknown ownership stays unknown. */
export function ownedPageJudgement(
  citationSetState: OverviewSample["citationSetState"],
  ownerships: readonly string[],
): TriState {
  if (citationSetState !== "complete") return "unknown";
  if (ownerships.some((item) => OWNED.has(item))) return "true";
  if (ownerships.some((item) => item === "unknown")) return "unknown";
  return "false";
}

function isEligible(sample: OverviewSample) {
  return sample.evidenceState === "complete" || sample.evidenceState === "contested";
}

function isPrimaryQuestion(sample: OverviewSample) {
  if (sample.questionType === "unknown") return true;
  return (PRIMARY as Set<string>).has(sample.questionType);
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function blankRate(
  reason: string,
  fixedQuestions: number,
  consideredCount: number,
  citationComplete: number | null,
): RateBreakdown {
  return {
    status: "na",
    reason,
    equalWeight: null,
    pooled: { numerator: 0, denominator: 0, rate: null },
    coveredQuestions: 0,
    fixedQuestions,
    unknownRatio: null,
    judgedCount: 0,
    consideredCount,
    citationComplete,
    citationJudged: citationComplete == null ? null : 0,
    perQuestion: [],
  };
}

function buildMetric(samples: OverviewSample[], kind: MetricKind): RateBreakdown {
  const cites = kind === "officialSiteCited" || kind === "ownedPageCited";
  const population = kind === "officialSiteCited"
    ? samples.filter((item) => item.hasOfficialWebsite)
    : samples;
  const consideredCount = population.length;
  const citationComplete = population.filter((item) => item.citationSetState === "complete").length;
  const citationFields = cites ? citationComplete : null;

  if (kind === "officialSiteCited" && population.length === 0) {
    return blankRate("official-website-not-applicable", 0, 0, 0);
  }

  const byQuestion = new Map<string, OverviewSample[]>();
  for (const sample of population) {
    if (cites && sample.citationSetState !== "complete") continue;
    const list = byQuestion.get(sample.questionKey) ?? [];
    list.push(sample);
    byQuestion.set(sample.questionKey, list);
  }

  const perQuestion: RateBreakdown["perQuestion"] = [];
  let pooledNum = 0;
  let pooledDen = 0;
  let equalSum = 0;
  let equalCount = 0;
  let unknownSlots = 0;
  let judgedSlots = 0;

  for (const [questionKey, group] of byQuestion) {
    let numerator = 0;
    let denominator = 0;
    let unknown = 0;
    const sampleIds: string[] = [];
    for (const sample of group) {
      sampleIds.push(sample.observationId);
      const value = labelOf(sample, kind);
      if (value === "unknown") {
        unknown += 1;
        unknownSlots += 1;
        continue;
      }
      judgedSlots += 1;
      denominator += 1;
      if (value === "true") numerator += 1;
    }
    const questionRate = rate(numerator, denominator);
    if (denominator > 0) {
      equalSum += questionRate ?? 0;
      equalCount += 1;
      pooledNum += numerator;
      pooledDen += denominator;
    }
    perQuestion.push({
      questionKey,
      questionText: group[0]?.questionText ?? questionKey,
      numerator,
      denominator,
      rate: questionRate,
      unknown,
      sampleIds,
    });
  }

  perQuestion.sort((a, b) => a.questionKey.localeCompare(b.questionKey));

  const unknownRatio = judgedSlots + unknownSlots > 0 ? unknownSlots / (judgedSlots + unknownSlots) : null;
  const shared = {
    judgedCount: judgedSlots,
    consideredCount,
    citationComplete: citationFields,
    citationJudged: cites ? judgedSlots : null,
    perQuestion,
  };

  if (equalCount === 0) {
    const reason = kind === "ownedPageCited" && citationComplete > 0 && judgedSlots === 0
      ? "no-judgable-owned-citations"
      : judgedSlots + unknownSlots === 0 ? "no-eligible-samples" : "no-judgable-samples";
    return {
      status: "na",
      reason,
      equalWeight: null,
      pooled: { numerator: 0, denominator: 0, rate: null },
      coveredQuestions: 0,
      fixedQuestions: byQuestion.size,
      unknownRatio,
      ...shared,
    };
  }

  return {
    status: "ready",
    reason: null,
    equalWeight: equalSum / equalCount,
    pooled: { numerator: pooledNum, denominator: pooledDen, rate: rate(pooledNum, pooledDen) },
    coveredQuestions: equalCount,
    fixedQuestions: byQuestion.size,
    unknownRatio,
    ...shared,
  };
}

export function aggregateOverviewMetrics(samples: OverviewSample[]): OverviewMetrics {
  const eligible = samples.filter(isEligible);
  const primary = eligible.filter(isPrimaryQuestion);
  const metrics = {
    mentioned: buildMetric(primary, "mentioned"),
    recommended: buildMetric(primary, "recommended"),
    officialSiteCited: buildMetric(primary, "officialSiteCited"),
    ownedPageCited: buildMetric(primary, "ownedPageCited"),
  } satisfies Record<MetricKind, RateBreakdown>;

  const sampleIds = primary.map((item) => item.observationId);
  let viewStatus: OverviewMetrics["viewStatus"] = "empty";
  if (primary.length === 0) viewStatus = "empty";
  else if (Object.values(metrics).every((item) => item.status === "na")) viewStatus = "insufficient";
  else if (primary.length < 5) viewStatus = "partial";
  else viewStatus = "ready";

  return {
    viewStatus,
    eligibleCount: eligible.length,
    sampleCount: primary.length,
    smallSample: primary.length > 0 && primary.length < 5,
    metrics,
    sampleIds,
  };
}

const emptyQuestionCell = (): QuestionMetricCell => ({
  numerator: 0,
  denominator: 0,
  rate: null,
  unknown: 0,
});

/** Aligns one row per fixed question. A missing metric stays a zero-denominator cell. */
export function questionMetricRows(metrics: Record<MetricKind, RateBreakdown>): QuestionMetricRow[] {
  const indexes = new Map<MetricKind, Map<string, RateBreakdown["perQuestion"][number]>>();
  const questions = new Map<string, string>();
  for (const kind of overviewMetricKinds) {
    const index = new Map<string, RateBreakdown["perQuestion"][number]>();
    for (const row of metrics[kind].perQuestion) {
      index.set(row.questionKey, row);
      if (!questions.has(row.questionKey)) questions.set(row.questionKey, row.questionText);
    }
    indexes.set(kind, index);
  }
  return [...questions.keys()].sort((left, right) => left.localeCompare(right)).map((questionKey) => {
    const cells = {} as Record<MetricKind, QuestionMetricCell>;
    for (const kind of overviewMetricKinds) {
      const row = indexes.get(kind)?.get(questionKey);
      cells[kind] = row
        ? { numerator: row.numerator, denominator: row.denominator, rate: row.rate, unknown: row.unknown }
        : emptyQuestionCell();
    }
    return { questionKey, questionText: questions.get(questionKey) ?? questionKey, cells };
  });
}

export type CoveragePlanSlot = {
  id: string;
  at: string;
  status: PlanSlotStatus;
  sourceMode: "model_api" | "consumer_ui";
  regions: readonly string[];
  networks: readonly NetworkMode[];
};

export type CoverageAnswer = {
  planSlotId: string | null;
  evidenceState: OverviewSample["evidenceState"];
  citationSetState: OverviewSample["citationSetState"];
  requestedNetworkMode: NetworkMode;
  networkTrigger: NetworkTrigger;
  newSession: TriState;
  searchRequired: boolean;
  newSessionRequired: boolean;
};

export type CoverageSummary = {
  status: "ready" | "na";
  reason: "no-frozen-plan-slots" | "no-due-slots" | null;
  planned: number;
  valid: number;
  eligible: number;
  failed: number;
  paused: number;
  pending: number;
  networkUnknown: number;
  validRate: number | null;
  eligibleRate: number | null;
};

function emptyCoverage(reason: CoverageSummary["reason"]): CoverageSummary {
  return {
    status: "na",
    reason,
    planned: 0,
    valid: 0,
    eligible: 0,
    failed: 0,
    paused: 0,
    pending: 0,
    networkUnknown: 0,
    validRate: null,
    eligibleRate: null,
  };
}

function answerQuality(answer: CoverageAnswer) {
  const evidenceOk = answer.evidenceState === "complete" || answer.evidenceState === "contested";
  if (!evidenceOk) return { qualified: false, valid: false, networkUnknown: false };
  const networkRequired = answer.searchRequired || answer.requestedNetworkMode === "on";
  if (networkRequired && answer.networkTrigger === "unknown") {
    return { qualified: false, valid: false, networkUnknown: true };
  }
  const networkOk = !networkRequired || answer.networkTrigger === "triggered";
  const sessionOk = !answer.newSessionRequired || answer.newSession === "true";
  const sourcesOk = answer.citationSetState === "complete";
  if (!networkOk || !sessionOk || !sourcesOk) return { qualified: false, valid: false, networkUnknown: false };
  return { qualified: true, valid: true, networkUnknown: false };
}

function slotInScope(
  slot: CoveragePlanSlot,
  scope: {
    sourceMode: "model_api" | "consumer_ui";
    region?: string;
    requestedNetworkMode?: NetworkMode;
    from?: string;
    to?: string;
  },
) {
  if (slot.sourceMode !== scope.sourceMode) return false;
  if (scope.region && !slot.regions.includes(scope.region)) return false;
  if (scope.requestedNetworkMode && !slot.networks.includes(scope.requestedNetworkMode)) return false;
  if (scope.from && slot.at < scope.from) return false;
  if (scope.to && slot.at > scope.to) return false;
  return true;
}

/** P counts due frozen plan slots. Failed and paused stay in the denominator; future slots do not. */
export function summarizeCoverage(input: {
  slots: readonly CoveragePlanSlot[];
  answers: readonly CoverageAnswer[];
  scope: {
    sourceMode: "model_api" | "consumer_ui";
    region?: string;
    requestedNetworkMode?: NetworkMode;
    from?: string;
    to?: string;
  };
  now: string;
}): CoverageSummary {
  const inScope = input.slots.filter((slot) => slotInScope(slot, input.scope));
  if (inScope.length === 0) return emptyCoverage("no-frozen-plan-slots");
  const due = inScope.filter((slot) => slot.at <= input.now);
  if (due.length === 0) return emptyCoverage("no-due-slots");

  const bySlot = new Map<string, CoverageAnswer[]>();
  for (const answer of input.answers) {
    if (!answer.planSlotId) continue;
    const list = bySlot.get(answer.planSlotId) ?? [];
    list.push(answer);
    bySlot.set(answer.planSlotId, list);
  }

  let valid = 0;
  let eligible = 0;
  let failed = 0;
  let paused = 0;
  let pending = 0;
  let networkUnknown = 0;
  for (const slot of due) {
    if (slot.status === "failed") {
      failed += 1;
      continue;
    }
    if (slot.status === "paused") {
      paused += 1;
      continue;
    }
    if (slot.status === "scheduled") {
      pending += 1;
      continue;
    }
    const qualities = (bySlot.get(slot.id) ?? []).map(answerQuality);
    const qualified = qualities.some((item) => item.qualified);
    const slotValid = qualities.some((item) => item.valid);
    if (qualified) {
      eligible += 1;
      valid += 1;
      continue;
    }
    pending += 1;
    if (slotValid) valid += 1;
    if (qualities.some((item) => item.networkUnknown)) networkUnknown += 1;
  }

  const planned = due.length;
  return {
    status: "ready",
    reason: null,
    planned,
    valid,
    eligible,
    failed,
    paused,
    pending,
    networkUnknown,
    validRate: rate(valid, planned),
    eligibleRate: rate(eligible, planned),
  };
}

export function latestCompleteCapture(samples: readonly { capturedAt: string; evidenceState: string }[]) {
  let latest: string | null = null;
  for (const sample of samples) {
    if (sample.evidenceState !== "complete") continue;
    if (!latest || sample.capturedAt > latest) latest = sample.capturedAt;
  }
  return latest;
}

export function capabilityIsExpired(expiresAt: readonly (string | null)[], now: string) {
  return expiresAt.some((value) => value !== null && value <= now);
}

export function filterSamplesByScope(
  samples: OverviewSample[],
  scope: {
    sourceMode?: "model_api" | "consumer_ui";
    region?: string;
    requestedNetworkMode?: "on" | "off" | "unknown";
    from?: string;
    to?: string;
  },
) {
  return samples.filter((sample) => {
    if (scope.sourceMode && sample.sourceMode !== scope.sourceMode) return false;
    if (scope.region && sample.region !== scope.region) return false;
    if (scope.requestedNetworkMode && sample.requestedNetworkMode !== scope.requestedNetworkMode) return false;
    if (scope.from && sample.capturedAt < scope.from) return false;
    if (scope.to && sample.capturedAt > scope.to) return false;
    return true;
  });
}
