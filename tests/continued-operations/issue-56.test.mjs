import assert from "node:assert/strict";
import { test } from "node:test";
import { approveSeparated } from "../../src/features/team-access/rules.ts";

test("fact approval does not grant content approval, and the author cannot self-approve", () => {
  const duty = approveSeparated({
    dualControl: true,
    kind: "content",
    authorId: "author",
    actorId: "reviewer",
    actorFactApprover: true,
    actorContentApprover: false,
    historicalSingleApproval: true,
  });
  assert.equal(duty.allowed, false);
  assert.equal(duty.reason, "duty");
  assert.equal(duty.historicalUntouched, true);
  const self = approveSeparated({
    dualControl: true,
    kind: "fact",
    authorId: "author",
    actorId: "author",
    actorFactApprover: true,
    actorContentApprover: false,
    historicalSingleApproval: true,
  });
  assert.equal(self.reason, "separation");
  assert.equal(self.historicalUntouched, true);
});
