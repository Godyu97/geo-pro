/** A changed entry drops back to the manual sheet. The original prompts stay available. */
export function degradeEntry(input: { structureChanged: boolean }) {
  if (!input.structureChanged) return { mode: "assisted" as const, manualStillAvailable: true, switchedAccount: false };
  return { mode: "manual" as const, manualStillAvailable: true, switchedAccount: false };
}

/** Time saved is comparable only when both timings exist and citations are complete. */
export function effortComparison(input: {
  assistedMinutes: number | null;
  manualMinutes: number | null;
  citationsComplete: boolean;
}) {
  if (!input.citationsComplete || input.assistedMinutes === null || input.manualMinutes === null) {
    return { savedMinutes: null, comparable: false as const };
  }
  return { savedMinutes: input.manualMinutes - input.assistedMinutes, comparable: true as const };
}
