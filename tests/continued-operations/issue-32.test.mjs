import assert from "node:assert/strict";
import { test } from "node:test";
import { m0StageGate } from "../../src/features/reports/m0-stage-gate.ts";

test("an empty pilot record does not pass the M0 stage gate", () => {
  const gate = m0StageGate({ realBrand: false, officialAnswers: 0, consumerAnswers: 0, independentCompletions: 0 });
  assert.equal(gate.passed, false);
  assert.equal(gate.inventedResults, false);
  assert.deepEqual(gate.missing, ["real_brand", "official_api", "consumer_manual", "walkthrough"]);
});
