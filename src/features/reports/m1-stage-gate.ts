/** Sample counts and task checks are inputs. Zero samples stay below the stage gate. */
export function m1StageGate(input: {
  analyzedSamples: number;
  teamObservation: boolean;
  tasksChecked: number;
}) {
  const missing: string[] = [];
  if (input.analyzedSamples < 200) missing.push("samples");
  if (!input.teamObservation) missing.push("team_observation");
  if (input.tasksChecked < 8) missing.push("m1_tasks");
  return { passed: missing.length === 0, missing, inventedResults: false as const };
}
