import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBaseline } from "../../src/features/formal-retest/rules.ts";

test("baseline windows exclude D0 and follow the brand time zone", () => {
  const publication = assessBaseline({
    effectiveOn: "2026-11-17",
    timeZone: "Asia/Shanghai",
    events: [{ kind: "publication", id: "pub-1", effectiveAt: "2026-11-10T04:00:00.000Z" }],
  });
  assert.equal(publication.start, "2026-11-03");
  assert.equal(publication.end, "2026-11-17");
  assert.equal(publication.compliant, false);
  assert.equal(publication.hits[0].localDate, "2026-11-10");
  assert.equal(publication.rescheduleOn, "2026-11-25");

  const onLaunchDay = assessBaseline({
    effectiveOn: "2026-11-17",
    timeZone: "Asia/Shanghai",
    events: [{ kind: "intervention", id: "batch-1", effectiveAt: "2026-11-17T07:30:00.000Z" }],
  });
  assert.equal(onLaunchDay.compliant, true);
  assert.equal(onLaunchDay.rescheduleOn, null);

  const beforeWindow = assessBaseline({
    effectiveOn: "2026-11-17",
    timeZone: "Asia/Shanghai",
    events: [{ kind: "intervention", id: "batch-2", effectiveAt: "2026-11-02T15:59:00.000Z" }],
  });
  assert.equal(beforeWindow.compliant, true);

  const losAngeles = assessBaseline({
    effectiveOn: "2026-11-17",
    timeZone: "America/Los_Angeles",
    events: [{ kind: "intervention", id: "batch-1", effectiveAt: "2026-11-17T07:30:00.000Z" }],
  });
  assert.equal(losAngeles.compliant, false);
  assert.equal(losAngeles.hits[0].localDate, "2026-11-16");
  assert.equal(losAngeles.rescheduleOn, "2026-12-01");
});
