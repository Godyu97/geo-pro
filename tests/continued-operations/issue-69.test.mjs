import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewMedia } from "../../src/features/local-presence/media.ts";

test("a wrong price blocks delivery and points at the fact version", () => {
  const blocked = reviewMedia({
    shownValue: "99",
    approvedValue: "129",
    factVersion: 4,
    presentedAsCustomerProof: false,
  });
  assert.equal(blocked.deliver, false);
  assert.equal(blocked.reason, "fact_mismatch");
  assert.equal(blocked.factVersion, 4);
});

test("an illustration is not accepted as customer proof", () => {
  const proof = reviewMedia({
    shownValue: "129",
    approvedValue: "129",
    factVersion: 4,
    presentedAsCustomerProof: true,
  });
  assert.equal(proof.deliver, false);
  assert.equal(proof.reason, "not_proof");
});
