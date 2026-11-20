export type ConnectionScope = "read" | "draft" | "publish" | "notify";

/** Draft permission cannot publish. A draft receipt is not a public verification. */
export function requestPublish(input: { scopes: readonly ConnectionScope[]; confirmed: boolean }) {
  if (!input.scopes.includes("publish")) {
    return { accepted: false, reason: "manual_followup" as const, countsAsPublic: false };
  }
  if (!input.confirmed) return { accepted: false, reason: "needs_confirmation" as const, countsAsPublic: false };
  return { accepted: true, reason: "ok" as const, countsAsPublic: false };
}

/** A known or unknown acknowledgement must be reconciled before another submit. */
export function retryAction(input: { state: "acknowledged" | "unknown" | "failed"; sameKey: boolean }) {
  if (input.sameKey && (input.state === "acknowledged" || input.state === "unknown")) {
    return { submit: false, reconcile: true };
  }
  return { submit: input.state === "failed", reconcile: false };
}

export function receiptEffect(kind: "draft_created" | "public_url") {
  return { interventionEffective: kind === "public_url" };
}
