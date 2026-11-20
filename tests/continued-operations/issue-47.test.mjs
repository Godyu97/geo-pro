import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateFact, importBatchReport } from "../../src/features/asset-reuse/rules.ts";

function file(name) {
  return { name, bytes: 10, chars: 10, encrypted: false, pages: [{ page: 1, text: "ok" }] };
}

test("the eleventh file is a failed row and missing pages are not invented", () => {
  const names = Array.from({ length: 11 }, (_, index) => file(`f${index}.pdf`));
  const report = importBatchReport(names);
  assert.equal(report.files.length, 11);
  assert.equal(report.files[10].status, "failed");
  assert.equal(report.files[10].reason, "batch_limit");
  assert.equal(report.factsApproved, false);
  const missing = candidateFact({ text: null, page: null, approvedValues: ["保修一年"] });
  assert.equal(missing.page, null);
  assert.equal(missing.inventedPage, false);
  assert.equal(missing.approved, false);
});

test("a candidate that differs from an approved fact stays unapproved", () => {
  const fact = candidateFact({ text: "保修两年", page: 3, approvedValues: ["保修一年"] });
  assert.equal(fact.approved, false);
  assert.deepEqual(fact.conflicts, ["保修一年"]);
  assert.equal(fact.page, 3);
});
