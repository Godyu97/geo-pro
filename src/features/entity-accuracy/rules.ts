export function errorRate(input: { reviewed: number; population: number; confirmedErrors: number }) {
  if (input.reviewed <= 0 || input.population <= 0 || input.confirmedErrors > input.reviewed || input.reviewed > input.population) {
    return { rate: null, label: "insufficient" as const };
  }
  return {
    rate: input.confirmedErrors / input.reviewed,
    reviewed: input.reviewed,
    population: input.population,
    label: "sample" as const,
  };
}

export function correctionStatus(input: { actionDone: boolean; retestStillWrong: boolean }) {
  return {
    action: input.actionDone ? "actioned" as const : "open" as const,
    effect: input.retestStillWrong ? "unresolved" as const : input.actionDone ? "pending_retest" as const : "open" as const,
  };
}

export function sameNameConfusion(input: { sameSurfaceName: boolean; confirmedDifferentEntity: boolean }) {
  if (!input.sameSurfaceName || !input.confirmedDifferentEntity) return { countAsTargetMention: true, needsDisambiguation: false };
  return { countAsTargetMention: false, needsDisambiguation: true };
}
