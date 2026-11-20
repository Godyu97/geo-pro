import assert from "node:assert/strict";
import { test } from "node:test";
import { degradeEntry, effortComparison } from "../../src/features/assisted-capture/effort.ts";

test("a changed entry falls back to manual capture without switching accounts", () => {
  const degraded = degradeEntry({ structureChanged: true });
  assert.equal(degraded.mode, "manual");
  assert.equal(degraded.manualStillAvailable, true);
  assert.equal(degraded.switchedAccount, false);
});

test("incomplete citations are not compared as time saved", () => {
  const missing = effortComparison({ assistedMinutes: 4, manualMinutes: 9, citationsComplete: false });
  assert.equal(missing.comparable, false);
  assert.equal(missing.savedMinutes, null);
  const compared = effortComparison({ assistedMinutes: 4, manualMinutes: 9, citationsComplete: true });
  assert.equal(compared.savedMinutes, 5);
});
