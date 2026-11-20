import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptEffect, requestPublish, retryAction } from "../../src/features/external-connections/rules.ts";

test("draft permission cannot publish and a draft receipt is not public", () => {
  const refused = requestPublish({ scopes: ["draft"], confirmed: true });
  assert.equal(refused.accepted, false);
  assert.equal(refused.countsAsPublic, false);
  assert.equal(receiptEffect("draft_created").interventionEffective, false);
  assert.equal(receiptEffect("public_url").interventionEffective, true);
});

test("an unknown acknowledgement is reconciled instead of submitted again", () => {
  assert.deepEqual(retryAction({ state: "unknown", sameKey: true }), { submit: false, reconcile: true });
  assert.deepEqual(retryAction({ state: "failed", sameKey: true }), { submit: true, reconcile: false });
});
