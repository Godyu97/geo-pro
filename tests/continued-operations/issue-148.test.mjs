import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFormalCheckpointGate } from "../../src/features/formal-retest/rules.ts";

function makeSlot({
  index,
  window,
  naturalQuestion = true,
  slotStatus = "succeeded",
  evidenceState = "complete",
  citationSetState = "complete",
  mentioned = "true",
  recommended = "false",
  officialSiteCited = "true",
}) {
  const questionId = `q${String(index).padStart(2, "0")}`;
  const slotId = `${window}-slot-${questionId}`;
  const at = window === "before" ? "2026-10-20T12:00:00.000Z" : "2026-11-05T12:00:00.000Z";
  return {
    slotId,
    runId: `run-${window}`,
    questionId,
    naturalQuestion,
    slotStatus,
    slotCreatedAt: at,
    timezone: "UTC",
    observation: slotStatus === "succeeded"
      ? {
          id: `obs-${window}-${questionId}`,
          capturedAt: at,
          evidenceState,
          citationSetState,
          requestedNetworkMode: "off",
          networkTrigger: "not_triggered",
          newSession: "unknown",
          targetRegion: "CN",
          observedRegion: "unknown",
          entityVersion: 1,
          searchRequired: false,
          newSessionRequired: false,
          protocolRegion: null,
        }
      : null,
    analysis: slotStatus === "succeeded"
      ? {
          id: `ana-${window}-${questionId}`,
          version: 1,
          entityVersion: 1,
          ruleVersion: "rule-v1",
          status: "classified",
          mentioned,
          recommended,
          officialSiteCited,
        }
      : null,
  };
}

function build30PairSlots(override = () => ({})) {
  const slots = [];
  for (let i = 1; i <= 30; i += 1) {
    slots.push(makeSlot({ index: i, window: "before", ...override(i, "before") }));
    slots.push(makeSlot({ index: i, window: "after", ...override(i, "after") }));
  }
  return slots;
}

test("not-due checkpoint stays progress with null conclusion even when saved slots exist", () => {
  const result = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-10",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots: build30PairSlots(),
  });
  assert.equal(result.mode, "progress");
  assert.equal(result.conclusion, null);
  assert.equal(result.evaluation, null);
});

test("missing matching slots cannot pass formal and records missing_samples", () => {
  const result = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-20",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots: [],
  });
  assert.equal(result.mode, "exploratory");
  assert.equal(result.comparableCount, 0);
  assert.equal(result.evaluation?.missingSamples, true);
  assert.deepEqual(result.evaluation?.insufficiencyReasons, ["missing_samples"]);
});

test("only 23 comparable questions on recommendation stays exploratory and excludes the 7 questions", () => {
  const slots = build30PairSlots((i, window) => (
    window === "after" && i >= 24 ? { recommended: "unknown" } : {}
  ));
  const result = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-20",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots,
  });
  assert.equal(result.mode, "exploratory");
  assert.equal(result.evaluation?.metrics.mention.comparableCount, 30);
  assert.equal(result.evaluation?.metrics.recommendation.comparableCount, 23);
  assert.equal(result.evaluation?.metrics.citation.comparableCount, 30);
  assert.equal(result.evaluation?.insufficientMetrics.includes("recommendation"), true);
  assert.deepEqual(
    result.evaluation?.metrics.recommendation.excluded.map((item) => item.questionId),
    ["q24", "q25", "q26", "q27", "q28", "q29", "q30"],
  );
  assert.equal(result.evaluation?.metrics.recommendation.excluded[0]?.reason, "low_recommendation_coverage");
});

test("overall E/P below 90% or citation Jc/E below 80% stays exploratory and exposes C/E and Jc/C", () => {
  const lowCoverage = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-20",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots: build30PairSlots((i, window) => (
      window === "after" && i <= 4 ? { slotStatus: "failed" } : {}
    )),
  });
  assert.equal(lowCoverage.mode, "exploratory");
  assert.equal(lowCoverage.evaluation?.coverage.passed, false);
  assert.equal(lowCoverage.evaluation?.coverage.after.eligible, 26);
  assert.equal(lowCoverage.evaluation?.coverage.after.planned, 30);
  assert.equal(lowCoverage.evaluation?.insufficientMetrics.includes("coverage"), true);

  // 30 questions: 24 complete citations (21 judged + 3 unknown officialSiteCited) and 6 partial citations
  // C/E = 24/30 = 80.0%, Jc/C = 21/24 = 87.5%, Jc/E = 21/30 = 70.0% (< 80%)
  const lowCitation = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-20",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots: build30PairSlots((i, window) => {
      if (window !== "after") return {};
      if (i > 24) return { citationSetState: "partial", officialSiteCited: "unknown" };
      if (i > 21) return { citationSetState: "complete", officialSiteCited: "unknown" };
      return {};
    }),
  });
  assert.equal(lowCitation.mode, "exploratory");
  assert.equal(lowCitation.evaluation?.insufficientMetrics.includes("citation"), true);
  assert.equal(lowCitation.evaluation?.metrics.citation.after.cOverE, 24 / 30);
  assert.equal(lowCitation.evaluation?.metrics.citation.after.jcOverC, 21 / 24);
  assert.equal(lowCitation.evaluation?.metrics.citation.after.jcOverE, 21 / 30);
});

test("all coverage and metric gates met yields formal, and failing exploration slots do not inflate or block", () => {
  const slots = [
    ...build30PairSlots(),
    makeSlot({ index: 31, window: "before", naturalQuestion: false, slotStatus: "failed" }),
    makeSlot({ index: 31, window: "after", naturalQuestion: false, slotStatus: "failed" }),
    makeSlot({ index: 32, window: "before", naturalQuestion: false, recommended: "unknown" }),
    makeSlot({ index: 32, window: "after", naturalQuestion: false, recommended: "unknown" }),
  ];
  const result = evaluateFormalCheckpointGate({
    effectiveOn: "2026-11-01",
    today: "2026-11-20",
    checkpoint: "d14",
    frozenNonBrandCount: 30,
    hasOfficialWebsite: true,
    slots,
  });
  assert.equal(result.mode, "formal");
  assert.equal(result.comparableCount, 30);
  assert.deepEqual(result.evaluation?.insufficientMetrics, []);
  assert.equal(result.evaluation?.coverage.before.planned, 30);
  assert.equal(result.evaluation?.coverage.after.planned, 30);
  assert.equal(result.evaluation?.metrics.citation.before.cOverE, 1);
  assert.equal(result.evaluation?.metrics.citation.before.jcOverC, 1);
  assert.equal(result.evaluation?.metrics.citation.after.cOverE, 1);
  assert.equal(result.evaluation?.metrics.citation.after.jcOverC, 1);
});
