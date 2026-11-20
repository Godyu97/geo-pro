import assert from "node:assert/strict";
import { test } from "node:test";
import { m1StageGate } from "../../src/features/reports/m1-stage-gate.ts";

test("the M1 stage gate stays closed without 200 analyzed samples", () => {
  const gate = m1StageGate({ analyzedSamples: 0, teamObservation: false, tasksChecked: 0 });
  assert.equal(gate.passed, false);
  assert.equal(gate.inventedResults, false);
  assert.deepEqual(gate.missing, ["samples", "team_observation", "m1_tasks"]);
});
