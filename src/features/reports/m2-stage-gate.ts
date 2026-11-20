/** Gate inputs are supplied by the caller. Empty evidence does not pass. */
export function m2StageGate(input: {
  m1Passed: boolean;
  m2TasksChecked: number;
  assistedEntryVerified: boolean;
  draftConnectionVerified: boolean;
  dataSourceVerified: boolean;
  authorizedBrands: number;
  assistantWithinCap: boolean;
  localWalkthrough: boolean;
}) {
  const missing: string[] = [];
  if (!input.m1Passed) missing.push("m1");
  if (input.m2TasksChecked < 6) missing.push("m2_tasks");
  if (!input.assistedEntryVerified) missing.push("assisted_entry");
  if (!input.draftConnectionVerified) missing.push("draft_connection");
  if (!input.dataSourceVerified) missing.push("data_source");
  if (input.authorizedBrands < 2) missing.push("two_brands");
  if (!input.assistantWithinCap) missing.push("assistant");
  if (!input.localWalkthrough) missing.push("local_walkthrough");
  return { passed: missing.length === 0, missing, inventedResults: false as const };
}
