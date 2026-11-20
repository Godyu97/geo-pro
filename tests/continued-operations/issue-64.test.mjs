import assert from "node:assert/strict";
import { test } from "node:test";
import { closeAccount, supportSearch } from "../../src/features/account/closure-rules.ts";

test("support search without a reason is refused and never returns customer text", () => {
  const missing = supportSearch({ reason: "", query: "北岸" });
  assert.equal(missing.allowed, false);
  assert.equal(missing.body, null);
  const allowed = supportSearch({ reason: "用户要求定位", query: "北岸" });
  assert.equal(allowed.audited, true);
  assert.equal(allowed.body, null);
});

test("the last owner cannot close the account, and acceptance does not mean data is purged", () => {
  assert.equal(closeAccount({ owner: true, lastOwner: true, identityVerified: true }).reason, "transfer_required");
  const queued = closeAccount({ owner: true, lastOwner: false, identityVerified: true });
  assert.equal(queued.accepted, true);
  assert.equal(queued.purged, false);
});
