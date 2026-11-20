import assert from "node:assert/strict";
import { test } from "node:test";
import { assistedCapture, confirmCapture } from "../../src/features/assisted-capture/rules.ts";

test("a login wall stops the helper and does not bypass it", () => {
  const capture = assistedCapture({ blockedBy: "login", citationCount: 0 });
  assert.equal(capture.status, "handoff");
  assert.equal(capture.bypass, false);
  assert.equal(confirmCapture(capture.status, true).saved, false);
});

test("missing citations stay partial until a person confirms a complete preview", () => {
  const partial = assistedCapture({ blockedBy: null, citationCount: 0 });
  assert.equal(partial.complete, false);
  assert.equal(partial.silentEmptyCitations, false);
  const saved = confirmCapture(partial.status, true);
  assert.equal(saved.saved, true);
  assert.equal(saved.complete, false);
  assert.equal(confirmCapture("preview", true).complete, true);
});
