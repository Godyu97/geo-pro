import assert from "node:assert/strict";
import { test } from "node:test";
import { assessMonitoringAlert, recordAlertOccurrence } from "../../src/features/quality-alerts/rules.ts";

const windowSample = {
  windowId: "w2",
  completed: true,
  coverageSufficient: false,
  citationFieldChanged: false,
  modeChanged: false,
  recommendationRate: 0.2,
};

test("a falling rate with poor coverage does not claim a brand decline", () => {
  const result = assessMonitoringAlert([
    { ...windowSample, windowId: "w1", coverageSufficient: true, recommendationRate: 0.4 },
    windowSample,
  ]);
  assert.equal(result.kind, "data_quality");
  assert.equal(result.claimBrandDecline, false);
});

test("one completed window is not a trend, and a repeat stays one alert", () => {
  const single = assessMonitoringAlert([
    { ...windowSample, coverageSufficient: true, recommendationRate: 0.2 },
  ]);
  assert.equal(single.kind, "none");
  const trend = assessMonitoringAlert([
    { ...windowSample, windowId: "w1", coverageSufficient: true, recommendationRate: 0.4 },
    { ...windowSample, coverageSufficient: true, recommendationRate: 0.2 },
  ]);
  assert.equal(trend.kind, "trend");
  const alert = { brandId: "b", kind: "data_quality", windowId: "w2", status: "open", occurrences: ["o1"] };
  const again = recordAlertOccurrence(alert, "acknowledged", "o2");
  assert.equal(again?.status, "acknowledged");
  assert.deepEqual(again?.occurrences, ["o1", "o2"]);
  assert.equal(recordAlertOccurrence({ ...alert, status: "acknowledged" }, "open", "o3"), null);
});
