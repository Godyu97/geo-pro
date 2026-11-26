import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { latestPromptSetQuery, PromptDao, promptSetBatchQuery } from "../../src/features/prompts/dao.ts";
import { acknowledgeQualityAlert } from "../../src/features/quality-alerts/commands.ts";
import { saveSamplingPlan, transitionSamplingPlan } from "../../src/features/sampling-plans/commands.ts";
import { driveDueWindowSchema } from "../../src/features/sampling-plans/contracts.ts";
import { samplingDueRunLookupQuery } from "../../src/features/sampling-plans/due-dao.ts";
import { driveDueSamplingWindow, listSamplingDueWindows, manualSheetsForBrand } from "../../src/features/sampling-plans/due-commands.ts";
import { localWindowId } from "../../src/features/sampling-plans/due-window.ts";
import { manualSheetLines } from "../../src/features/sampling-plans/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { createTranslator } from "../../src/lib/i18n/translate.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T01:00:00.000Z";
const runAt = "2026-11-20T02:00:00.000Z";
const dueAt = "2026-11-23T02:00:00.000Z";
const futureAt = "2026-11-25T02:00:00.000Z";
const failedAt = "2026-11-01T02:00:00.000Z";
const earlierAt = "2026-11-22T02:00:00.000Z";

function slot(id, channelId, at, status, manual, costMinor) {
  return { id, channelId, at, status, manual, costMinor };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Due window owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function stubRun(db, brandId, ownerId) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'model_api', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 10, 10, 0, 'queued', 0, ?)`,
    [id, brandId, ownerId, randomUUID(), "f".repeat(64), randomUUID(), time],
  );
  return id;
}

async function observe(db, brandId, ownerId, capturedAt, recommended) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO answer_observation (
      id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
      fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
      evidence_state, locator_ref, collector_id, missing_reason, created_at, target_region, observed_region,
      new_session, product_mode, network_trigger
    ) VALUES (?, ?, ?, NULL, NULL, 'model_api', 'official_api', 'question', 'answer text', ?, ?, 'CN', 'zh-CN',
      'off', 1, 'complete', 'complete', NULL, NULL, NULL, ?, 'CN', 'unknown', 'unknown', 'unknown', 'not_triggered')`,
    [id, brandId, ownerId, "a".repeat(64), capturedAt, capturedAt],
  );
  await queryWithParameters(
    db,
    `INSERT INTO answer_analysis_version (
      id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
      official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
    ) VALUES (?, ?, ?, 1, 1, 'metrics-v3', 'true', ?, 'unknown', NULL, 'classified', NULL, NULL, NULL, ?)`,
    [randomUUID(), id, brandId, recommended, capturedAt],
  );
}

function drive(planId, channels, promptIds, now = time) {
  return {
    planId,
    timezone: "Asia/Shanghai",
    now,
    channels,
    promptIds,
  };
}

