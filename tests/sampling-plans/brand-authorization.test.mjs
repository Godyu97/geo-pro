import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import {
  acknowledgeQualityAlert,
  listQualityAlerts,
  recordQualityAlert,
  snoozeQualityAlert,
} from "../../src/features/quality-alerts/commands.ts";
import {
  arriveAtSamplingWindow,
  listSamplingPlans,
  pauseExpiredSamplingChannel,
  readSamplingPlan,
  readSamplingPlanVersion,
  reviseSamplingPlanBudget,
  saveSamplingPlan,
  saveSamplingTrendThreshold,
  transitionSamplingPlan,
} from "../../src/features/sampling-plans/commands.ts";
import {
  driveDueSamplingWindow,
  listAlertWindowSources,
  listAttachableOfficialRuns,
  listSamplingDueWindows,
  readSamplingWindowDetail,
} from "../../src/features/sampling-plans/due-commands.ts";
import { grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { ensurePersonalGroup } from "../../src/features/team-access/platform-role.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-27T08:00:00.000Z";
const officialAt = "2026-11-26T01:00:00.000Z";
const slotDueAt = "2026-11-27T01:00:00.000Z";
const futureAt = "2026-12-01T00:00:00.000Z";
const clock = () => time;

const brandFields = {
  name: "采样协作品牌",
  description: "Synthetic brand for sampling plan and quality alert authorization",
  website: "https://sampling-collab.example.com",
  aliases: ["采样协作"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

async function createUser(db, label) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, label, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  const groupId = await ensurePersonalGroup(db, id, time);
  return { id, groupId };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: group member, read_only, outsider, and revoked sampling-plan & quality-alert authorization`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;

    const [owner, member, readOnly, outsider] = await Promise.all([
      createUser(db, "Owner"),
      createUser(db, "Member"),
      createUser(db, "ReadOnly"),
      createUser(db, "Outsider"),
    ]);

    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner.id, brandId, time, owner.groupId);
    await brands.insertVersion(brandId, 1, brandFields, time);

    const memberGrant = await grantBrandMember(db, owner.id, {
      userId: member.id,
      brandId,
      role: "member",
      expiresAt: null,
    }, time);
    assert.equal(memberGrant.error, undefined);

    const readOnlyGrant = await grantBrandMember(db, owner.id, {
      userId: readOnly.id,
      brandId,
      role: "read_only",
      expiresAt: null,
    }, time);
    assert.equal(readOnlyGrant.error, undefined);

    // Seed frozen prompt set on brandId.
    const promptSetId = randomUUID();
    const questionId = randomUUID();
    const clusterId = randomUUID();
    await new PromptDao(db, brandId).insertSet({
      id: promptSetId,
      setId: randomUUID(),
      version: 1,
      entityVersion: 1,
      region: "CN",
      language: "zh-CN",
      content: {
        clusters: [{ id: clusterId, audience: "采购", intent: "对比", primaryPage: "", conversionAction: "" }],
        questions: [{
          id: questionId,
          clusterId,
          text: "哪家工业监测方案支持私有部署？",
          source: "manual",
          sourceNote: "",
          type: "discovery",
          stage: "consider",
          region: "CN",
          language: "zh-CN",
          status: "confirmed",
          acceptSimilar: false,
          primary: false,
        }],
      },
      createdAt: time,
    });

    // Seed a completed official monitoring run owned by owner.id.
    const officialRunId = randomUUID();
    const officialSlotId = randomUUID();
    const attemptId = randomUUID();
    await queryWithParameters(
      db,
      `INSERT INTO monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) VALUES (?, ?, ?, ?, ?, 'model_api', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 100, 100, 0, 'succeeded', 1, ?)`,
      [officialRunId, brandId, owner.id, randomUUID(), "a".repeat(64), promptSetId, officialAt],
    );
    await queryWithParameters(
      db,
      `INSERT INTO monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
        reservation_id, status, created_at, adopted_attempt_id, late
      ) VALUES (?, ?, ?, ?, 1, 'official-api', 2, 1, NULL, 'queued', ?, NULL, 0)`,
      [officialSlotId, officialRunId, brandId, questionId, officialAt],
    );
    await queryWithParameters(
      db,
      `INSERT INTO monitoring_attempt (
        id, slot_id, run_id, brand_id, kind, ordinal, transport, synthetic, disposition, raw_text,
        currency, upper_minor, actual_minor, cost_state, quota_attempt_id, late, created_at
      ) VALUES (?, ?, ?, ?, 'sampling', 1, 'official_api', 0, 'adopted', '隔离回答', 'CNY', 20, 25, 'known', NULL, 0, ?)`,
      [attemptId, officialSlotId, officialRunId, brandId, officialAt],
    );
    await queryWithParameters(
      db,
      "UPDATE monitoring_slot SET status = 'succeeded', adopted_attempt_id = ? WHERE id = ?",
      [attemptId, officialSlotId],
    );

    // 1. Member creates a draft sampling plan, saves threshold, transitions to active, revises budget,
    // drives due window (manual sheet + existing official run -> data_quality alert), and acknowledges alert.
    const manualSlotId = randomUUID();
    const dueOfficialSlotId = randomUUID();
    const futureSlotId = randomUUID();
    const created = await saveSamplingPlan(db, member.id, {
      action: "create",
      brandId,
      phase: "draft",
      currency: "CNY",
      budgetMinor: 1000,
      spentMinor: 0,
      pendingMinor: 0,
      nextAt: futureAt,
      slots: [
        { id: manualSlotId, channelId: "consumer-sheet", at: slotDueAt, status: "scheduled", manual: true, costMinor: 0 },
        { id: dueOfficialSlotId, channelId: "official-api", at: officialAt, status: "scheduled", manual: false, costMinor: 50 },
        { id: futureSlotId, channelId: "official-api", at: futureAt, status: "scheduled", manual: false, costMinor: 50 },
      ],
    }, clock);
    assert.equal(created.error, undefined);
    const planId = created.plan.id;

    const thresholdSaved = await saveSamplingTrendThreshold(db, member.id, { planId, trendThresholdPp: 15 });
    assert.equal(thresholdSaved.error, undefined);
    assert.equal(thresholdSaved.plan.trendThresholdPp, 15);

    const activated = await transitionSamplingPlan(db, member.id, { action: "transition", planId, phase: "active" });
    assert.equal(activated.error, undefined);
    assert.equal(activated.plan.phase, "active");

    const revised = await reviseSamplingPlanBudget(db, member.id, planId, { budgetMinor: 1200 }, clock);
    assert.equal(revised.error, undefined);
    assert.equal(revised.plan.version, 2);

    const attachable = await listAttachableOfficialRuns(db, member.id, brandId);
    assert.equal(attachable.length, 1);
    assert.equal(attachable[0].id, officialRunId);

    const driven = await driveDueSamplingWindow(db, member.id, {
      planId,
      timezone: "Asia/Shanghai",
      now: time,
      channels: [
        { channelId: "consumer-sheet", state: "eligible" },
        { channelId: "official-api", state: "eligible" },
      ],
      promptIds: [questionId],
      promptSetId,
      existingRunId: officialRunId,
    });
    assert.equal(driven.error, undefined);
    assert.equal(driven.runs.some((run) => run.kind === "manual" && run.promptSetId === promptSetId), true);
    assert.equal(driven.runs.some((run) => run.kind === "official" && run.monitoringRunId === officialRunId), true);
    assert.ok(driven.alert);

    // No extra monitoring_run was created when driving without an executor.
    const runCountRows = await queryWithParameters(
      db,
      `SELECT count(*) AS count FROM monitoring_run WHERE brand_id = ?`,
      [brandId],
    );
    assert.equal(Number(runCountRows[0].count), 1);

    // Owner and member read the exact same plan, due runs, window detail, and alerts.
    const [ownerPlans, memberPlans] = await Promise.all([
      listSamplingPlans(db, owner.id, brandId),
      listSamplingPlans(db, member.id, brandId),
    ]);
    assert.equal(ownerPlans.plans.length, 1);
    assert.equal(memberPlans.plans.length, 1);
    assert.equal(ownerPlans.plans[0].id, planId);

    const due = await listSamplingDueWindows(db, member.id, [planId]);
    assert.equal(due.readings.length, 2);
    const windowId = due.readings.find((item) => item.alertId !== null)?.windowId;
    const manualWindowId = due.readings.find((item) => item.alertId === null)?.windowId;
    assert.ok(windowId);
    assert.ok(manualWindowId);

    const detail = await readSamplingWindowDetail(db, member.id, planId, windowId);
    assert.equal(detail.error, undefined);
    assert.equal(detail.detail.brandId, brandId);
    assert.equal(detail.detail.acceptedRuns.length, 1);

    const manualDetail = await readSamplingWindowDetail(db, member.id, planId, manualWindowId);
    assert.equal(manualDetail.error, undefined);
    assert.equal(manualDetail.detail.manualSheets.length, 1);

    const alerts = await listQualityAlerts(db, member.id, brandId);
    assert.equal(alerts.alerts.length, 1);
    const alertId = alerts.alerts[0].id;
    const sources = await listAlertWindowSources(db, member.id, brandId, [alertId]);
    assert.equal(sources.sourcesByAlertId.get(alertId)?.length, 1);

    const acked = await acknowledgeQualityAlert(db, member.id, alertId, clock);
    assert.equal(acked.error, undefined);
    assert.equal(acked.alert.status, "acknowledged");

    // 2. read_only can view plans, versions, due windows, detail, attachable runs, and alerts,
    // but all write operations return FORBIDDEN.
    assert.equal((await listSamplingPlans(db, readOnly.id, brandId)).plans.length, 1);
    assert.equal((await readSamplingPlan(db, readOnly.id, planId)).plan.id, planId);
    assert.equal((await readSamplingPlanVersion(db, readOnly.id, planId, 1)).version, 1);
    assert.equal((await listSamplingDueWindows(db, readOnly.id, [planId])).runs.length, 2);
    assert.equal((await readSamplingWindowDetail(db, readOnly.id, planId, windowId)).detail.brandId, brandId);
    assert.equal((await listAttachableOfficialRuns(db, readOnly.id, brandId)).length, 1);
    assert.equal((await listQualityAlerts(db, readOnly.id, brandId)).alerts.length, 1);
    assert.equal((await listAlertWindowSources(db, readOnly.id, brandId, [alertId])).sourcesByAlertId.size, 1);

    const readOnlyWrites = [
      await saveSamplingPlan(db, readOnly.id, {
        action: "create",
        brandId,
        phase: "active",
        currency: "CNY",
        budgetMinor: 500,
        spentMinor: 0,
        pendingMinor: 0,
        nextAt: futureAt,
        slots: [{ id: randomUUID(), channelId: "consumer-sheet", at: futureAt, status: "scheduled", manual: true, costMinor: 0 }],
      }, clock),
      await saveSamplingTrendThreshold(db, readOnly.id, { planId, trendThresholdPp: 12 }),
      await reviseSamplingPlanBudget(db, readOnly.id, planId, { budgetMinor: 1500 }, clock),
      await transitionSamplingPlan(db, readOnly.id, { action: "transition", planId, phase: "paused" }),
      await arriveAtSamplingWindow(db, readOnly.id, { action: "arrive", planId, nextAt: futureAt }),
      await pauseExpiredSamplingChannel(db, readOnly.id, { action: "expire-channel", planId, channelId: "official-api", nextAt: futureAt }),
      await driveDueSamplingWindow(db, readOnly.id, {
        planId,
        timezone: "Asia/Shanghai",
        now: time,
        channels: [{ channelId: "consumer-sheet", state: "eligible" }],
        promptIds: [questionId],
        promptSetId,
      }),
      await recordQualityAlert(db, readOnly.id, {
        action: "record",
        brandId,
        windows: [{ windowId: "w-ro", completed: true, coverageSufficient: false, citationFieldChanged: false, modeChanged: false, recommendationRate: 0.2 }],
      }, clock),
      await acknowledgeQualityAlert(db, readOnly.id, alertId, clock),
      await snoozeQualityAlert(db, readOnly.id, alertId, clock),
    ];
    for (const denied of readOnlyWrites) {
      assert.equal(denied.error, "FORBIDDEN");
    }

    // 3. outsider receives NOT_FOUND across all read and write endpoints without leaking brand or window data.
    assert.deepEqual(await listAttachableOfficialRuns(db, outsider.id, brandId), []);
    const dueHidden = await listSamplingDueWindows(db, outsider.id, [planId]);
    assert.deepEqual(dueHidden, { runs: [], readings: [] });

    const outsiderResults = [
      await listSamplingPlans(db, outsider.id, brandId),
      await readSamplingPlan(db, outsider.id, planId),
      await readSamplingPlanVersion(db, outsider.id, planId, 1),
      await readSamplingWindowDetail(db, outsider.id, planId, windowId),
      await listQualityAlerts(db, outsider.id, brandId),
      await listAlertWindowSources(db, outsider.id, brandId, [alertId]),
      await saveSamplingPlan(db, outsider.id, {
        action: "create",
        brandId,
        phase: "active",
        currency: "CNY",
        budgetMinor: 500,
        spentMinor: 0,
        pendingMinor: 0,
        nextAt: futureAt,
        slots: [{ id: randomUUID(), channelId: "consumer-sheet", at: futureAt, status: "scheduled", manual: true, costMinor: 0 }],
      }, clock),
      await reviseSamplingPlanBudget(db, outsider.id, planId, { budgetMinor: 1500 }, clock),
      await transitionSamplingPlan(db, outsider.id, { action: "transition", planId, phase: "paused" }),
      await arriveAtSamplingWindow(db, outsider.id, { action: "arrive", planId, nextAt: futureAt }),
      await pauseExpiredSamplingChannel(db, outsider.id, { action: "expire-channel", planId, channelId: "official-api", nextAt: futureAt }),
      await driveDueSamplingWindow(db, outsider.id, {
        planId,
        timezone: "Asia/Shanghai",
        now: time,
        channels: [{ channelId: "consumer-sheet", state: "eligible" }],
        promptIds: [questionId],
        promptSetId,
      }),
      await recordQualityAlert(db, outsider.id, {
        action: "record",
        brandId,
        windows: [{ windowId: "w-out", completed: true, coverageSufficient: false, citationFieldChanged: false, modeChanged: false, recommendationRate: 0.2 }],
      }, clock),
      await acknowledgeQualityAlert(db, outsider.id, alertId, clock),
      await snoozeQualityAlert(db, outsider.id, alertId, clock),
    ];
    for (const res of outsiderResults) {
      assert.equal(res.error, "NOT_FOUND");
      const text = JSON.stringify(res);
      assert.equal(text.includes(brandFields.name), false);
      assert.equal(text.includes(windowId), false);
    }

    // 4. Revoking member's grant immediately revokes read and write access.
    const revoked = await revokeBrandGrant(db, owner.id, memberGrant.grant.id, time);
    assert.equal(revoked.error, undefined);
    assert.equal((await listSamplingPlans(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await readSamplingWindowDetail(db, member.id, planId, windowId)).error, "NOT_FOUND");
    assert.equal((await listQualityAlerts(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await snoozeQualityAlert(db, member.id, alertId, clock)).error, "NOT_FOUND");
    assert.equal((await arriveAtSamplingWindow(db, member.id, { action: "arrive", planId, nextAt: futureAt })).error, "NOT_FOUND");
  });
}
