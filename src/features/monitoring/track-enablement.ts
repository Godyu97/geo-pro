export type SamplingTrack = "official_api" | "consumer_manual";

/** Official API and consumer capture stay separate. Unknown price or an unverified capability stays off. */
export function enableTrack(input: {
  track: SamplingTrack;
  capabilityVerified: boolean;
  priceKnown: boolean;
  authorized: boolean;
}) {
  if (!input.authorized || !input.capabilityVerified) {
    return { enabled: false, automaticConsumerCollection: false, reason: "unverified" as const };
  }
  if (input.track === "official_api" && !input.priceKnown) {
    return { enabled: false, automaticConsumerCollection: false, reason: "price_unknown" as const };
  }
  return { enabled: true, automaticConsumerCollection: false, reason: "ready" as const };
}
