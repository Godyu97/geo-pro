import assert from "node:assert/strict";
import { test } from "node:test";
import { correctionTask, reviseDisambiguation } from "../../src/features/entity-accuracy/rules.ts";

test("a new disambiguation version does not rewrite the old analysis", () => {
  const prior = { version: 1, mentionIds: ["m1", "m2"] };
  const revised = reviseDisambiguation(prior, ["evidence-1"], ["m2"]);
  assert.deepEqual(prior.mentionIds, ["m1", "m2"]);
  assert.deepEqual(revised.prior.mentionIds, ["m1", "m2"]);
  assert.equal(revised.next.version, 2);
  assert.deepEqual(revised.next.mentionIds, ["m1"]);
  assert.equal(correctionTask({ claimId: "c1", questionIds: ["q1"], pageIds: ["p1"] }).siteFixClosesEffect, false);
});
