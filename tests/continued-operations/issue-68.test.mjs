import assert from "node:assert/strict";
import { test } from "node:test";
import { localObservation, storeFacts } from "../../src/features/local-presence/rules.ts";

test("an unknown sampling place is not reported as a Hangzhou ranking", () => {
  const row = localObservation({ targetCity: "杭州", sampledCity: null });
  assert.equal(row.targetCity, "杭州");
  assert.equal(row.sampledCity, null);
  assert.equal(row.ranked, false);
  assert.equal(row.claimedLocalUsers, false);
});

test("two stores do not reuse each other's service area", () => {
  const store = storeFacts({ storeId: "west", serviceArea: "西湖", otherStoreArea: "滨江" });
  assert.equal(store.serviceArea, "西湖");
  assert.equal(store.usedOtherStore, false);
});
