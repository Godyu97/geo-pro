export type PageSupport = "supports" | "unknown";

export function pageSupport(input: { cited: boolean; readable: boolean; supportsBrand: boolean }): PageSupport {
  if (!input.cited || !input.readable) return "unknown";
  return input.supportsBrand ? "supports" : "unknown";
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

/** A dead page keeps the citation. Unreadable or unknown authorship cannot become positive support. */
export function inspectSource(input: {
  pageLive: boolean;
  readable: boolean;
  authorKnown: boolean;
  supportsBrand: boolean;
}) {
  const support = input.pageLive && input.readable && input.supportsBrand ? "supports" as const : "unknown" as const;
  if (!input.pageLive) return { state: "observed" as const, support: "unknown" as const, citationKept: true };
  if (!input.readable) return { state: "limited" as const, support: "unknown" as const, citationKept: true };
  if (!input.authorKnown) return { state: "unknown" as const, support, citationKept: true };
  return { state: "resolved" as const, support, citationKept: true };
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
