import assert from "node:assert/strict";
import { test } from "node:test";
import { batchExport, canExport, invitePreview, leaveWorkspace } from "../../src/features/team-access/rules.ts";

test("the last owner cannot leave, and a reader without an export grant cannot export", () => {
  assert.equal(leaveWorkspace({ actorIsLastOwner: true }).reason, "transfer_required");
  assert.equal(canExport({ exportGrant: false }), false);
  assert.equal(invitePreview().exposesPrivateBrandName, false);
});

test("a batch that asks for another brand returns no rows", () => {
  const result = batchExport({ grantedBrandIds: ["a"], requestedBrandIds: ["a", "b"] });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.denied, ["b"]);
});
