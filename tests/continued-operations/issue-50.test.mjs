import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarSchedule, impactSurface } from "../../src/features/channel-variants/rules.ts";

test("five pages affected by one fact become one task and stay listed", () => {
  const impact = impactSurface({
    factId: "price",
    pages: [
      { pageId: "p1", draftId: "d1", channel: "site" },
      { pageId: "p2", draftId: "d2", channel: "zhihu" },
      { pageId: "p3", draftId: "d3", channel: "wechat" },
      { pageId: "p4", draftId: "d4", channel: "baijiahao" },
      { pageId: "p5", draftId: "d5", channel: "toutiao" },
      { pageId: "p5", draftId: "d5", channel: "toutiao" },
    ],
  });
  assert.equal(impact.pages.length, 6);
  assert.equal(impact.taskCount, 1);
});

test("a planned date is not treated as the live date", () => {
  const row = calendarSchedule({
    plannedOn: "2026-11-01",
    verifiedOn: null,
    retestDueOn: "2026-11-08",
    blocked: false,
  });
  assert.equal(row.published, false);
  assert.equal(row.liveOn, null);
  assert.equal(row.retestDueOn, "2026-11-08");
});
