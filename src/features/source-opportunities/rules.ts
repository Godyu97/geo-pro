export type PageSupport = "supports" | "does_not_support" | "unknown";

export function pageSupport(input: { cited: boolean; readable: boolean; supportsBrand: boolean }): PageSupport {
  if (!input.cited || !input.readable) return "unknown";
  return input.supportsBrand ? "supports" : "does_not_support";
}

export function researchBrief(input: { gap: string; facts: readonly string[]; sourceIds: readonly string[] }) {
  return {
    gap: input.gap,
    facts: [...input.facts],
    sourceIds: [...input.sourceIds],
    copiedReplacement: false,
  };
}

export type SourceState = "observed" | "resolved" | "limited" | "unknown";

/** A dead page keeps the citation. Unreadable or unknown authorship cannot become judgable support. */
export function inspectSource(input: {
  pageLive: boolean;
  readable: boolean;
  authorKnown: boolean;
  supportsBrand: boolean;
}) {
  if (!input.pageLive) return { state: "observed" as const, support: "unknown" as const, citationKept: true };
  if (!input.readable) return { state: "limited" as const, support: "unknown" as const, citationKept: true };
  if (!input.authorKnown) return { state: "unknown" as const, support: "unknown" as const, citationKept: true };
  return {
    state: "resolved" as const,
    support: input.supportsBrand ? ("supports" as const) : ("does_not_support" as const),
    citationKept: true,
  };
}

export type ThirdPartySupportUnavailableReason = "no_citations" | "uninspected_only" | "no_judgable_inspections";

export type ThirdPartySupportSummary = {
  totalCount: number;
  supportsCount: number;
  doesNotSupportCount: number;
  judgableCount: number;
  unknownCount: number;
  uninspectedCount: number;
  deadCount: number;
  limitedCount: number;
  unknownAuthorOrLegacyCount: number;
  supportRate: number | null;
  unavailableReason: ThirdPartySupportUnavailableReason | null;
};

/**
 * Computes third-party citation support rate over judgable inspections only (Js).
 * Uninspected URLs and unknown inspections stay out of both numerator and denominator.
 */
export function thirdPartySupportSummary(
  citations: readonly { state: SourceState; support: PageSupport; recorded: boolean }[],
): ThirdPartySupportSummary {
  let supportsCount = 0;
  let doesNotSupportCount = 0;
  let unknownCount = 0;
  let uninspectedCount = 0;
  let deadCount = 0;
  let limitedCount = 0;
  let unknownAuthorOrLegacyCount = 0;

  for (const citation of citations) {
    if (citation.support === "supports") {
      supportsCount += 1;
      continue;
    }
    if (citation.support === "does_not_support") {
      doesNotSupportCount += 1;
      continue;
    }
    unknownCount += 1;
    if (!citation.recorded) {
      uninspectedCount += 1;
    } else if (citation.state === "observed") {
      deadCount += 1;
    } else if (citation.state === "limited") {
      limitedCount += 1;
    } else {
      unknownAuthorOrLegacyCount += 1;
    }
  }

  const totalCount = citations.length;
  const judgableCount = supportsCount + doesNotSupportCount;
  const supportRate = judgableCount > 0 ? supportsCount / judgableCount : null;
  const unavailableReason: ThirdPartySupportUnavailableReason | null = judgableCount > 0
    ? null
    : totalCount === 0
      ? "no_citations"
      : uninspectedCount === totalCount
        ? "uninspected_only"
        : "no_judgable_inspections";

  return {
    totalCount,
    supportsCount,
    doesNotSupportCount,
    judgableCount,
    unknownCount,
    uninspectedCount,
    deadCount,
    limitedCount,
    unknownAuthorOrLegacyCount,
    supportRate,
    unavailableReason,
  };
}

/** Reject a brief that only swaps the source brand for our brand, or that has no source or gap. */
export function inspectCopiedBrief(input: {
  sourceText: string;
  briefText: string;
  sourceBrand: string;
  ownBrand: string;
  gap: string;
  sourceIds: readonly string[];
}) {
  const copied = input.sourceBrand.length > 0
    && input.ownBrand !== input.sourceBrand
    && input.briefText === input.sourceText.split(input.sourceBrand).join(input.ownBrand);
  if (copied) return { accepted: false as const, reason: "copied_replacement" as const };
  if (input.gap.trim().length === 0 || input.sourceIds.length === 0) {
    return { accepted: false as const, reason: "missing_evidence" as const };
  }
  return {
    accepted: true as const,
    gap: input.gap,
    sourceIds: [...input.sourceIds],
    copiedReplacement: false as const,
  };
}
