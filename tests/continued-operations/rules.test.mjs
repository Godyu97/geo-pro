import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupedLead, conversionRate, crawlerVisitIsNotAiInclusion } from "../../src/features/business-feedback/rules.ts";
import { calendarRow, maintenanceQueue, variantNeedsOwnApproval } from "../../src/features/channel-variants/rules.ts";
import { mentionShare, rankDistribution } from "../../src/features/competitor-share/rules.ts";
import { correctionStatus, errorRate, sameNameConfusion } from "../../src/features/entity-accuracy/rules.ts";
import { batchEffectiveAt, checkpointDue, formalComparison } from "../../src/features/formal-retest/rules.ts";
import { importBatch, revokedAssetReferences, templateAllowsInvention } from "../../src/features/asset-reuse/rules.ts";
import { mergeAlerts, planAlerts } from "../../src/features/quality-alerts/rules.ts";
import { coverageDenominator, pauseIneligibleChannel, pauseUnfundedSlots } from "../../src/features/sampling-plans/rules.ts";
import { pageSupport, researchBrief } from "../../src/features/source-opportunities/rules.ts";
import { approveContent, brandVisible, revokedAction } from "../../src/features/team-access/rules.ts";

test("budget pause keeps failed slots in the coverage denominator", () => {
  const slots = [
    { id: "past-fail", channelId: "api", at: "2026-11-01T00:00:00.000Z", status: "failed", manual: false },
    { id: "future", channelId: "api", at: "2026-11-20T00:00:00.000Z", status: "scheduled", manual: false },
    { id: "manual", channelId: "human", at: "2026-11-21T00:00:00.000Z", status: "scheduled", manual: true },
  ];
  const paused = pauseUnfundedSlots(slots, { spentMinor: 80, pendingMinor: 20, budgetMinor: 100, nextAt: "2026-11-18T00:00:00.000Z" });
  assert.deepEqual(paused.pausedIds, ["future", "manual"]);
  assert.equal(coverageDenominator(paused.slots).some((slot) => slot.id === "past-fail"), true);
  const onlyApi = pauseIneligibleChannel(slots, { channelId: "api", nextAt: "2026-11-18T00:00:00.000Z" });
  assert.equal(onlyApi.find((slot) => slot.id === "manual")?.status, "scheduled");
  assert.equal(onlyApi.find((slot) => slot.id === "future")?.status, "paused");
});

test("quality alerts prefer coverage gaps and merge the same window", () => {
  assert.deepEqual(planAlerts({ brandId: "b", kind: "trend", windowId: "w", coverageSufficient: false, dropPp: 20 }), ["data_quality"]);
  assert.deepEqual(planAlerts({ brandId: "b", kind: "trend", windowId: "w", coverageSufficient: true, dropPp: 11 }), ["trend"]);
  const first = { brandId: "b", kind: "data_quality", windowId: "w" };
  assert.equal(mergeAlerts([first], first).created, false);
});

test("competitor share counts one mention per answer and skips unordered rank", () => {
  const share = mentionShare([
    { answerId: "a1", brandId: "self" },
    { answerId: "a1", brandId: "self" },
    { answerId: "a1", brandId: "other" },
  ], ["self", "other"]);
  assert.equal(share[0].count, 1);
  assert.equal(share[0].denominator, 1);
  assert.equal(rankDistribution({ ordered: false, positions: [1] }).ranked, false);
});

test("unreadable citations stay unknown and briefs keep their sources", () => {
  assert.equal(pageSupport({ cited: true, readable: false, supportsBrand: true }), "unknown");
  const brief = researchBrief({ gap: "缺口", facts: ["已批准事实"], sourceIds: ["s1"] });
  assert.equal(brief.copiedReplacement, false);
  assert.deepEqual(brief.sourceIds, ["s1"]);
});

test("fact error rate uses the reviewed sample and corrections stay unresolved until retest", () => {
  const rate = errorRate({ reviewed: 10, population: 50, confirmedErrors: 2 });
  assert.equal(rate.rate, 0.2);
  assert.equal(rate.population, 50);
  assert.equal(correctionStatus({ actionDone: true, retestStillWrong: true }).effect, "unresolved");
  assert.equal(sameNameConfusion({ sameSurfaceName: true, confirmedDifferentEntity: true }).countAsTargetMention, false);
});

test("partial document import does not invent pages and revoked assets keep references", () => {
  const imported = importBatch([{ name: "a.pdf", bytes: 100, chars: 20, encrypted: false, pages: [{ page: 1, text: "ok" }, { page: null, text: null }] }]);
  assert.equal(imported[0].status, "partial");
  assert.equal(imported[0].pages[1].text, null);
  const revoked = revokedAssetReferences({ assetId: "img", references: [{ contentId: "c1", assetVersion: 2 }] });
  assert.equal(revoked.deletedHistory, false);
  assert.equal(templateAllowsInvention({ asksToInventCaseStudy: true }).allowed, false);
});

test("channel variants do not inherit approval and maintenance collapses duplicate pages", () => {
  assert.equal(variantNeedsOwnApproval(true, { id: "v", channel: "zhihu", approved: true, body: "新价格" }, "旧价格"), true);
  assert.equal(maintenanceQueue({ factId: "f", pageIds: ["p", "p", "q"] }).taskCount, 1);
  assert.equal(calendarRow({ plannedOn: "2026-11-01", verifiedOn: null, blocked: true }).published, false);
});

test("formal checkpoints wait for calendar time, coverage and the last verification", () => {
  assert.equal(checkpointDue({ effectiveOn: "2026-11-01", today: "2026-11-10", checkpoint: "d14" }), false);
  const comparison = formalComparison({ comparableQuestions: 23, frozenQuestions: 30, excluded: ["q24"] });
  assert.equal(comparison.mode, "exploratory");
  assert.equal(batchEffectiveAt(["2026-11-01T00:00:00.000Z", null]), null);
  assert.equal(batchEffectiveAt(["2026-11-01T00:00:00.000Z", "2026-11-03T00:00:00.000Z"]), "2026-11-03T00:00:00.000Z");
});

test("business feedback dedups one event and refuses a missing conversion denominator", () => {
  const leads = dedupedLead([
    { eventId: "e1", evidence: "self_report" },
    { eventId: "e1", evidence: "referral" },
  ]);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].primary, "referral");
  assert.equal(conversionRate({ numerator: 2, denominator: null }).rate, null);
  assert.equal(crawlerVisitIsNotAiInclusion({ crawlerVisits: 4, answerCitations: 0 }).calledIncluded, false);
});

test("team approval separates author from approver and hides other brands", () => {
  assert.equal(approveContent({ dualControl: true, authorId: "a", actorId: "a", actorCanApprove: true }).reason, "separation");
  assert.deepEqual(revokedAction({ queued: true, grantRevoked: true }), { run: false, download: false });
  assert.equal(brandVisible([{ brandId: "a", active: true }], "b"), false);
});
