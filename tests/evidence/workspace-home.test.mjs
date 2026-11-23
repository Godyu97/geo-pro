import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { readWorkspaceHome, workspaceEntryHrefs } from "../../src/features/evidence/workspace-home.ts";
import { analysisRuleVersion, fingerprintAnswer } from "../../src/features/evidence/rules.ts";
import { functionalMockMarker } from "../../src/features/functional-mock/mode.ts";
import { OptimizationDao } from "../../src/features/optimization/dao.ts";
import { taskDisplayLabels } from "../../src/features/optimization/task-labels.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import zhCN from "../../src/lib/i18n/messages/zh-CN.json" with { type: "json" };
import en from "../../src/lib/i18n/messages/en.json" with { type: "json" };
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T02:00:00.000Z";
const fields = {
  name: "乙品牌", description: "Synthetic brand for the workspace home", website: "",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};
const internalCodes = ["todo", "doing", "blocked", "implemented", "retest_pending", "closed", "dismissed", "urgent", "normal"];

test("workspace entries stay on the existing brand, overview, optimization, content, and report routes", () => {
  assert.deepEqual(workspaceEntryHrefs, {
    brands: "/dashboard/brands",
    monitoring: "/dashboard/monitoring/overview",
    optimization: "/dashboard/optimization",
    content: "/dashboard/content",
    reports: "/dashboard/reports",
  });
});

test("task labels in zh-CN and en are not internal status codes", () => {
  const tasks = [
    { status: "todo", priorityBucket: "urgent" },
    { status: "doing", priorityBucket: "normal" },
    { status: "blocked", priorityBucket: "urgent" },
    { status: "implemented", priorityBucket: "normal" },
    { status: "retest_pending", priorityBucket: "normal" },
    { status: "closed", priorityBucket: "normal" },
    { status: "dismissed", priorityBucket: "normal" },
  ];
  for (const messages of [zhCN.evidenceOverview, en.evidenceOverview]) {
    for (const task of tasks) {
      const labels = taskDisplayLabels(messages, task);
      const visible = `${labels.priority} ${labels.status}`;
      assert.equal(internalCodes.includes(labels.status), false);
      assert.equal(internalCodes.includes(labels.priority), false);
      assert.equal(visible.includes("_"), false);
      assert.equal(visible.includes(task.status), false);
      assert.equal(visible.includes(task.priorityBucket), false);
    }
  }
});

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Workspace owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

async function brandFor(db, ownerId, name) {
  const id = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, id, time);
  await brands.insertVersion(id, 1, { ...fields, name }, time);
  return id;
}

function observation(ownerId, brandId, partial) {
  const questionText = partial.questionText;
  const answerText = partial.answerText;
  const id = randomUUID();
  return {
    id,
    brandId,
    ownerId,
    slotId: null,
    attemptId: null,
    sourceMode: partial.sourceMode,
    captureMethod: partial.sourceMode === "consumer_ui" ? "manual" : "official_api",
    questionText,
    answerText,
    fingerprint: fingerprintAnswer(questionText, answerText),
    capturedAt: time,
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    targetRegion: "CN",
    observedRegion: "unknown",
    newSession: "unknown",
    productMode: "unknown",
    networkTrigger: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    evidenceState: "complete",
    locatorRef: null,
    collectorId: null,
    missingReason: null,
    createdAt: time,
    mentioned: partial.mentioned,
  };
}

async function saveObservation(db, row) {
  const evidence = new EvidenceDao(db);
  await evidence.insertObservation(row);
  await evidence.insertAnalysis({
    id: randomUUID(),
    observationId: row.id,
    brandId: row.brandId,
    version: 1,
    entityVersion: 1,
    ruleVersion: analysisRuleVersion,
    mentioned: row.mentioned,
    recommended: "false",
    officialSiteCited: "false",
    evidenceSpan: null,
    status: "classified",
    revisedFrom: null,
    reason: null,
    reviewerId: null,
    createdAt: time,
  });
}

