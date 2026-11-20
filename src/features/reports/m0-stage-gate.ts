/** Counts come from the caller. This function does not create pilot results. */
export function m0StageGate(input: {
  realBrand: boolean;
  officialAnswers: number;
  consumerAnswers: number;
  independentCompletions: number;
}) {
  const missing: string[] = [];
  if (!input.realBrand) missing.push("real_brand");
  if (input.officialAnswers < 20) missing.push("official_api");
  if (input.consumerAnswers < 6) missing.push("consumer_manual");
  if (input.independentCompletions < 4) missing.push("walkthrough");
  return { passed: missing.length === 0, missing, inventedResults: false as const };
}
