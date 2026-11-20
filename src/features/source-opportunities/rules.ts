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
