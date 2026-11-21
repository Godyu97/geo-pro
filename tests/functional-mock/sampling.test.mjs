import assert from "node:assert/strict";
import { test } from "node:test";
import { mockOfficialUnitMinor } from "../../src/features/functional-mock/channels.ts";
import { mockSampleAnswer, mockSamplingBudgetMinor, mockSamplingCountLimit } from "../../src/features/functional-mock/sampling.ts";

test("mock sampling answers stay synthetic and labeled", () => {
  const sample = mockSampleAnswer("question-1");
  assert.equal(sample.synthetic, true);
  assert.equal(sample.disposition, "adopted");
  if (sample.disposition === "adopted") {
    assert.match(sample.rawText, /FUNCTIONAL-MOCK/);
    assert.match(sample.rawText, /question-1/);
    assert.equal(sample.actualMinor, mockOfficialUnitMinor);
  }
  assert.ok(mockSamplingCountLimit >= 6);
  assert.ok(mockSamplingBudgetMinor >= mockOfficialUnitMinor);
});
