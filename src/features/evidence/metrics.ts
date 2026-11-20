import type { z } from "zod";
import { primaryTypes, questionType } from "../prompts/contracts.ts";
import type { TriState } from "./contracts.ts";

export type MetricKind = "mentioned" | "recommended" | "officialSiteCited";
export type QuestionType = z.infer<typeof questionType> | "unknown";

export type OverviewSample = {
  observationId: string;
  questionKey: string;
  questionText: string;
  questionType: QuestionType;
  sourceMode: "model_api" | "consumer_ui";
  region: string;
  requestedNetworkMode: "on" | "off" | "unknown";
  capturedAt: string;
  evidenceState: "draft_evidence" | "complete" | "incomplete" | "contested";
  citationSetState: "complete" | "partial" | "unsupported" | "missing";
  mentioned: TriState;
  recommended: TriState;
  officialSiteCited: TriState;
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

const PRIMARY = primaryTypes;

function labelOf(sample: OverviewSample, kind: MetricKind): TriState {
  return sample[kind];
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

function buildMetric(samples: OverviewSample[], kind: MetricKind): RateBreakdown {
  if (kind === "officialSiteCited" && samples.every((item) => !item.hasOfficialWebsite)) {
    return {
      status: "na",
      reason: "official-website-not-applicable",
      equalWeight: null,
      pooled: { numerator: 0, denominator: 0, rate: null },
      coveredQuestions: 0,
      fixedQuestions: 0,
      unknownRatio: null,
      perQuestion: [],
    };
  }

  const byQuestion = new Map<string, OverviewSample[]>();
  for (const sample of samples) {
    if (kind === "officialSiteCited" && !sample.hasOfficialWebsite) continue;
    if (kind === "officialSiteCited" && sample.citationSetState !== "complete") continue;
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

  if (equalCount === 0) {
    return {
      status: "na",
      reason: judgedSlots + unknownSlots === 0 ? "no-eligible-samples" : "no-judgable-samples",
      equalWeight: null,
      pooled: { numerator: 0, denominator: 0, rate: null },
      coveredQuestions: 0,
      fixedQuestions: byQuestion.size,
      unknownRatio: judgedSlots + unknownSlots > 0 ? unknownSlots / (judgedSlots + unknownSlots) : null,
      perQuestion,
    };
  }

  return {
    status: "ready",
    reason: null,
    equalWeight: equalSum / equalCount,
    pooled: { numerator: pooledNum, denominator: pooledDen, rate: rate(pooledNum, pooledDen) },
    coveredQuestions: equalCount,
    fixedQuestions: byQuestion.size,
    unknownRatio: judgedSlots + unknownSlots > 0 ? unknownSlots / (judgedSlots + unknownSlots) : null,
    perQuestion,
  };
}

export function aggregateOverviewMetrics(samples: OverviewSample[]): OverviewMetrics {
  const eligible = samples.filter(isEligible);
  const primary = eligible.filter(isPrimaryQuestion);
  const metrics = {
    mentioned: buildMetric(primary, "mentioned"),
    recommended: buildMetric(primary, "recommended"),
    officialSiteCited: buildMetric(primary, "officialSiteCited"),
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
