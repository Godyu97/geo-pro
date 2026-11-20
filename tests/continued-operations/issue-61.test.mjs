import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyNext } from "../../src/features/external-connections/rules.ts";

test("revocation stops the next notice and keeps history", () => {
  const stopped = notifyNext({ revoked: true, bodyHasCustomerText: false });
  assert.equal(stopped.send, false);
  assert.equal(stopped.historyDeleted, false);
  const leaked = notifyNext({ revoked: false, bodyHasCustomerText: true });
  assert.equal(leaked.send, false);
  assert.equal(notifyNext({ revoked: false, bodyHasCustomerText: false }).send, true);
});
