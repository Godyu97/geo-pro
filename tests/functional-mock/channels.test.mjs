import assert from "node:assert/strict";
import { test } from "node:test";
import { mockChannelDraft, mockOfficialUnitMinor, mockVendorId } from "../../src/features/functional-mock/channels.ts";

test("mock dual-track channels stay labeled and unpublished", () => {
  const now = "2026-11-21T00:00:00.000Z";
  const official = mockChannelDraft("model_api", now);
  const consumer = mockChannelDraft("consumer_ui", now);
  assert.equal(official.vendorId, mockVendorId);
  assert.equal(consumer.vendorId, mockVendorId);
  assert.equal(official.publicVisible, 0);
  assert.equal(consumer.publicVisible, 0);
  assert.match(official.limitsSummary, /FUNCTIONAL-MOCK/);
  assert.match(official.limitsSummary, new RegExp(String(mockOfficialUnitMinor)));
  assert.match(consumer.displayName, /FUNCTIONAL-MOCK/);
  assert.notEqual(official.productEntry, consumer.productEntry);
  assert.ok(official.expiresAt > now);
});