async function saveTask(db, ownerId, brandId, partial) {
  const findingId = randomUUID();
  const taskId = randomUUID();
  const optimization = new OptimizationDao(db);
  await optimization.insertFinding({
    id: findingId,
    brandId,
    ownerId,
    gapType: "needs_evidence",
    questionCluster: partial.cluster,
    targetPage: `https://yi.example.com/${partial.cluster}`,
    observationId: null,
    analysisVersionId: null,
    evidenceSummary: "synthetic",
    problemStatement: "synthetic",
    hypothesis: "pending",
    assumptionLevel: "pending",
    stepsJson: "[]",
    completionCriteria: "recorded",
    retestMethod: "same scope",
    businessImportance: 2,
    estimatedEffort: 2,
    verifiedEvidence: 1,
    privacyRisk: 0,
    createdAt: time,
  });
  await optimization.insertTask({
    id: taskId,
    brandId,
    ownerId,
    primaryFindingId: findingId,
    gapType: "needs_evidence",
    questionCluster: partial.cluster,
    targetPage: `https://yi.example.com/${partial.cluster}`,
    title: partial.title,
    status: partial.status,
    priorityBucket: partial.priorityBucket,
    manualRank: null,
    reorderReason: null,
    completionNote: null,
    dismissReason: null,
    retestConclusion: null,
    createdAt: time,
    updatedAt: time,
  });
  return taskId;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: workspace home uses the default official scope and hides other brands`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const cache = memoryCache();
    const [emptyOwner, readyOwner, outsider] = await Promise.all([account(db), account(db), account(db)]);
    const emptyBrand = await brandFor(db, emptyOwner, "空品牌");
    const readyBrand = await brandFor(db, readyOwner, "乙品牌");

    const emptyHome = await readWorkspaceHome(db, emptyOwner, cache);
    assert.equal(emptyHome.state, "ready");
    assert.equal(emptyHome.overview.scope.brandId, emptyBrand);
    assert.equal(emptyHome.overview.scope.sourceMode, "model_api");
    assert.equal(emptyHome.overview.scope.region, null);
    assert.equal(emptyHome.overview.scope.requestedNetworkMode, null);
    assert.equal(emptyHome.overview.scope.from, null);
    assert.equal(emptyHome.overview.scope.to, null);
    assert.equal(emptyHome.overview.viewStatus, "empty");
    assert.equal(emptyHome.overview.demo, false);
    for (const metric of Object.values(emptyHome.overview.metrics)) {
      assert.equal(metric.status, "na");
      assert.equal(metric.equalWeight, null);
      assert.equal(metric.pooled.rate, null);
    }
    assert.equal(emptyHome.overview.suggestions.length, 0);
    assert.equal(emptyHome.overview.activeTasks.length, 0);
    assert.equal(emptyHome.overview.nextActions.some((action) => action.kind === "start_monitoring"), true);

    const real = observation(readyOwner, readyBrand, {
      questionText: "这个品类里该怎么选？",
      answerText: "当前回答没有点名乙品牌。",
      sourceMode: "model_api",
      mentioned: "false",
    });
    const mock = observation(readyOwner, readyBrand, {
      questionText: "演示问题不进入分母",
      answerText: `${functionalMockMarker} 演示里提到了乙品牌。`,
      sourceMode: "model_api",
      mentioned: "true",
    });
    const consumer = observation(readyOwner, readyBrand, {
      questionText: "消费者轨道单独计算",
      answerText: "消费者回答提到了乙品牌。",
      sourceMode: "consumer_ui",
      mentioned: "true",
    });
    await saveObservation(db, real);
    await saveObservation(db, mock);
    await saveObservation(db, consumer);

    await saveTask(db, readyOwner, readyBrand, { cluster: "c1", title: "建议一", status: "todo", priorityBucket: "urgent" });
    await saveTask(db, readyOwner, readyBrand, { cluster: "c2", title: "建议二", status: "todo", priorityBucket: "urgent" });
    await saveTask(db, readyOwner, readyBrand, { cluster: "c3", title: "建议三", status: "todo", priorityBucket: "urgent" });
    await saveTask(db, readyOwner, readyBrand, { cluster: "c4", title: "建议四", status: "todo", priorityBucket: "urgent" });
    const doingId = await saveTask(db, readyOwner, readyBrand, { cluster: "c5", title: "进行中的公开页", status: "doing", priorityBucket: "normal" });
    const blockedId = await saveTask(db, readyOwner, readyBrand, { cluster: "c6", title: "阻塞补证", status: "blocked", priorityBucket: "normal" });
    await saveTask(db, readyOwner, readyBrand, { cluster: "c7", title: "已关闭任务", status: "closed", priorityBucket: "urgent" });

    const home = await readWorkspaceHome(db, readyOwner, cache);
    const direct = await readEvidenceOverview(db, readyOwner, { brandId: readyBrand, sourceMode: "model_api" }, cache);
    assert.equal(home.state, "ready");
    assert.equal("error" in direct, false);
    assert.deepEqual(home.overview.metrics, direct.metrics);
    assert.equal(home.overview.sampleCount, 1);
    assert.equal(home.overview.metrics.mentioned.equalWeight, 0);
    assert.equal(home.overview.metrics.recommended.status, "ready");
    assert.equal(home.overview.metrics.officialSiteCited.status, "na");
    assert.equal(home.overview.metrics.officialSiteCited.reason, "official-website-not-applicable");
    assert.equal(home.overview.smallSample, true);
    assert.equal(home.overview.demo, false);
    assert.ok(home.overview.suggestions.length <= 3);
    assert.equal(home.overview.suggestions.length, 3);
    assert.equal(home.overview.suggestions.every((item) => item.status === "todo"), true);
    assert.deepEqual(
      home.overview.activeTasks.map((item) => item.id).sort(),
      [doingId, blockedId].sort(),
    );
    assert.equal(home.overview.activeTasks.every((item) => item.status === "doing" || item.status === "blocked"), true);
    assert.equal(home.overview.suggestions.some((item) => item.title === "已关闭任务"), false);
    assert.equal(home.overview.activeTasks.some((item) => item.title === "已关闭任务"), false);
    assert.equal(JSON.stringify(home.overview).includes(functionalMockMarker), false);

    const outsiderHome = await readWorkspaceHome(db, outsider, cache);
    assert.equal(outsiderHome.state, "no-brand");
    const denied = await readEvidenceOverview(db, outsider, { brandId: readyBrand, sourceMode: "model_api" }, cache);
    assert.equal(denied.error, "NOT_FOUND");
  });
}
