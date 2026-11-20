import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkpointDue,
  formalQualityGate,
  recordConfounders,
  stopObservation,
} from "../../src/features/formal-retest/rules.ts";

test("D+7 is due only after seven full days starting the next day", () => {
  assert.equal(checkpointDue({ effectiveOn: "2026-11-01", today: "2026-11-08", checkpoint: "d7" }), false);
  assert.equal(checkpointDue({ effectiveOn: "2026-11-01", today: "2026-11-09", checkpoint: "d7" }), true);
  assert.equal(checkpointDue({ effectiveOn: "2026-11-01", today: "2026-11-10", checkpoint: "d14" }), false);
});

test("low common-question coverage stays exploratory and an early stop keeps slots", () => {
  const gate = formalQualityGate({
    eligible: 90,
    planned: 100,
    perQuestion: [{ eligible: 8, planned: 10 }],
    comparableQuestions: 23,
    frozenNonBrand: 30,
  });
  assert.equal(gate.mode, "exploratory");
  assert.equal(gate.allowed, false);
  const stopped = stopObservation({ reason: "客户暂停", slotIds: ["s1", "s2"] });
  assert.equal(stopped.stopped, true);
  if (stopped.stopped) assert.deepEqual(stopped.retainedSlotIds, ["s1", "s2"]);
  assert.equal(recordConfounders({ factors: ["价格调整"], thresholdPp: 10 }).thresholdChanged, false);
});
