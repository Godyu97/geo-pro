import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectCopiedBrief, inspectSource } from "../../src/features/source-opportunities/rules.ts";

test("a limited page keeps the citation and does not count as support", () => {
  const limited = inspectSource({ pageLive: true, readable: false, authorKnown: true, supportsBrand: true });
  assert.equal(limited.state, "limited");
  assert.equal(limited.support, "unknown");
  assert.equal(limited.citationKept, true);
  const expired = inspectSource({ pageLive: false, readable: false, authorKnown: false, supportsBrand: true });
  assert.equal(expired.state, "observed");
  assert.equal(expired.citationKept, true);
});

test("a brief that only replaces the other brand is rejected", () => {
  const copied = inspectCopiedBrief({
    sourceText: "甲品牌的参数说明",
    briefText: "乙品牌的参数说明",
    sourceBrand: "甲品牌",
    ownBrand: "乙品牌",
    gap: "缺口",
    sourceIds: ["s1"],
  });
  assert.equal(copied.accepted, false);
  if (!copied.accepted) assert.equal(copied.reason, "copied_replacement");
  const kept = inspectCopiedBrief({
    sourceText: "甲品牌的参数说明",
    briefText: "现有资料没有说明保修年限",
    sourceBrand: "甲品牌",
    ownBrand: "乙品牌",
    gap: "保修年限没有已批准事实",
    sourceIds: ["s1"],
  });
  assert.equal(kept.accepted, true);
});
