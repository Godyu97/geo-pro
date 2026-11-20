import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneTemplate, revokeAsset } from "../../src/features/asset-reuse/rules.ts";

test("revoking an asset keeps the pinned references and opens todos", () => {
  const revoked = revokeAsset({ assetId: "img", references: [{ contentId: "c1", assetVersion: 2 }] });
  assert.equal(revoked.deletedHistory, false);
  assert.equal(revoked.status, "revoked");
  assert.deepEqual(revoked.todos, [{ contentId: "c1", assetVersion: 2 }]);
});

test("a custom template cannot disable the fact, license, or review gates", () => {
  const blocked = cloneTemplate({ system: false, gates: { fact: true, publicLicense: false, review: true } });
  assert.equal(blocked.cloned, false);
  const cloned = cloneTemplate({ system: true, gates: { fact: true, publicLicense: true, review: true } });
  assert.equal(cloned.cloned, true);
  if (cloned.cloned) assert.equal(cloned.readOnlySource, true);
});
