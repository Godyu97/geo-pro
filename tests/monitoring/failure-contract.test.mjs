import assert from "node:assert/strict";
import { test } from "node:test";
import {
  monitoringFailureBody,
  monitoringFailureStepKeys,
  monitoringSuccessCostNotice,
  samplingCostMessageKey,
} from "../../src/features/monitoring/failure-contract.ts";
import en from "../../src/lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../src/lib/i18n/messages/zh-CN.json" with { type: "json" };

const catalogs = { "zh-CN": zhCN.monitoring, en: en.monitoring };
const secretAnswer = "SECRET-ANSWER-TEXT";
const secretAmount = 12345;

function translate(catalog) {
  return (key) => catalog[key];
}

function body(catalog, input) {
  return monitoringFailureBody({ ...input, translate: translate(catalog) });
}

function attempt(overrides) {
  return {
    slotId: "slot-1",
    kind: "sampling",
    disposition: "safe_failure",
    costState: "known",
    ordinal: 1,
    ...overrides,
  };
}

test("preview of an unverified channel reports no supplier cost", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const failure = body(catalog, {
      code: "CHANNEL_UNVERIFIED",
      message: catalog.CHANNEL_UNVERIFIED,
      next: "verify-channel",
    });
    assert.equal(failure.status, 409);
    assert.equal(failure.body.error.retryable, false);
    assert.equal(failure.body.error.externalCostPossible, false);
    assert.equal(failure.body.next, "verify-channel");
    assert.equal(failure.body.error.nextStep, catalog.nextStepVerifyChannel);
    assert.equal(failure.body.error.message, catalog.CHANNEL_UNVERIFIED);
    assert.equal(JSON.stringify(failure.body).includes(secretAnswer), false, locale);
    assert.equal(JSON.stringify(failure.body).includes(String(secretAmount)), false, locale);
  }
});

test("validation, expiry, quota and permission failures stay clear of supplier cost", () => {
  const cases = [
    ["INVALID_INPUT", null, 400],
    ["PREVIEW_EXPIRED", "refresh-preview", 409],
    ["QUOTA_INSUFFICIENT", "adjust-scope", 409],
    ["FORBIDDEN", null, 403],
    ["SESSION_REQUIRED", null, 401],
    ["EMAIL_UNVERIFIED", "verify-email", 409],
  ];
  for (const [code, next, status] of cases) {
    const failure = body(zhCN.monitoring, { code, message: zhCN.monitoring[code], next });
    assert.equal(failure.status, status);
    assert.equal(failure.body.error.externalCostPossible, false);
    assert.equal(failure.body.error.retryable, false);
    assert.equal(failure.body.error.nextStep.length > 0, true);
  }
});

test("unknown sampling cost blocks another remote request", () => {
  const attempts = [attempt({ disposition: "unknown", costState: "unknown", ordinal: 1 })];
  for (const [code, next] of [["SERVICE_UNAVAILABLE", null], ["REAL_CHANNEL_CLOSED", "await-channel"]]) {
    for (const catalog of Object.values(catalogs)) {
      const failure = body(catalog, { code, message: catalog[code], next, attempts });
      assert.equal(failure.body.error.externalCostPossible, true);
      assert.equal(failure.body.error.retryable, false);
      assert.equal(failure.body.next, "reconcile-cost");
      assert.equal(failure.body.error.nextStep, catalog.nextStepReconcileCost);
      assert.equal(failure.body.error.nextStep.includes("0"), true);
      assert.match(failure.body.error.nextStep, /不要再发一次远端请求|Do not send another remote request/);
    }
  }
  const notice = monitoringSuccessCostNotice(attempts, (key) => zhCN.monitoring[key]);
  assert.equal(notice.externalCostPossible, true);
  assert.equal(notice.retryable, false);
  assert.equal(notice.nextStep, zhCN.monitoring.nextStepReconcileCost);
  assert.equal(samplingCostMessageKey("unknown", null), "actualUnknown");
  assert.equal(samplingCostMessageKey("unknown", 0), "actualUnknown");
  assert.equal(samplingCostMessageKey("pending", null), "costPending");
  assert.equal(samplingCostMessageKey("known", 0), "costKnown");
});

