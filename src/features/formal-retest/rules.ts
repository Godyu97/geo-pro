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

export function recordConfounders(input: { factors: readonly string[]; thresholdPp: number }) {
  return { factors: [...input.factors], thresholdPp: input.thresholdPp, thresholdChanged: false as const };
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
