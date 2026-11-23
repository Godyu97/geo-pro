import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { acknowledgeQualityAlert } from "../../src/features/quality-alerts/commands.ts";
import { saveSamplingPlan, transitionSamplingPlan } from "../../src/features/sampling-plans/commands.ts";
import { driveDueWindowSchema } from "../../src/features/sampling-plans/contracts.ts";
import { samplingDueRunLookupQuery } from "../../src/features/sampling-plans/due-dao.ts";
import { driveDueSamplingWindow } from "../../src/features/sampling-plans/due-commands.ts";
import { localWindowId } from "../../src/features/sampling-plans/due-window.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
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
        await new BrandDao(db).insertBrand(owner, brand, time);
        const promptId = randomUUID();
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
}