test("a pending attempt or an unreadable cost context is not treated as zero", () => {
  const pending = body(zhCN.monitoring, {
    code: "SERVICE_UNAVAILABLE",
    message: zhCN.monitoring.SERVICE_UNAVAILABLE,
    next: null,
    attempts: [attempt({ disposition: "pending", costState: "pending" })],
  });
  assert.equal(pending.body.error.externalCostPossible, true);
  assert.equal(pending.body.error.retryable, false);
  assert.equal(pending.body.next, "reconcile-cost");
  const unreadable = body(en.monitoring, {
    code: "SERVICE_UNAVAILABLE",
    message: en.monitoring.SERVICE_UNAVAILABLE,
    next: null,
    costUnreadable: true,
  });
  assert.equal(unreadable.body.error.externalCostPossible, true);
  assert.equal(unreadable.body.error.retryable, false);
  assert.equal(unreadable.body.error.nextStep, en.monitoring.nextStepReconcileCost);
});

test("known safe failures explain the retry limit and do not invent an unknown cost", () => {
  const open = body(zhCN.monitoring, {
    code: "CHANNEL_UNVERIFIED",
    message: zhCN.monitoring.CHANNEL_UNVERIFIED,
    next: "verify-channel",
    attempts: [attempt({ ordinal: 1 })],
  });
  assert.equal(open.body.error.externalCostPossible, false);
  assert.equal(open.body.error.retryable, false);
  assert.equal(open.body.error.nextStep.includes(zhCN.monitoring.nextStepVerifyChannel), true);
  assert.equal(open.body.error.nextStep.includes(zhCN.monitoring.nextStepRetrySafe), true);
  const exhausted = body(en.monitoring, {
    code: "SERVICE_UNAVAILABLE",
    message: en.monitoring.SERVICE_UNAVAILABLE,
    next: null,
    attempts: [1, 2, 3].map((ordinal) => attempt({ ordinal })),
  });
  assert.equal(exhausted.body.error.externalCostPossible, false);
  assert.equal(exhausted.body.error.retryable, false);
  assert.equal(exhausted.body.next, "retry-limit");
  assert.equal(exhausted.body.error.nextStep, en.monitoring.nextStepRetryLimit);
  assert.match(exhausted.body.error.nextStep, /Do not send another remote request/);
});

test("another account receives not-found without cost or answer text", () => {
  for (const catalog of Object.values(catalogs)) {
    const failure = body(catalog, {
      code: "NOT_FOUND",
      message: catalog.NOT_FOUND,
      next: null,
      traceId: "trace-not-found",
    });
    assert.equal(failure.status, 404);
    assert.equal(failure.body.error.externalCostPossible, false);
    assert.equal(failure.body.error.retryable, false);
    assert.equal(failure.body.error.nextStep, catalog.nextStepNotFound);
    assert.deepEqual(Object.keys(failure.body).sort(), ["error", "next", "traceId"]);
    assert.deepEqual(Object.keys(failure.body.error).sort(), ["code", "externalCostPossible", "message", "nextStep", "retryable"]);
    const encoded = JSON.stringify(failure.body);
    assert.equal(encoded.includes(secretAnswer), false);
    assert.equal(encoded.includes(String(secretAmount)), false);
    assert.equal(encoded.includes("actualMinor"), false);
    assert.equal(encoded.includes("rawText"), false);
    assert.equal(/\d/.test(failure.body.error.message + failure.body.error.nextStep), false);
  }
});

test("service interruption before any attempt can be retried", () => {
  const failure = body(zhCN.monitoring, {
    code: "SERVICE_UNAVAILABLE",
    message: zhCN.monitoring.SERVICE_UNAVAILABLE,
    next: null,
  });
  assert.equal(failure.status, 503);
  assert.equal(failure.body.error.retryable, true);
  assert.equal(failure.body.error.externalCostPossible, false);
  assert.equal(failure.body.error.nextStep, zhCN.monitoring.nextStepRetryLater);
});

test("failure next steps exist in both interface languages", () => {
  for (const key of monitoringFailureStepKeys) {
    assert.equal(typeof zhCN.monitoring[key], "string");
    assert.equal(typeof en.monitoring[key], "string");
    assert.equal(zhCN.monitoring[key].length > 0, true);
    assert.equal(en.monitoring[key].length > 0, true);
  }
});
