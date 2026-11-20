import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumerSheet,
  coverageDenominator,
  pauseUnaffordableSlots,
  reviseBudget,
  transitionPlan,
} from "../../src/features/sampling-plans/rules.ts";

test("the next unaffordable window pauses future slots and keeps past failures", () => {
  const slots = [
    { id: "past-fail", channelId: "api", at: "2026-11-01T00:00:00.000Z", status: "failed", manual: false },
    { id: "future", channelId: "api", at: "2026-11-20T00:00:00.000Z", status: "scheduled", manual: false },
  ];
  const paused = pauseUnaffordableSlots(slots, {
    spentMinor: 70,
    pendingMinor: 20,
    budgetMinor: 100,
    nextAt: "2026-11-18T00:00:00.000Z",
    slotCostMinor: 25,
  });
  assert.equal(paused.remaining, 10);
  assert.deepEqual(paused.pausedIds, ["future"]);
  assert.equal(coverageDenominator(paused.slots).some((slot) => slot.id === "past-fail"), true);
  assert.equal(transitionPlan("active", "paused"), "paused");
  assert.equal(transitionPlan("ended", "active"), null);
});

test("a budget change versions the plan and a consumer sheet stays manual", () => {
  const next = reviseBudget({ version: 2, phase: "active", budgetMinor: 100, failedSlotIds: ["past-fail"] }, 80);
  assert.equal(next.version, 3);
  assert.deepEqual(next.failedSlotIds, ["past-fail"]);
  const sheet = consumerSheet(["q1", "q2"]);
  assert.equal(sheet.execution, "manual");
  assert.equal(sheet.automaticCollection, false);
});
