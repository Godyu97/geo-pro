import assert from "node:assert/strict";
import { test } from "node:test";
import { aiReferralConversion, businessLayer, qualifyLead, reviseValidity } from "../../src/features/business-feedback/rules.ts";

const frozen = {
  version: 1,
  frozen: true,
  requiresRealNeed: true,
  requiresIndustry: true,
  requiresFollowUp: true,
};

test("validity stays on its frozen version and raw, qualified, and won stay separate", () => {
  const next = reviseValidity(frozen);
  assert.equal(next.version, 2);
  assert.equal(next.frozen, false);
  assert.equal(qualifyLead(frozen, { realNeed: true, targetIndustry: false, followUp: true }).status, "disqualified");
  assert.deepEqual(businessLayer({ raw: 8, qualified: 3, won: 1 }), { raw: 8, qualified: 3, won: 1 });
});

test("self-reported leads are not divided by all site visits", () => {
  const rate = aiReferralConversion({ identifiedReferrals: 2, sessionDenominator: null, selfReported: 5 });
  assert.equal(rate.identified.rate, null);
  assert.equal(rate.selfReported, 5);
  assert.equal(rate.selfReportedOverVisits, null);
});
