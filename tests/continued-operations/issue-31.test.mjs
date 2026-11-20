import assert from "node:assert/strict";
import { test } from "node:test";
import { enableTrack } from "../../src/features/monitoring/track-enablement.ts";

test("an official track with an unknown price stays disabled", () => {
  const closed = enableTrack({
    track: "official_api",
    capabilityVerified: true,
    priceKnown: false,
    authorized: true,
  });
  assert.equal(closed.enabled, false);
  assert.equal(closed.reason, "price_unknown");
});

test("a verified consumer track is manual and does not enable the official track", () => {
  const manual = enableTrack({
    track: "consumer_manual",
    capabilityVerified: true,
    priceKnown: false,
    authorized: true,
  });
  assert.equal(manual.enabled, true);
  assert.equal(manual.automaticConsumerCollection, false);
  const other = enableTrack({
    track: "official_api",
    capabilityVerified: false,
    priceKnown: true,
    authorized: true,
  });
  assert.equal(other.enabled, false);
});
