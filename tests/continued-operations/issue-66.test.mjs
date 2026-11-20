import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCrawler, revokeSync } from "../../src/features/data-connections/crawler-identity.ts";

test("a user-agent claim does not verify crawler identity or inclusion", () => {
  const row = classifyCrawler({ userAgentClaimsAi: true, identityVerified: false, answerCitations: 0 });
  assert.equal(row.identity, "unverified");
  assert.equal(row.calledIncluded, false);
});

test("revocation stops the next pull and does not delete retained rows", () => {
  const stopped = revokeSync({ revoked: true, retainedRows: 3 });
  assert.equal(stopped.pull, false);
  assert.equal(stopped.retainedRows, 3);
  assert.equal(stopped.historyDeleted, false);
});