const brandFields = {
  name: "北岸设备",
  description: "合成品牌，只用于人工题单验收。",
  website: "https://manual-sheet.example.com",
  aliases: [],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function cluster(id) {
  return { id, audience: "门店负责人", intent: "安排巡检", primaryPage: "", conversionAction: "" };
}

function question(id, clusterId, text) {
  return {
    id, clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false,
  };
}

test("a manual sheet lists frozen text and does not invent a replacement", async () => {
  const kept = randomUUID();
  const missing = randomUUID();
  const unused = randomUUID();
  const saved = new Map([
    [kept, "门店如何安排设备巡检"],
    [unused, "不该替补的题目正文"],
  ]);
  const sheet = manualSheetLines([kept, missing], saved);
  assert.equal(sheet.execution, "manual");
  assert.equal(sheet.automaticCollection, false);
  assert.deepEqual(sheet.lines, [
    { id: kept, text: "门店如何安排设备巡检", missing: false },
    { id: missing, text: null, missing: true },
  ]);
  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  const zhT = createTranslator("zh-CN", zh.samplingPlans);
  const enT = createTranslator("en", en.samplingPlans);
  assert.match(zhT("dueSheet", { slot: "slot" }), /不会记成自动采集/);
  assert.equal(zhT("dueSheetFrozenVersion", { version: "2", id: "set-2" }), "冻结题集版本 2（set-2）");
  assert.equal(zhT("dueSheetVersionUnverified"), "缺少可验证的冻结题集版本，无法核对版本或题目正文。");
  assert.equal(zhT("dueSheetManual"), "人工，非自动采集");
  assert.equal(zhT("duePromptMissing"), "题目缺失");
  assert.equal(zhT("duePromptUnverified"), "版本或正文无法核对");
  assert.match(enT("dueSheet", { slot: "slot" }), /Manual/);
  assert.match(enT("dueSheet", { slot: "slot" }), /not automatic collection/);
  assert.equal(enT("dueSheetFrozenVersion", { version: "2", id: "set-2" }), "Frozen question set version 2 (set-2)");
  assert.equal(enT("dueSheetVersionUnverified"), "No verifiable frozen question set version; version or question text cannot be verified.");
  assert.equal(enT("dueSheetManual"), "Manual, not automatic collection");
  assert.equal(enT("duePromptMissing"), "Question missing");
  assert.equal(enT("duePromptUnverified"), "Version or text cannot be verified");
  assert.equal(sheet.lines[0].text, "门店如何安排设备巡检");
});

test("a Shanghai instant keeps the local calendar day", () => {
  assert.equal(localWindowId("2026-11-22T15:59:59.000Z", "Asia/Shanghai"), "2026-11-22");
  assert.equal(localWindowId("2026-11-22T16:00:00.000Z", "Asia/Shanghai"), "2026-11-23");
  assert.equal(driveDueWindowSchema.safeParse({
    planId: randomUUID(),
    timezone: "Not/AZone",
    now: time,
    channels: [],
    promptIds: [],
  }).success, false);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: due windows pause one track, replay a run, and prefer coverage over a trend`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertVersion(brand, 1, brandFields, time);
        const promptId = randomUUID();
        const clusterId = randomUUID();
        await new PromptDao(db, brand).insertSet({
          id: randomUUID(), setId: randomUUID(), version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
          content: {
            clusters: [cluster(clusterId)],
            questions: [question(promptId, clusterId, "门店如何安排设备巡检")],
          },
          createdAt: time,
        });
        const eligible = [
          { channelId: "official-api", state: "eligible" },
          { channelId: "consumer-sheet", state: "eligible" },
        ];

        const futureId = randomUUID();
        const notDue = await saveSamplingPlan(db, owner, {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 100,
          spentMinor: 0,
          pendingMinor: 0,
          nextAt: futureAt,
          slots: [slot(futureId, "official-api", futureAt, "scheduled", false, 10)],
        }, () => time);
        const calls = [];
        const executor = async (start) => {
          calls.push(start.slotId);
          return { runId: await stubRun(db, brand, owner), chargedMinor: 7 };
        };
        const skipped = await driveDueSamplingWindow(db, owner, drive(notDue.plan.id, eligible, [promptId]), executor);
        assert.equal(skipped.error, undefined);
        assert.equal(calls.length, 0);
        assert.equal(skipped.runs.length, 0);
        assert.equal(skipped.pendingOfficialSlotIds.includes(futureId), false);
        const [futureSlot] = await queryWithParameters(db, "SELECT status FROM sampling_slot WHERE id = ?", [futureId]);
        assert.equal(futureSlot.status, "scheduled");

        const failedId = randomUUID();
        const officialId = randomUUID();
        const laterOfficialId = randomUUID();
        const opened = await saveSamplingPlan(db, owner, {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 100,
          spentMinor: 0,
          pendingMinor: 0,
          nextAt: time,
          slots: [
            slot(failedId, "official-api", failedAt, "failed", false, 10),
            slot(officialId, "official-api", runAt, "scheduled", false, 10),
            slot(laterOfficialId, "official-api", futureAt, "scheduled", false, 10),
          ],
        }, () => time);
        assert.deepEqual(await driveDueSamplingWindow(db, outsider, drive(opened.plan.id, eligible, [promptId]), executor), { error: "NOT_FOUND" });
        const first = await driveDueSamplingWindow(db, owner, drive(opened.plan.id, eligible, [promptId]), executor);
        assert.equal(first.error, undefined);
        assert.deepEqual(calls, [officialId]);
        assert.equal(first.pausedBudgetIds.length, 0);
        assert.equal(first.coverageSlotIds.includes(failedId), true);
        assert.equal(first.coverageSlotIds.includes(officialId), true);
        assert.equal(first.coverageSlotIds.includes(laterOfficialId), false);
        const officialRun = first.runs.find((run) => run.slotId === officialId);
        assert.equal(officialRun.status, "accepted");
        assert.equal(officialRun.chargedMinor, 7);
        assert.equal(officialRun.windowId, "2026-11-20");
        assert.equal(officialRun.replayed, false);
        const second = await driveDueSamplingWindow(db, owner, drive(opened.plan.id, eligible, [promptId]), executor);
        assert.deepEqual(calls, [officialId]);
        assert.equal(second.runs.find((run) => run.slotId === officialId).id, officialRun.id);
        assert.equal(second.runs.find((run) => run.slotId === officialId).chargedMinor, 7);
        assert.equal(second.runs.find((run) => run.slotId === officialId).replayed, true);
        const [runCount] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM sampling_due_run WHERE plan_id = ?", [opened.plan.id]);
        assert.equal(Number(runCount.count), 1);

        const consumerId = randomUUID();
        const expensiveId = randomUUID();
        const keptFailedId = randomUUID();
        const short = await saveSamplingPlan(db, owner, {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 10,
          spentMinor: 0,
          pendingMinor: 0,
          nextAt: "2026-12-01T00:00:00.000Z",
          slots: [
            slot(keptFailedId, "official-api", failedAt, "failed", false, 10),
            slot(expensiveId, "official-api", time, "scheduled", false, 25),
            slot(consumerId, "consumer-sheet", time, "scheduled", true, 25),
          ],
        }, () => time);
        const beforeShort = calls.length;
        const paused = await driveDueSamplingWindow(db, owner, drive(short.plan.id, eligible, [promptId]), executor);
        assert.equal(calls.length, beforeShort);
        assert.deepEqual(paused.pausedBudgetIds, [expensiveId]);
        assert.equal(paused.pausedChannelIds.length, 0);
        const sheet = paused.runs.find((run) => run.slotId === consumerId);
        assert.equal(sheet.kind, "manual");
        assert.equal(sheet.status, "sheet");
        assert.equal(sheet.chargedMinor, 0);
        assert.equal(sheet.monitoringRunId, null);
        assert.deepEqual(sheet.promptIds, [promptId]);
        assert.equal(paused.coverageSlotIds.includes(keptFailedId), true);
        assert.equal(paused.coverageSlotIds.includes(expensiveId), false);
        const [consumerSlot] = await queryWithParameters(db, "SELECT status, manual FROM sampling_slot WHERE id = ?", [consumerId]);
        assert.equal(consumerSlot.status, "scheduled");
        assert.equal(Number(consumerSlot.manual), 1);
        const replaySheet = await driveDueSamplingWindow(db, owner, drive(short.plan.id, eligible, [promptId]), executor);
        assert.equal(replaySheet.runs.filter((run) => run.slotId === consumerId).length, 1);
        assert.equal(replaySheet.runs.find((run) => run.slotId === consumerId).replayed, true);

        const blockedId = randomUUID();
        const otherId = randomUUID();
        const degraded = await saveSamplingPlan(db, owner, {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 100,
          spentMinor: 0,
          pendingMinor: 0,
          nextAt: time,
          slots: [
            slot(blockedId, "old-channel", futureAt, "scheduled", false, 5),
            slot(otherId, "official-api", runAt, "scheduled", false, 5),
          ],
        }, () => time);
        const degradedDrive = await driveDueSamplingWindow(db, owner, drive(degraded.plan.id, [
          { channelId: "old-channel", state: "expired" },
          { channelId: "official-api", state: "eligible" },
        ], [promptId]), executor);
        assert.deepEqual(degradedDrive.pausedChannelIds, [blockedId]);
        assert.equal(degradedDrive.pausedBudgetIds.length, 0);
        assert.equal(degradedDrive.runs.some((run) => run.slotId === otherId && run.status === "accepted"), true);
        const [blockedSlot] = await queryWithParameters(db, "SELECT status FROM sampling_slot WHERE id = ?", [blockedId]);
        assert.equal(blockedSlot.status, "paused");

        const previousIds = [randomUUID(), randomUUID()];
        const latestIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const covered = await saveSamplingPlan(db, owner, {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 100,
          spentMinor: 0,
          pendingMinor: 0,
          nextAt: time,
          slots: [
            ...previousIds.map((id) => slot(id, "official-api", earlierAt, "completed", false, 1)),
            slot(latestIds[0], "official-api", dueAt, "failed", false, 1),
            ...latestIds.slice(1).map((id) => slot(id, "official-api", dueAt, "completed", false, 1)),
          ],
        }, () => time);
        await observe(db, brand, owner, earlierAt, "true");
        await observe(db, brand, owner, "2026-11-22T03:00:00.000Z", "true");
        await observe(db, brand, owner, dueAt, "false");
        const quality = await driveDueSamplingWindow(db, owner, drive(covered.plan.id, eligible, []), executor);
        assert.equal(quality.alert.kind, "data_quality");
        assert.equal(quality.alert.claimBrandDecline, false);
        assert.equal(quality.alert.created, true);
        const latestReading = quality.readings.find((reading) => reading.windowId === "2026-11-23");
        assert.equal(latestReading.coverageSufficient, false);
        assert.equal(latestReading.waitingForTrend, true);
        assert.equal(latestReading.plannedCount, 4);
        const repeated = await driveDueSamplingWindow(db, owner, drive(covered.plan.id, eligible, []), executor);
        assert.equal(repeated.alert.id, quality.alert.id);
        assert.equal(repeated.alert.created, false);
        assert.equal(repeated.alert.claimBrandDecline, false);
        const acknowledged = await acknowledgeQualityAlert(db, owner, quality.alert.id, () => time);
        assert.equal(acknowledged.alert.status, "acknowledged");
        const afterAck = await driveDueSamplingWindow(db, owner, drive(covered.plan.id, eligible, []), executor);
        assert.equal(afterAck.alert.id, quality.alert.id);
        const [alertRow] = await queryWithParameters(
          db,
          "SELECT status, claim_brand_decline AS \"claimBrandDecline\" FROM quality_alert WHERE id = ?",
          [quality.alert.id],
        );
        const [eventRow] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM quality_alert_event WHERE alert_id = ?", [quality.alert.id]);
        assert.equal(alertRow.status, "acknowledged");
        assert.equal(Number(alertRow.claimBrandDecline), 0);
        assert.equal(Number(eventRow.count), 3);
        const [trendRow] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM quality_alert WHERE brand_id = ? AND kind = 'trend'", [brand]);
        assert.equal(Number(trendRow.count), 0);

        await transitionSamplingPlan(db, owner, { action: "transition", planId: opened.plan.id, phase: "paused" });
        assert.deepEqual(
          await driveDueSamplingWindow(db, owner, drive(opened.plan.id, eligible, [promptId]), executor),
          { error: "PLAN_PHASE_CONFLICT" },
        );

        const extra = Array.from({ length: 2500 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extra.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extra.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO sampling_plan (
            id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at
          ) VALUES ${extra.map(() => "(?, 1, ?, ?, 'active', 'CNY', 10, 0, 0, ?)").join(", ")}`,
          extra.flatMap((id) => [id, id, outsider, time]),
        );
        const fillerSlots = extra.map(() => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO sampling_slot (
            id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
          ) VALUES ${extra.map(() => "(?, ?, ?, ?, 'bulk-channel', ?, 'scheduled', 1, 1)").join(", ")}`,
          extra.flatMap((id, index) => [fillerSlots[index], id, id, outsider, dueAt]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO sampling_due_run (
            id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
            kind, status, monitoring_run_id, charged_minor, prompt_ids_json, created_at
          ) VALUES ${extra.map(() => "(?, ?, 1, ?, ?, 'bulk-channel', '2026-11-23', ?, 'Asia/Shanghai', 'manual', 'sheet', NULL, 0, ?, ?)").join(", ")}`,
          extra.flatMap((id, index) => [randomUUID(), id, id, outsider, fillerSlots[index], JSON.stringify([randomUUID()]), time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE sampling_due_run");
        const lookup = samplingDueRunLookupQuery(owner, opened.plan.id);
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const planText = JSON.stringify(await queryWithParameters(db, explain + lookup.sql, lookup.values));
        assert.match(planText, /sampling_due_run_owner_idx|sampling_due_run_slot_uidx/);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${kind}: a manual sheet freezes its prompt set version, rejects foreign prompts, and marks legacy sheets unverified`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const [owner, otherOwner] = await Promise.all([account(db), account(db)]);
      const brand = randomUUID();
      const otherBrand = randomUUID();
      const brands = new BrandDao(db);
      await brands.insertBrand(owner, brand, time);
      await brands.insertVersion(brand, 1, brandFields, time);
      await brands.insertBrand(otherOwner, otherBrand, time);
      await brands.insertVersion(otherBrand, 1, { ...brandFields, name: "远帆设备" }, time);

      const setId = randomUUID();
      const clusterId = randomUUID();
      const questionA = randomUUID();
      const questionB = randomUUID();
      const questionC = randomUUID();
      const foreignId = randomUUID();
      const setV1Id = randomUUID();
      const setV2Id = randomUUID();
      const setV3Id = randomUUID();
      const foreignSetId = randomUUID();
      const v1TextA = "v1 旧版巡检问题";
      const v2TextA = "v2 门店如何安排设备巡检";
      const v2TextB = "v2 离线巡检的产品怎么比较";
      const v3TextA = "v3 修改后的设备巡检问题";
      const v3TextC = "v3 新增的维保对比问题";
      const foreignText = "另一品牌的巡检题目";
      const prompts = new PromptDao(db, brand);
      await prompts.insertSet({
        id: setV1Id, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
        content: {
          clusters: [cluster(clusterId)],
          questions: [question(questionA, clusterId, v1TextA)],
        },
        createdAt: "2026-11-01T00:00:00.000Z",
      });
      await prompts.insertSet({
        id: setV2Id, setId, version: 2, entityVersion: 1, region: "CN", language: "zh-CN",
        content: {
          clusters: [cluster(clusterId)],
          questions: [question(questionA, clusterId, v2TextA), question(questionB, clusterId, v2TextB)],
        },
        createdAt: "2026-11-10T00:00:00.000Z",
      });
      await new PromptDao(db, otherBrand).insertSet({
        id: foreignSetId, setId: randomUUID(), version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
        content: {
          clusters: [cluster(randomUUID())],
          questions: [question(foreignId, randomUUID(), foreignText)],
        },
        createdAt: time,
      });

      const rejectedSlotId = randomUUID();
      const rejectedPlan = await saveSamplingPlan(db, owner, {
        action: "create",
        brandId: brand,
        phase: "active",
        currency: "CNY",
        budgetMinor: 100,
        spentMinor: 0,
        pendingMinor: 0,
        nextAt: time,
        slots: [slot(rejectedSlotId, "consumer-sheet", runAt, "scheduled", true, 0)],
      }, () => time);
      const foreignPromptAttempt = await driveDueSamplingWindow(
        db,
        owner,
        { ...drive(rejectedPlan.plan.id, [{ channelId: "consumer-sheet", state: "eligible" }], [questionA, foreignId]), promptSetId: setV2Id },
      );
      assert.deepEqual(foreignPromptAttempt, { error: "INVALID_INPUT" });
      assert.equal(JSON.stringify(foreignPromptAttempt).includes(foreignText), false);
      const foreignSetAttempt = await driveDueSamplingWindow(
        db,
        owner,
        { ...drive(rejectedPlan.plan.id, [{ channelId: "consumer-sheet", state: "eligible" }], [foreignId]), promptSetId: foreignSetId },
      );
      assert.deepEqual(foreignSetAttempt, { error: "INVALID_INPUT" });
      assert.equal(JSON.stringify(foreignSetAttempt).includes(foreignText), false);
      const [rejectedCount] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM sampling_due_run WHERE plan_id = ?", [rejectedPlan.plan.id]);
      assert.equal(Number(rejectedCount.count), 0);

      const officialId = randomUUID();
      const consumerV2Id = randomUUID();
      const opened = await saveSamplingPlan(db, owner, {
        action: "create",
        brandId: brand,
        phase: "active",
        currency: "CNY",
        budgetMinor: 100,
        spentMinor: 0,
        pendingMinor: 0,
        nextAt: time,
        slots: [
          slot(officialId, "official-api", runAt, "scheduled", false, 10),
          slot(consumerV2Id, "consumer-sheet", runAt, "scheduled", true, 0),
        ],
      }, () => time);
      const calls = [];
      const executor = async (start) => {
        calls.push(start.slotId);
        return { runId: await stubRun(db, brand, owner), chargedMinor: 4 };
      };
      const eligible = [
        { channelId: "official-api", state: "eligible" },
        { channelId: "consumer-sheet", state: "eligible" },
      ];
      const v2PromptOrder = [questionB, questionA];
      const first = await driveDueSamplingWindow(
        db,
        owner,
        { ...drive(opened.plan.id, eligible, v2PromptOrder), promptSetId: setV2Id },
        executor,
      );
      assert.equal(first.error, undefined);
      assert.deepEqual(calls, [officialId]);
      const sheetRun = first.runs.find((run) => run.slotId === consumerV2Id);
      assert.equal(sheetRun.kind, "manual");
      assert.equal(sheetRun.promptSetId, setV2Id);
      assert.equal(sheetRun.promptSetVersion, 2);
      assert.deepEqual(sheetRun.promptIds, v2PromptOrder);

      // Freeze v3: modify questionA and remove questionB, add questionC.
      await prompts.insertSet({
        id: setV3Id, setId, version: 3, entityVersion: 1, region: "CN", language: "zh-CN",
        content: {
          clusters: [cluster(clusterId)],
          questions: [question(questionA, clusterId, v3TextA), question(questionC, clusterId, v3TextC)],
        },
        createdAt: "2026-11-24T02:00:00.000Z",
      });

      const removedInV3Attempt = await driveDueSamplingWindow(
        db,
        owner,
        { ...drive(rejectedPlan.plan.id, [{ channelId: "consumer-sheet", state: "eligible" }], [questionB]), promptSetId: setV3Id },
      );
      assert.deepEqual(removedInV3Attempt, { error: "INVALID_INPUT" });

      // Re-running the old v2 slot adds no new sheet and calls the executor 0 more times.
      const second = await driveDueSamplingWindow(db, owner, drive(opened.plan.id, eligible, [questionC]), executor);
      assert.deepEqual(calls, [officialId]);
      assert.equal(second.runs.find((run) => run.slotId === consumerV2Id).promptSetId, setV2Id);
      assert.equal(second.runs.find((run) => run.slotId === consumerV2Id).promptSetVersion, 2);
      assert.deepEqual(second.runs.find((run) => run.slotId === consumerV2Id).promptIds, v2PromptOrder);
      assert.equal(second.runs.find((run) => run.slotId === officialId).chargedMinor, 4);
      const counts = await queryWithParameters(
        db,
        "SELECT kind, COUNT(*) AS count FROM sampling_due_run WHERE plan_id = ? GROUP BY kind ORDER BY kind",
        [opened.plan.id],
      );
      assert.deepEqual(counts.map((row) => [row.kind, Number(row.count)]), [["manual", 1], ["official", 1]]);

      // New sheet created on v3 uses v3 texts.
      const consumerV3Id = randomUUID();
      const planV3 = await saveSamplingPlan(db, owner, {
        action: "create",
        brandId: brand,
        phase: "active",
        currency: "CNY",
        budgetMinor: 100,
        spentMinor: 0,
        pendingMinor: 0,
        nextAt: time,
        slots: [slot(consumerV3Id, "consumer-sheet", runAt, "scheduled", true, 0)],
      }, () => time);
      const v3Drive = await driveDueSamplingWindow(
        db,
        owner,
        { ...drive(planV3.plan.id, [{ channelId: "consumer-sheet", state: "eligible" }], [questionC, questionA]), promptSetId: setV3Id },
      );
      assert.equal(v3Drive.error, undefined);
      assert.equal(v3Drive.runs[0].promptSetId, setV3Id);
      assert.equal(v3Drive.runs[0].promptSetVersion, 3);

      // Legacy sheet without prompt_set_id / prompt_set_version preserves IDs and marks version/text unverified.
      const legacyRunId = randomUUID();
      await queryWithParameters(
        db,
        `INSERT INTO sampling_due_run (
          id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
          kind, status, monitoring_run_id, charged_minor, prompt_set_id, prompt_set_version, prompt_ids_json, created_at
        ) VALUES (?, ?, 1, ?, ?, 'consumer-sheet', '2026-11-20', ?, 'Asia/Shanghai', 'manual', 'sheet', NULL, 0, NULL, NULL, ?, ?)`,
        [legacyRunId, rejectedPlan.plan.id, brand, owner, rejectedSlotId, JSON.stringify([questionA, questionB]), time],
      );

      const listed = await listSamplingDueWindows(db, owner, [opened.plan.id, planV3.plan.id, rejectedPlan.plan.id]);
      const captured = [];
      const watched = {
        kind: db.kind,
        query(sql, values) {
          captured.push({ sql, values });
          return db.query(sql, values);
        },
      };
      const sheets = await manualSheetsForBrand(watched, brand, listed.runs);
      assert.equal(captured.length, 1);
      assert.match(captured[0].sql, /FROM prompt_set/);
      assert.equal(captured[0].values[0], brand);

      const v2Sheet = sheets.find((item) => item.slotId === consumerV2Id);
      assert.equal(v2Sheet.execution, "manual");
      assert.equal(v2Sheet.automaticCollection, false);
      assert.equal(v2Sheet.versionVerified, true);
      assert.equal(v2Sheet.promptSetId, setV2Id);
      assert.equal(v2Sheet.promptSetVersion, 2);
      assert.deepEqual(v2Sheet.lines, [
        { id: questionB, text: v2TextB, missing: false },
        { id: questionA, text: v2TextA, missing: false },
      ]);
      assert.equal(JSON.stringify(v2Sheet.lines).includes(v3TextA), false);
      assert.equal(JSON.stringify(v2Sheet.lines).includes(v1TextA), false);

      const v3Sheet = sheets.find((item) => item.slotId === consumerV3Id);
      assert.equal(v3Sheet.versionVerified, true);
      assert.equal(v3Sheet.promptSetId, setV3Id);
      assert.equal(v3Sheet.promptSetVersion, 3);
      assert.deepEqual(v3Sheet.lines, [
        { id: questionC, text: v3TextC, missing: false },
        { id: questionA, text: v3TextA, missing: false },
      ]);

      const legacySheet = sheets.find((item) => item.runId === legacyRunId);
      assert.equal(legacySheet.versionVerified, false);
      assert.equal(legacySheet.promptSetId, null);
      assert.equal(legacySheet.promptSetVersion, null);
      assert.deepEqual(legacySheet.lines, [
        { id: questionA, text: null, missing: true },
        { id: questionB, text: null, missing: true },
      ]);

      const outsider = await manualSheetsForBrand(db, otherBrand, listed.runs);
      assert.equal(outsider.every((item) => !item.versionVerified && item.lines.every((line) => line.missing && line.text === null)), true);
      assert.equal(JSON.stringify(outsider).includes(v2TextA), false);
      assert.equal(JSON.stringify(outsider).includes(v3TextA), false);

      const filler = Array.from({ length: 500 }, () => randomUUID());
      await queryWithParameters(
        db,
        `INSERT INTO prompt_set (
          brand_id, id, set_id, version, entity_version, region, language, content, created_at
        ) VALUES ${filler.map(() => "(?, ?, ?, ?, 1, 'CN', 'zh-CN', ?, ?)").join(", ")}`,
        filler.flatMap((id, index) => [brand, id, setId, index + 4, JSON.stringify({ clusters: [], questions: [] }), "2026-11-01T00:00:00.000Z"]),
      );
      if (db.kind === "postgresql") await db.query("ANALYZE prompt_set");
      const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      const batchLookup = promptSetBatchQuery(brand, [setV2Id, setV3Id]);
      const batchPlan = JSON.stringify(await queryWithParameters(db, explain + batchLookup.sql, batchLookup.values));
      assert.match(batchPlan, /prompt_set_brand_id_id_pk|sqlite_autoindex_prompt_set_1/);
      const lookup = latestPromptSetQuery(brand);
      const planText = JSON.stringify(await queryWithParameters(db, explain + lookup.sql, lookup.values));
      assert.match(planText, /prompt_set_recent_idx/);
      captured.length = 0;
      await manualSheetsForBrand(watched, brand, listed.runs.filter((run) => run.kind === "official"));
      assert.equal(captured.length, 0);
      await manualSheetsForBrand(watched, brand, listed.runs.filter((run) => run.runId === legacyRunId || run.id === legacyRunId));
      assert.equal(captured.length, 0);
    } finally {
      await fixture.cleanup();
    }
  });
}
