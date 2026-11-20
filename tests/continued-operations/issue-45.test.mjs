import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewClaim, reviewedErrorDisplay } from "../../src/features/entity-accuracy/rules.ts";

test("ten reviewed claims do not become a population error rate", () => {
  const rate = reviewedErrorDisplay({ reviewed: 10, population: 50, confirmedErrors: 2, method: "随机抽检" });
  assert.equal(rate.errorLabel, "2/10");
  assert.equal(rate.coverageLabel, "10/50");
  assert.equal(rate.populationRate, null);
  assert.equal(rate.rate, 0.2);
});

test("expired or conflicting facts are not automatic errors", () => {
  assert.equal(reviewClaim({ normalizedEqual: false, fact: "expired" }).judgment, "not_applicable");
  assert.equal(reviewClaim({ normalizedEqual: false, fact: "conflict" }).autoError, false);
  assert.equal(reviewClaim({ normalizedEqual: null, fact: "active" }).judgment, "needs_review");
});
