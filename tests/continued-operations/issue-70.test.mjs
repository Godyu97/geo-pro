import assert from "node:assert/strict";
import { test } from "node:test";
import { m2StageGate } from "../../src/features/reports/m2-stage-gate.ts";

test("the M2 stage gate stays closed without real connections or two brands", () => {
  const gate = m2StageGate({
    m1Passed: false,
    m2TasksChecked: 0,
    assistedEntryVerified: false,
    draftConnectionVerified: false,
    dataSourceVerified: false,
    authorizedBrands: 0,
    assistantWithinCap: false,
    localWalkthrough: false,
  });
  assert.equal(gate.passed, false);
  assert.equal(gate.inventedResults, false);
  assert.ok(gate.missing.includes("two_brands"));
  assert.ok(gate.missing.includes("draft_connection"));
});
