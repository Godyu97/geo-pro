import assert from "node:assert/strict";
import { test } from "node:test";
import { previewSync, syncEvents } from "../../src/features/data-connections/sync.ts";

test("csv and connector rows with one event id stay a single lead", () => {
  const leads = syncEvents([
    { eventId: "e1", source: "csv" },
    { eventId: "e1", source: "connector" },
  ]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].count, 1);
  assert.deepEqual(leads[0].sources, ["csv", "connector"]);
});

test("the first sync does not pull until the field preview is approved", () => {
  const preview = previewSync({ approved: false, fieldNames: ["event_id"] });
  assert.equal(preview.pull, false);
  assert.deepEqual(preview.fields, ["event_id"]);
});
