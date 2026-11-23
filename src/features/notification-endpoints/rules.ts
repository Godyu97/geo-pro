import { createHash } from "node:crypto";
import { notifyNext } from "../external-connections/rules.ts";

// A notice is customer text when it contains either marker. Only the boolean and hash are kept.
const customerText = /客户原文|customer text/i;

export function classifyNoticeBody(body: string) {
  return {
    bodyHasCustomerText: customerText.test(body),
    bodyHash: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

/** Local permission only. notifyNext refuses a revoked endpoint or customer text and keeps history. */
export function decideDelivery(input: { revoked: boolean; body: string }) {
  const classified = classifyNoticeBody(input.body);
  const decision = notifyNext({
    revoked: input.revoked,
    bodyHasCustomerText: classified.bodyHasCustomerText,
  });
  return {
    sent: decision.send,
    historyDeleted: decision.historyDeleted,
    bodyHasCustomerText: classified.bodyHasCustomerText,
    bodyHash: classified.bodyHash,
  };
}
