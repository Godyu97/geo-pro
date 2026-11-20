import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionalMeanPosition, shareBySetVersion } from "../../src/features/competitor-share/rules.ts";

test("competitor set versions stay in separate denominators", () => {
  const segments = shareBySetVersion([
    { answerId: "a1", brandId: "self", setVersion: 1 },
    { answerId: "a1", brandId: "self", setVersion: 1 },
    { answerId: "a1", brandId: "other", setVersion: 1 },
    { answerId: "a2", brandId: "outsider", setVersion: 2 },
  ], ["self", "other"]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].rows.find((row) => row.brandId === "self")?.count, 1);
  assert.equal(segments[0].rows[0].denominator, 1);
  assert.equal(segments[1].rows.find((row) => row.brandId === "other")?.share, null);
});

test("unordered brands are not ranked and absences are not zeroes", () => {
  const unordered = conditionalMeanPosition({ ordered: false, ranked: [{ brandId: "self", position: 1 }], absentBrandIds: ["other"] });
  assert.equal(unordered.ranked, false);
  assert.equal(unordered.mean, null);
  const ordered = conditionalMeanPosition({
    ordered: true,
    ranked: [{ brandId: "self", position: 1 }, { brandId: "other", position: 3 }],
    absentBrandIds: ["missing"],
  });
  assert.equal(ordered.mean, 2);
  assert.deepEqual(ordered.excludedAbsent, ["missing"]);
});
