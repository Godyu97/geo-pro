import { isTimeZone, windowBounds } from "../sampling-plans/due-window.ts";

export type Checkpoint = "d7" | "d14" | "d28";

const checkpointDays: Record<Checkpoint, number> = { d7: 7, d14: 14, d28: 28 };

export function checkpointDue(input: { effectiveOn: string; today: string; checkpoint: Checkpoint }) {
  const start = Date.parse(`${input.effectiveOn}T00:00:00Z`);
  const today = Date.parse(`${input.today}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(today)) return false;
  const elapsedDays = Math.floor((today - start) / 86_400_000);
  // The window starts the day after effective and lasts N full days, so it is due on day N+1.
  return elapsedDays >= checkpointDays[input.checkpoint] + 1;
}

export type FormalMetricKey = "mention" | "recommendation" | "citation";
export type FormalGateKey = "coverage" | FormalMetricKey;
export type FormalExclusionReason =
  | "missing_window"
  | "low_eligible_coverage"
  | "low_mention_coverage"
  | "low_recommendation_coverage"
  | "incomplete_citations"
  | "low_citation_coverage"
  | "no_official_website"
  | "caller_excluded";
export type FormalInsufficiencyReason =
  | "missing_samples"
  | "overall_coverage_below_90"
  | "mention_common_below_80"
  | "mention_coverage_below_80"
  | "recommendation_common_below_80"
  | "recommendation_coverage_below_80"
  | "citation_common_below_80"
  | "citation_coverage_below_80"
  | "no_official_website";

export type FormalSlotSample = {
  slotId: string;
  runId: string;
  questionId: string;
  naturalQuestion: boolean;
  slotStatus: string;
  slotCreatedAt: string;
  timezone: string;
  observation: {
    id: string;
    capturedAt: string;
    evidenceState: string;
    citationSetState: string;
    requestedNetworkMode: string;
    networkTrigger: string;
    newSession: string;
    targetRegion: string;
    observedRegion: string;
    entityVersion: number;
    searchRequired: boolean;
    newSessionRequired: boolean;
    protocolRegion: string | null;
  } | null;
  analysis: {
    id: string;
    version: number;
    entityVersion: number;
    ruleVersion: string;
    status: string;
    mentioned: "true" | "false" | "unknown";
    recommended: "true" | "false" | "unknown";
    officialSiteCited: "true" | "false" | "unknown";
  } | null;
};

export type WindowCoverageReading = {
  planned: number;
  valid: number;
  eligible: number;
  rate: number | null;
};

export type MetricJudgmentReading = {
  judged: number;
  eligible: number;
  rate: number | null;
};

export type CitationJudgmentReading = {
  judged: number;
  completeCitations: number;
  eligible: number;
  jcOverE: number | null;
  cOverE: number | null;
  jcOverC: number | null;
};

export type ExcludedQuestionDetail = {
  questionId: string;
  reasons: FormalExclusionReason[];
};

export type FormalCheckpointEvaluation = {
  missingSamples: boolean;
  hasOfficialWebsite: boolean;
  slotIds: string[];
  coverage: {
    before: WindowCoverageReading;
    after: WindowCoverageReading;
    passed: boolean;
  };
  metrics: {
    mention: {
      passed: boolean;
      comparableCount: number;
      frozenNonBrandCount: number;
      before: MetricJudgmentReading;
      after: MetricJudgmentReading;
      excluded: Array<{ questionId: string; reason: FormalExclusionReason }>;
    };
    recommendation: {
      passed: boolean;
      comparableCount: number;
      frozenNonBrandCount: number;
      before: MetricJudgmentReading;
      after: MetricJudgmentReading;
      excluded: Array<{ questionId: string; reason: FormalExclusionReason }>;
    };
    citation: {
      passed: boolean;
      applicable: boolean;
      comparableCount: number;
      frozenNonBrandCount: number;
      before: CitationJudgmentReading;
      after: CitationJudgmentReading;
      excluded: Array<{ questionId: string; reason: FormalExclusionReason }>;
    };
  };
  insufficientMetrics: FormalGateKey[];
  insufficiencyReasons: FormalInsufficiencyReason[];
  excludedQuestions: ExcludedQuestionDetail[];
};

function addCalendarDays(day: string, deltaDays: number) {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return new Date(parsed + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function windowInstants(startDay: string, endExclusiveDay: string, timeZone: string) {
  if (timeZone === "UTC" || !isTimeZone(timeZone)) {
    const start = Date.parse(`${startDay}T00:00:00.000Z`);
    const end = Date.parse(`${endExclusiveDay}T00:00:00.000Z`);
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  }
  const startBounds = windowBounds(startDay, timeZone);
  const endBounds = windowBounds(endExclusiveDay, timeZone);
  if (!startBounds || !endBounds) return null;
  return { start: Date.parse(startBounds.start), end: Date.parse(endBounds.start) };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function meetsNinetyPercent(numerator: number, denominator: number) {
  return denominator > 0 && numerator * 10 >= denominator * 9;
}

function meetsEightyPercent(numerator: number, denominator: number) {
  return denominator > 0 && numerator * 5 >= denominator * 4;
}

type QuestionBucket = {
  planned: number;
  valid: number;
  eligible: number;
  jm: number;
  jr: number;
  c: number;
  jc: number;
};

function emptyBucket(): QuestionBucket {
  return { planned: 0, valid: 0, eligible: 0, jm: 0, jr: 0, c: 0, jc: 0 };
}

function slotEligible(slot: FormalSlotSample, winStart: number, winEnd: number) {
  if (slot.slotStatus !== "succeeded" || !slot.observation) return { valid: false, eligible: false };
  const captured = Date.parse(slot.observation.capturedAt);
  if (!Number.isFinite(captured) || captured < winStart || captured >= winEnd) {
    return { valid: false, eligible: false };
  }
  const obs = slot.observation;
  if (obs.evidenceState !== "complete" && obs.evidenceState !== "contested") {
    return { valid: false, eligible: false };
  }
  const networkRequired = obs.searchRequired || obs.requestedNetworkMode === "on";
  const networkOk = !networkRequired || obs.networkTrigger === "triggered";
  const sessionOk = !obs.newSessionRequired || obs.newSession === "true";
  const regionOk = obs.observedRegion === "unknown" || obs.observedRegion === obs.targetRegion;
  const protocolRegionOk = !obs.protocolRegion || obs.targetRegion === obs.protocolRegion;
  return {
    valid: true,
    eligible: networkOk && sessionOk && regionOk && protocolRegionOk,
  };
}

function summarizeSide(
  entries: ReadonlyArray<{ slot: FormalSlotSample; winStart: number; winEnd: number }>,
  hasOfficialWebsite: boolean,
) {
  const total = emptyBucket();
  const byQuestion = new Map<string, QuestionBucket>();
  for (const { slot, winStart, winEnd } of entries) {
    const q = byQuestion.get(slot.questionId) ?? emptyBucket();
    total.planned += 1;
    q.planned += 1;

    const quality = slotEligible(slot, winStart, winEnd);
    if (quality.valid) {
      total.valid += 1;
      q.valid += 1;
    }
    if (quality.eligible && slot.observation) {
      total.eligible += 1;
      q.eligible += 1;
      const obs = slot.observation;
      const completeCitation = obs.citationSetState === "complete";
      if (completeCitation) {
        total.c += 1;
        q.c += 1;
      }
      const analysis = slot.analysis;
      const analysisReady = analysis !== null
        && analysis.status !== "pending"
        && analysis.ruleVersion.length > 0
        && analysis.entityVersion === obs.entityVersion;
      if (analysisReady) {
        if (analysis.mentioned === "true" || analysis.mentioned === "false") {
          total.jm += 1;
          q.jm += 1;
        }
        if (analysis.recommended === "true" || analysis.recommended === "false") {
          total.jr += 1;
          q.jr += 1;
        }
        if (hasOfficialWebsite && completeCitation
          && (analysis.officialSiteCited === "true" || analysis.officialSiteCited === "false")) {
          total.jc += 1;
          q.jc += 1;
        }
      }
    }
    byQuestion.set(slot.questionId, q);
  }
  return { total, byQuestion };
}

/**
 * Evaluate a formal checkpoint using saved non-brand slots and latest analysis versions
 * matching the observation's brand and frozenSetId.
 */
export function evaluateFormalCheckpointGate(input: {
  effectiveOn: string;
  today: string;
  checkpoint: Checkpoint;
  frozenNonBrandCount: number;
  hasOfficialWebsite: boolean;
  slots: readonly FormalSlotSample[];
  callerExcluded?: readonly string[];
}): {
  mode: "progress" | "formal" | "exploratory";
  comparableCount: number;
  excluded: string[];
  conclusion: string | null;
  evaluation: FormalCheckpointEvaluation | null;
} {
  if (!checkpointDue({ effectiveOn: input.effectiveOn, today: input.today, checkpoint: input.checkpoint })) {
    return {
      mode: "progress",
      comparableCount: 0,
      excluded: [],
      conclusion: null,
      evaluation: null,
    };
  }

  const beforeStartDay = addCalendarDays(input.effectiveOn, -14);
  const beforeEndDay = input.effectiveOn;
  const afterStartDay = addCalendarDays(input.effectiveOn, 1);
  const afterEndDay = addCalendarDays(input.effectiveOn, checkpointDays[input.checkpoint] + 1);

  const beforeEntries: Array<{ slot: FormalSlotSample; winStart: number; winEnd: number }> = [];
  const afterEntries: Array<{ slot: FormalSlotSample; winStart: number; winEnd: number }> = [];
  const matchedSlotIds = new Set<string>();

  for (const slot of input.slots) {
    if (!slot.naturalQuestion) continue;
    const createdMs = Date.parse(slot.slotCreatedAt);
    if (!Number.isFinite(createdMs)) continue;
    const beforeBounds = windowInstants(beforeStartDay, beforeEndDay, slot.timezone);
    const afterBounds = windowInstants(afterStartDay, afterEndDay, slot.timezone);
    if (beforeBounds && createdMs >= beforeBounds.start && createdMs < beforeBounds.end) {
      beforeEntries.push({ slot, winStart: beforeBounds.start, winEnd: beforeBounds.end });
      matchedSlotIds.add(slot.slotId);
    } else if (afterBounds && createdMs >= afterBounds.start && createdMs < afterBounds.end) {
      afterEntries.push({ slot, winStart: afterBounds.start, winEnd: afterBounds.end });
      matchedSlotIds.add(slot.slotId);
    }
  }

  const beforeSide = summarizeSide(beforeEntries, input.hasOfficialWebsite);
  const afterSide = summarizeSide(afterEntries, input.hasOfficialWebsite);
  const missingSamples = beforeSide.total.planned === 0 || afterSide.total.planned === 0;

  const allQuestionIds = [...new Set([
    ...beforeSide.byQuestion.keys(),
    ...afterSide.byQuestion.keys(),
  ])].sort((a, b) => a.localeCompare(b));

  const mentionExcluded: Array<{ questionId: string; reason: FormalExclusionReason }> = [];
  const recExcluded: Array<{ questionId: string; reason: FormalExclusionReason }> = [];
  const citExcluded: Array<{ questionId: string; reason: FormalExclusionReason }> = [];
  const questionReasonMap = new Map<string, Set<FormalExclusionReason>>();

  const addQuestionReason = (questionId: string, reason: FormalExclusionReason) => {
    const set = questionReasonMap.get(questionId) ?? new Set<FormalExclusionReason>();
    set.add(reason);
    questionReasonMap.set(questionId, set);
  };

  let mentionComparable = 0;
  let recComparable = 0;
  let citComparable = 0;

  for (const questionId of allQuestionIds) {
    const b = beforeSide.byQuestion.get(questionId) ?? emptyBucket();
    const a = afterSide.byQuestion.get(questionId) ?? emptyBucket();
    if (b.planned === 0 || a.planned === 0) {
      mentionExcluded.push({ questionId, reason: "missing_window" });
      recExcluded.push({ questionId, reason: "missing_window" });
      citExcluded.push({ questionId, reason: "missing_window" });
      addQuestionReason(questionId, "missing_window");
      continue;
    }
    if (!meetsEightyPercent(b.eligible, b.planned) || !meetsEightyPercent(a.eligible, a.planned)) {
      mentionExcluded.push({ questionId, reason: "low_eligible_coverage" });
      recExcluded.push({ questionId, reason: "low_eligible_coverage" });
      citExcluded.push({ questionId, reason: "low_eligible_coverage" });
      addQuestionReason(questionId, "low_eligible_coverage");
      continue;
    }

    if (meetsEightyPercent(b.jm, b.eligible) && meetsEightyPercent(a.jm, a.eligible)) {
      mentionComparable += 1;
    } else {
      mentionExcluded.push({ questionId, reason: "low_mention_coverage" });
      addQuestionReason(questionId, "low_mention_coverage");
    }

    if (meetsEightyPercent(b.jr, b.eligible) && meetsEightyPercent(a.jr, a.eligible)) {
      recComparable += 1;
    } else {
      recExcluded.push({ questionId, reason: "low_recommendation_coverage" });
      addQuestionReason(questionId, "low_recommendation_coverage");
    }

    if (!input.hasOfficialWebsite) {
      citExcluded.push({ questionId, reason: "no_official_website" });
      addQuestionReason(questionId, "no_official_website");
    } else if (meetsEightyPercent(b.jc, b.eligible) && meetsEightyPercent(a.jc, a.eligible)) {
      citComparable += 1;
    } else if (!meetsEightyPercent(b.c, b.eligible) || !meetsEightyPercent(a.c, a.eligible)) {
      citExcluded.push({ questionId, reason: "incomplete_citations" });
      addQuestionReason(questionId, "incomplete_citations");
    } else {
      citExcluded.push({ questionId, reason: "low_citation_coverage" });
      addQuestionReason(questionId, "low_citation_coverage");
    }
  }

  const coveragePassed = !missingSamples
    && meetsNinetyPercent(beforeSide.total.eligible, beforeSide.total.planned)
    && meetsNinetyPercent(afterSide.total.eligible, afterSide.total.planned);

  const mentionCommonOk = !missingSamples && meetsEightyPercent(mentionComparable, input.frozenNonBrandCount);
  const mentionCoverageOk = !missingSamples
    && meetsEightyPercent(beforeSide.total.jm, beforeSide.total.eligible)
    && meetsEightyPercent(afterSide.total.jm, afterSide.total.eligible);
  const mentionPassed = coveragePassed && mentionCommonOk && mentionCoverageOk;

  const recCommonOk = !missingSamples && meetsEightyPercent(recComparable, input.frozenNonBrandCount);
  const recCoverageOk = !missingSamples
    && meetsEightyPercent(beforeSide.total.jr, beforeSide.total.eligible)
    && meetsEightyPercent(afterSide.total.jr, afterSide.total.eligible);
  const recPassed = coveragePassed && recCommonOk && recCoverageOk;

  const citCommonOk = !missingSamples && input.hasOfficialWebsite && meetsEightyPercent(citComparable, input.frozenNonBrandCount);
  const citCoverageOk = !missingSamples && input.hasOfficialWebsite
    && meetsEightyPercent(beforeSide.total.jc, beforeSide.total.eligible)
    && meetsEightyPercent(afterSide.total.jc, afterSide.total.eligible);
  const citPassed = coveragePassed && citCommonOk && citCoverageOk;

  const insufficientMetrics: FormalGateKey[] = [];
  const insufficiencyReasons: FormalInsufficiencyReason[] = [];
  if (missingSamples) {
    insufficiencyReasons.push("missing_samples");
    insufficientMetrics.push("coverage", "mention", "recommendation", "citation");
  } else {
    if (!coveragePassed) {
      insufficientMetrics.push("coverage");
      insufficiencyReasons.push("overall_coverage_below_90");
    }
    if (!mentionCommonOk || !mentionCoverageOk) {
      insufficientMetrics.push("mention");
      if (!mentionCommonOk) insufficiencyReasons.push("mention_common_below_80");
      if (!mentionCoverageOk) insufficiencyReasons.push("mention_coverage_below_80");
    }
    if (!recCommonOk || !recCoverageOk) {
      insufficientMetrics.push("recommendation");
      if (!recCommonOk) insufficiencyReasons.push("recommendation_common_below_80");
      if (!recCoverageOk) insufficiencyReasons.push("recommendation_coverage_below_80");
    }
    if (!input.hasOfficialWebsite) {
      insufficientMetrics.push("citation");
      insufficiencyReasons.push("no_official_website");
    } else if (!citCommonOk || !citCoverageOk) {
      insufficientMetrics.push("citation");
      if (!citCommonOk) insufficiencyReasons.push("citation_common_below_80");
      if (!citCoverageOk) insufficiencyReasons.push("citation_coverage_below_80");
    }
  }

  const slotIds = [...matchedSlotIds].sort((a, b) => a.localeCompare(b));
  const callerExcluded = slotIds.length === 0 ? [...(input.callerExcluded ?? [])] : [];
  for (const id of callerExcluded) addQuestionReason(id, "caller_excluded");

  const excludedQuestions: ExcludedQuestionDetail[] = [...questionReasonMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([questionId, reasons]) => ({ questionId, reasons: [...reasons] }));

  const mode = insufficientMetrics.length === 0 ? "formal" as const : "exploratory" as const;
  const comparableCount = missingSamples
    ? 0
    : Math.min(mentionComparable, recComparable, citComparable);
  const excluded = excludedQuestions.map((item) => item.questionId).slice(0, 40);

  const evaluation: FormalCheckpointEvaluation = {
    missingSamples,
    hasOfficialWebsite: input.hasOfficialWebsite,
    slotIds,
    coverage: {
      before: {
        planned: beforeSide.total.planned,
        valid: beforeSide.total.valid,
        eligible: beforeSide.total.eligible,
        rate: ratio(beforeSide.total.eligible, beforeSide.total.planned),
      },
      after: {
        planned: afterSide.total.planned,
        valid: afterSide.total.valid,
        eligible: afterSide.total.eligible,
        rate: ratio(afterSide.total.eligible, afterSide.total.planned),
      },
      passed: coveragePassed,
    },
    metrics: {
      mention: {
        passed: mentionPassed,
        comparableCount: mentionComparable,
        frozenNonBrandCount: input.frozenNonBrandCount,
        before: {
          judged: beforeSide.total.jm,
          eligible: beforeSide.total.eligible,
          rate: ratio(beforeSide.total.jm, beforeSide.total.eligible),
        },
        after: {
          judged: afterSide.total.jm,
          eligible: afterSide.total.eligible,
          rate: ratio(afterSide.total.jm, afterSide.total.eligible),
        },
        excluded: mentionExcluded,
      },
      recommendation: {
        passed: recPassed,
        comparableCount: recComparable,
        frozenNonBrandCount: input.frozenNonBrandCount,
        before: {
          judged: beforeSide.total.jr,
          eligible: beforeSide.total.eligible,
          rate: ratio(beforeSide.total.jr, beforeSide.total.eligible),
        },
        after: {
          judged: afterSide.total.jr,
          eligible: afterSide.total.eligible,
          rate: ratio(afterSide.total.jr, afterSide.total.eligible),
        },
        excluded: recExcluded,
      },
      citation: {
        passed: citPassed,
        applicable: input.hasOfficialWebsite,
        comparableCount: citComparable,
        frozenNonBrandCount: input.frozenNonBrandCount,
        before: {
          judged: beforeSide.total.jc,
          completeCitations: beforeSide.total.c,
          eligible: beforeSide.total.eligible,
          jcOverE: input.hasOfficialWebsite ? ratio(beforeSide.total.jc, beforeSide.total.eligible) : null,
          cOverE: ratio(beforeSide.total.c, beforeSide.total.eligible),
          jcOverC: input.hasOfficialWebsite ? ratio(beforeSide.total.jc, beforeSide.total.c) : null,
        },
        after: {
          judged: afterSide.total.jc,
          completeCitations: afterSide.total.c,
          eligible: afterSide.total.eligible,
          jcOverE: input.hasOfficialWebsite ? ratio(afterSide.total.jc, afterSide.total.eligible) : null,
          cOverE: ratio(afterSide.total.c, afterSide.total.eligible),
          jcOverC: input.hasOfficialWebsite ? ratio(afterSide.total.jc, afterSide.total.c) : null,
        },
        excluded: citExcluded,
      },
    },
    insufficientMetrics,
    insufficiencyReasons,
    excludedQuestions,
  };

  const conclusion = JSON.stringify({
    kind: mode,
    comparableQuestions: comparableCount,
    frozenQuestions: input.frozenNonBrandCount,
    missingSamples,
    insufficient: insufficientMetrics,
  });

  return {
    mode,
    comparableCount,
    excluded,
    conclusion,
    evaluation,
  };
}

export function formalQualityGate(input: {
  eligible: number;
  planned: number;
  perQuestion: readonly { eligible: number; planned: number }[];
  comparableQuestions: number;
  frozenNonBrand: number;
}) {
  const overall = input.planned === 0 ? 0 : input.eligible / input.planned;
  const questionsOk = input.perQuestion.every((question) => question.planned > 0 && question.eligible / question.planned >= 0.8);
  const common = input.frozenNonBrand === 0 ? 0 : input.comparableQuestions / input.frozenNonBrand;
  const allowed = overall >= 0.9 && questionsOk && common >= 0.8;
  return { allowed, mode: allowed ? "formal" as const : "exploratory" as const, overall, common };
}

export function stopObservation(input: { reason: string; slotIds: readonly string[] }) {
  if (input.reason.trim().length === 0) return { stopped: false as const, retainedSlotIds: [...input.slotIds] };
  return { stopped: true as const, reason: input.reason, retainedSlotIds: [...input.slotIds] };
}

export const confounderFactors = ["model", "marketing", "price"] as const;
export type ConfounderFactor = (typeof confounderFactors)[number];

const confounderFactorSet = new Set<string>(confounderFactors);

export function recordConfounders(input: { factors: readonly string[]; thresholdPp: number }) {
  const factors = [...input.factors];
  return {
    factors,
    thresholdPp: input.thresholdPp,
    thresholdChanged: false as const,
    accepted: factors.length > 0 && factors.every((factor) => confounderFactorSet.has(factor)),
  };
}

export const controlLabel = "observation" as const;

/** A control page is observational. Registration does not change a checkpoint mode. */
export function registerControlPage(input: {
  label: string;
  checkpointCount: number;
  checkpointMode: "progress" | "formal" | "exploratory" | null;
}) {
  if (input.label !== controlLabel) {
    return { accepted: false as const, reason: "label" as const, checkpointMode: input.checkpointMode };
  }
  if (input.checkpointCount > 0) {
    return { accepted: false as const, reason: "checkpoint" as const, checkpointMode: input.checkpointMode };
  }
  return { accepted: true as const, label: controlLabel, checkpointMode: input.checkpointMode };
}

export function formalComparison(input: { comparableQuestions: number; frozenQuestions: number; excluded: readonly string[] }) {
  const ratio = input.frozenQuestions === 0 ? 0 : input.comparableQuestions / input.frozenQuestions;
  return {
    mode: ratio >= 0.8 ? "formal" as const : "exploratory" as const,
    ratio,
    excluded: [...input.excluded],
  };
}

/** Core and explore stay separate. A registered intervention blocks the baseline freeze. */
export function freezeObservationPlan(input: {
  coreIds: readonly string[];
  exploreIds: readonly string[];
  baselineDays: number;
  interventionRegistered: boolean;
}) {
  if (input.coreIds.length === 0) return { frozen: false as const, reason: "empty_core" as const };
  const overlap = input.coreIds.filter((id) => input.exploreIds.includes(id));
  if (overlap.length > 0) return { frozen: false as const, reason: "mixed_buckets" as const };
  if (input.baselineDays < 14) return { frozen: false as const, reason: "baseline_short" as const };
  if (input.interventionRegistered) return { frozen: false as const, reason: "baseline_intervention" as const };
  return {
    frozen: true as const,
    coreIds: [...input.coreIds],
    exploreIds: [...input.exploreIds],
    baselineDays: input.baselineDays,
  };
}

export function batchEffectiveAt(verifiedAt: readonly (string | null)[]) {
  let latest: string | null = null;
  for (const value of verifiedAt) {
    if (value === null) return null;
    if (latest === null || value > latest) latest = value;
  }
  return latest;
}
