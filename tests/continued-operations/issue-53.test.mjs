import assert from "node:assert/strict";
import { test } from "node:test";
import { previewLeadImport } from "../../src/features/business-feedback/rules.ts";

test("the same event keeps both evidence labels and drops direct identifiers", () => {
  const imported = previewLeadImport([
    { eventId: "e1", evidence: "self_report", directIdentifier: false },
    { eventId: "e1", evidence: "referral", directIdentifier: false },
    { eventId: "e2", evidence: "unknown", directIdentifier: true },
    { eventId: null, evidence: "landing_page", directIdentifier: false },
  ]);
  assert.equal(imported.leads.length, 1);
  assert.equal(imported.leads[0].primary, "referral");
  assert.deepEqual(imported.leads[0].evidence, ["self_report", "referral"]);
  assert.deepEqual(imported.rejected, [
    { index: 2, reason: "direct_pii" },
    { index: 3, reason: "missing_id" },
  ]);
});
