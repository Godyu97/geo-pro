import assert from "node:assert/strict";
import { test } from "node:test";
import { recordOrder, whitelabelReport } from "../../src/features/commercial/billing.ts";

test("a quote without a payment connector is not marked paid", () => {
  const order = recordOrder({ paymentConnected: false, quoted: true });
  assert.equal(order.state, "awaiting_payment");
  assert.equal(order.paid, false);
});

test("white-label output keeps the sample grade", () => {
  const report = whitelabelReport({ track: "official_api", sampleSize: 12, grade: "exploratory" });
  assert.equal(report.grade, "exploratory");
  assert.equal(report.guaranteeRemoved, false);
  assert.equal(report.sampleSize, 12);
});
