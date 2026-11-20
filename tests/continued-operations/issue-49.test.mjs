import assert from "node:assert/strict";
import { test } from "node:test";
import { exportPackage, settleChannels, variantNeedsOwnApproval } from "../../src/features/channel-variants/rules.ts";

test("a changed variant price does not inherit the master approval", () => {
  const needs = variantNeedsOwnApproval(
    true,
    { id: "v", channel: "zhihu", approved: true, body: "新价格" },
    "旧价格",
  );
  assert.equal(needs, true);
});

test("one blocked channel does not roll back the verified ones, and tables stay in the package", () => {
  const settled = settleChannels([
    { channel: "site", state: "verified" },
    { channel: "zhihu", state: "blocked" },
    { channel: "wechat", state: "verified" },
  ]);
  assert.deepEqual(settled.verified, ["site", "wechat"]);
  assert.deepEqual(settled.blocked, ["zhihu"]);
  assert.deepEqual(settled.rolledBack, []);
  const pack = exportPackage({ markdown: "正文", tables: ["价格表"] });
  assert.deepEqual(pack.tables, ["价格表"]);
  assert.equal(pack.droppedTables, 0);
});
