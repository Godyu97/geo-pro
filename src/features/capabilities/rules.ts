import type { CapabilitySnapshot, CapabilityStatus } from "./contracts.ts";

const dayMs = 30 * 24 * 60 * 60 * 1000;

export function defaultExpiresAt(verifiedAt: string) {
  return new Date(Date.parse(verifiedAt) + dayMs).toISOString();
}

export function formalRunEligibility(snapshot: Pick<CapabilitySnapshot, "status" | "verifiedAt" | "expiresAt"> | null, now: string) {
  if (!snapshot) return "missing" as const;
  if (snapshot.status === "disabled") return "disabled" as const;
  if (snapshot.status === "degraded") return "degraded" as const;
  if (snapshot.status !== "verified" || !snapshot.verifiedAt) return "unverified" as const;
  if (!snapshot.expiresAt || snapshot.expiresAt <= now) return "expired" as const;
  return "eligible" as const;
}

export function deriveNetworkEvidence(input: {
  requestedNetworkMode: "on" | "off" | "unknown";
  triggerEvidence: "none" | "observed";
  searchRequired: 0 | 1;
}) {
  const actualNetwork = input.triggerEvidence === "observed"
    ? "true"
    : input.requestedNetworkMode === "off" ? "false" : "unknown";
  const qualifiesRequiredSearch = input.searchRequired === 1 && actualNetwork === "true" ? 1 as const : 0 as const;
  return { actualNetwork, qualifiesRequiredSearch } as const;
}

export function publicProjectionAllowed(status: CapabilityStatus, publicVisible: 0 | 1, expiresAt: string | null, now: string) {
  return status === "verified" && publicVisible === 1 && !!expiresAt && expiresAt > now;
}
