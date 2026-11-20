import assert from "node:assert/strict";
import { test } from "node:test";
import { freezeObservationPlan } from "../../src/features/formal-retest/rules.ts";

test("baseline freeze rejects a registered intervention and mixed question buckets", () => {
  const blocked = freezeObservationPlan({
    coreIds: ["c1"],
    exploreIds: ["c1"],
    baselineDays: 14,
    interventionRegistered: false,
  });
  assert.equal(blocked.frozen, false);
  if (!blocked.frozen) assert.equal(blocked.reason, "mixed_buckets");
  const short = freezeObservationPlan({
    coreIds: ["c1"],
    exploreIds: ["e1"],
    baselineDays: 13,
    interventionRegistered: false,
  });
  assert.equal(short.frozen, false);
  const intervention = freezeObservationPlan({
    coreIds: ["c1"],
    exploreIds: ["e1"],
    baselineDays: 14,
    interventionRegistered: true,
  });
  assert.equal(intervention.frozen, false);
  if (!intervention.frozen) assert.equal(intervention.reason, "baseline_intervention");
});

test("a separated 14-day plan can freeze", () => {
  const frozen = freezeObservationPlan({
    coreIds: ["c1", "c2"],
    exploreIds: ["e1"],
    baselineDays: 14,
    interventionRegistered: false,
  });
  assert.equal(frozen.frozen, true);
  if (frozen.frozen) {
    assert.deepEqual(frozen.coreIds, ["c1", "c2"]);
    assert.deepEqual(frozen.exploreIds, ["e1"]);
  }
});
