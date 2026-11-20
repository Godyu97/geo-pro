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

/** The displayed rate is confirmed/reviewed. The population rate is not produced. */
export function reviewedErrorDisplay(input: {
  reviewed: number;
  population: number;
  confirmedErrors: number;
  method: string;
}) {
  const sample = errorRate(input);
  if (sample.label === "insufficient" || sample.rate === null) {
    return { ...sample, populationRate: null, method: input.method, errorLabel: null, coverageLabel: null };
  }
  return {
    ...sample,
    populationRate: null,
    method: input.method,
    errorLabel: `${input.confirmedErrors}/${input.reviewed}`,
    coverageLabel: `${input.reviewed}/${input.population}`,
  };
}

export function reviewClaim(input: {
  normalizedEqual: boolean | null;
  fact: "active" | "expired" | "conflict";
}) {
  if (input.fact === "expired") return { judgment: "not_applicable" as const, autoError: false };
  if (input.fact === "conflict") return { judgment: "missing_evidence" as const, autoError: false };
  if (input.normalizedEqual === null) return { judgment: "needs_review" as const, autoError: false };
  if (input.normalizedEqual) return { judgment: "consistent" as const, autoError: false };
  return { judgment: "conflict" as const, autoError: false };
}
