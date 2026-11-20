import assert from "node:assert/strict";
import { test } from "node:test";
import { agencyAccess, portfolioRow } from "../../src/features/commercial/delegation.ts";

test("an expired brand grant blocks an agency member and queued work", () => {
  const denied = agencyAccess({ agencyMember: true, grantActive: false, queued: true });
  assert.equal(denied.allowed, false);
  assert.equal(denied.runQueued, false);
  assert.equal(denied.reason, "grant");
});

test("a portfolio row hides evidence when the brand grant is gone", () => {
  const hidden = portfolioRow({ brandId: "b", grantActive: false, evidenceIds: ["e1"] });
  assert.deepEqual(hidden.evidenceIds, []);
  assert.equal(hidden.summary, "blocked");
});
