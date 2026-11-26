import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { assessMonitoringAlert } from "../../src/features/quality-alerts/rules.ts";
import {
  readSamplingPlanVersion,
  reviseSamplingPlanBudget,
  saveSamplingPlan,
  saveSamplingTrendThreshold,
  transitionSamplingPlan,
} from "../../src/features/sampling-plans/commands.ts";
import {
  createSamplingPlanSchema,
  reviseSamplingBudgetSchema,
  trendThresholdPpSchema,
} from "../../src/features/sampling-plans/contracts.ts";
import { samplingPlanListQuery } from "../../src/features/sampling-plans/dao.ts";
import { driveDueSamplingWindow } from "../../src/features/sampling-plans/due-commands.ts";
import { trendThresholdForWindow, windowBounds } from "../../src/features/sampling-plans/due-window.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { createTranslator } from "../../src/lib/i18n/translate.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const createdAt = "2026-11-21T00:00:00.000Z";
const earlierAt = "2026-11-22T02:00:00.000Z";
const dueAt = "2026-11-23T02:00:00.000Z";
const laterAt = "2026-11-25T02:00:00.000Z";
const firstDrive = "2026-11-24T01:00:00.000Z";
const revisedAt = "2026-11-24T03:00:00.000Z";
const secondDrive = "2026-11-26T01:00:00.000Z";

function slot(id, at, status = "completed") {
  return { id, channelId: "official-api", at, status, manual: false, costMinor: 1 };
}

function fingerprint() {
  return (randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")).slice(0, 64);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Trend threshold owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function openedBrand(db) {
  const owner = await account(db);
  const brand = randomUUID();
  await new BrandDao(db).insertBrand(owner, brand, createdAt);
  return { owner, brand };
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
    [id, brandId, ownerId, fingerprint(), capturedAt, capturedAt],
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

async function observeRate(db, brandId, ownerId, capturedAt, trues, falses) {
  for (let index = 0; index < trues; index += 1) await observe(db, brandId, ownerId, capturedAt, "true");
  for (let index = 0; index < falses; index += 1) await observe(db, brandId, ownerId, capturedAt, "false");
}

function drive(planId, now) {
  return {
    planId,
    timezone: "Asia/Shanghai",
    now,
    channels: [{ channelId: "official-api", state: "eligible" }],
    promptIds: [],
  };
}

async function alerts(db, brandId) {
  return queryWithParameters(
    db,
    `SELECT id, kind, reason, claim_brand_decline AS "claimBrandDecline", window_id AS "windowId"
     FROM quality_alert WHERE brand_id = ? ORDER BY created_at ASC, id ASC`,
    [brandId],
  );
}

function planInput(brandId, phase, slots, trendThresholdPp) {
  return {
    action: "create",
    brandId,
    phase,
    currency: "CNY",
    budgetMinor: 100,
    spentMinor: 0,
    pendingMinor: 0,
    nextAt: firstDrive,
    ...(trendThresholdPp === undefined ? {} : { trendThresholdPp }),
    slots,
  };
}

test("a blank threshold stays at 10, and only a finite positive number is accepted", async () => {
  assert.equal(trendThresholdPpSchema.safeParse(10).success, true);
  assert.equal(trendThresholdPpSchema.safeParse(15.5).success, true);
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "15"]) {
    assert.equal(trendThresholdPpSchema.safeParse(value).success, false);
  }
  const brandId = randomUUID();
  const base = {
    action: "create",
    brandId,
    phase: "draft",
    currency: "CNY",
    budgetMinor: 10,
    spentMinor: 0,
    pendingMinor: 0,
    nextAt: firstDrive,
    slots: [slot(randomUUID(), earlierAt)],
  };
  assert.equal(createSamplingPlanSchema.safeParse(base).success, true);
  assert.equal(createSamplingPlanSchema.safeParse({ ...base, trendThresholdPp: 0 }).success, false);
  assert.equal(createSamplingPlanSchema.safeParse({ ...base, trendThresholdPp: -4 }).success, false);
  assert.equal(reviseSamplingBudgetSchema.safeParse({ budgetMinor: 10, trendThresholdPp: "30" }).success, false);
  const sample = {
    windowId: "2026-11-23",
    completed: true,
    coverageSufficient: true,
    citationFieldChanged: false,
    modeChanged: false,
    recommendationRate: 0.4,
  };
  assert.equal(assessMonitoringAlert([
    { ...sample, windowId: "2026-11-22", recommendationRate: 0.5 },
    sample,
  ], 10).kind, "none");
  assert.equal(assessMonitoringAlert([
    { ...sample, windowId: "2026-11-22", recommendationRate: 0.5 },
    { ...sample, recommendationRate: 0.39 },
  ], 10).kind, "trend");
  const quality = assessMonitoringAlert([
    { ...sample, windowId: "2026-11-22", recommendationRate: 0.8 },
    { ...sample, coverageSufficient: false, recommendationRate: 0.2 },
  ], 1);
  assert.equal(quality.kind, "data_quality");
  assert.equal(quality.claimBrandDecline, false);
  assert.equal(assessMonitoringAlert([
    { ...sample, citationFieldChanged: true, recommendationRate: 0.2 },
  ], 1).kind, "data_quality");
  assert.equal(assessMonitoringAlert([sample], 1).kind, "none");
  const end = windowBounds("2026-11-23", "Asia/Shanghai").end;
  assert.equal(trendThresholdForWindow([
    { version: 1, createdAt, trendThresholdPp: 10 },
    { version: 2, createdAt: revisedAt, trendThresholdPp: 30 },
  ], end), 10);
  assert.equal(trendThresholdForWindow([
    { version: 1, createdAt, trendThresholdPp: 10 },
    { version: 2, createdAt: revisedAt, trendThresholdPp: 30 },
  ], windowBounds("2026-11-25", "Asia/Shanghai").end), 30);

  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  const zhT = createTranslator("zh-CN", zh.samplingPlans);
  const enT = createTranslator("en", en.samplingPlans);
  assert.equal(zhT("currentThreshold", { value: "15" }), "当前版本的趋势阈值是 15 个百分点。");
  assert.equal(enT("currentThreshold", { value: "15" }), "This version's trend threshold is 15 percentage points.");
  assert.match(zhT("newThresholdHint"), /尚未发生的窗口/);
  assert.match(enT("newThresholdHint"), /have not happened yet/);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a draft freezes its threshold, and later versions do not rewrite a written alert`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const owner = await account(db);
      const brand = randomUUID();
      await new BrandDao(db).insertBrand(owner, brand, createdAt);
      const draft = await saveSamplingPlan(db, owner, planInput(brand, "draft", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
      ]), () => createdAt);
      assert.equal(draft.plan.trendThresholdPp, 10);
      assert.equal(draft.plan.version, 1);
      const saved = await saveSamplingTrendThreshold(db, owner, { planId: draft.plan.id, trendThresholdPp: 15 });
      assert.equal(saved.plan.version, 1);
      assert.equal(saved.plan.trendThresholdPp, 15);
      const active = await transitionSamplingPlan(db, owner, { action: "transition", planId: draft.plan.id, phase: "active" });
      assert.equal(active.plan.phase, "active");
      assert.equal(active.plan.version, 1);
      assert.equal(active.plan.trendThresholdPp, 15);
      assert.deepEqual(
        await saveSamplingTrendThreshold(db, owner, { planId: draft.plan.id, trendThresholdPp: 8 }),
        { error: "PLAN_PHASE_CONFLICT" },
      );
      assert.equal((await readSamplingPlanVersion(db, owner, draft.plan.id, 1)).trendThresholdPp, 15);
      const copied = await reviseSamplingPlanBudget(db, owner, draft.plan.id, { budgetMinor: 120 }, () => revisedAt);
      assert.equal(copied.plan.version, 2);
      assert.equal(copied.plan.trendThresholdPp, 15);
      assert.equal((await readSamplingPlanVersion(db, owner, draft.plan.id, 1)).trendThresholdPp, 15);
      const raised = await reviseSamplingPlanBudget(db, owner, draft.plan.id, { budgetMinor: 120, trendThresholdPp: 30 }, () => "2026-11-24T04:00:00.000Z");
      assert.equal(raised.plan.trendThresholdPp, 30);
      assert.equal((await readSamplingPlanVersion(db, owner, draft.plan.id, 2)).trendThresholdPp, 15);

      await assert.rejects(queryWithParameters(
        db,
        `INSERT INTO sampling_plan (
          id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at, trend_threshold_pp
        ) VALUES (?, 1, ?, ?, 'draft', 'CNY', 1, 0, 0, ?, 0)`,
        [randomUUID(), brand, owner, createdAt],
      ));
      const omitted = randomUUID();
      await queryWithParameters(
        db,
        `INSERT INTO sampling_plan (
          id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at
        ) VALUES (?, 1, ?, ?, 'draft', 'CNY', 1, 0, 0, ?)`,
        [omitted, brand, owner, createdAt],
      );
      assert.equal((await readSamplingPlanVersion(db, owner, omitted, 1)).trendThresholdPp, 10);
      const listed = samplingPlanListQuery(brand, owner);
      const explained = JSON.stringify(await queryWithParameters(
        db,
        `${kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${listed.sql}`,
        listed.values,
      ));
      assert.match(explained, /sampling_plan_owner_idx/);

      const narrowOwner = await openedBrand(db);
      const narrow = narrowOwner.brand;
      const quiet = await saveSamplingPlan(db, narrowOwner.owner, planInput(narrow, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
      ], 15), () => createdAt);
      await observeRate(db, narrow, narrowOwner.owner, earlierAt, 25, 0);
      await observeRate(db, narrow, narrowOwner.owner, dueAt, 22, 3);
      const twelve = await driveDueSamplingWindow(db, narrowOwner.owner, drive(quiet.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(twelve.alert, null);
      assert.equal((await alerts(db, narrow)).length, 0);

      const loudOwner = await openedBrand(db);
      const loudBrand = loudOwner.brand;
      const loud = await saveSamplingPlan(db, loudOwner.owner, planInput(loudBrand, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
      ], 15), () => createdAt);
      await observeRate(db, loudBrand, loudOwner.owner, earlierAt, 25, 0);
      await observeRate(db, loudBrand, loudOwner.owner, dueAt, 21, 4);
      const sixteen = await driveDueSamplingWindow(db, loudOwner.owner, drive(loud.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(sixteen.alert.kind, "trend");
      assert.equal(sixteen.alert.claimBrandDecline, true);
      assert.equal(sixteen.alert.created, true);

      const exactOwner = await openedBrand(db);
      const exactBrand = exactOwner.brand;
      const exact = await saveSamplingPlan(db, exactOwner.owner, planInput(exactBrand, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
      ]), () => createdAt);
      assert.equal(exact.plan.trendThresholdPp, 10);
      await observeRate(db, exactBrand, exactOwner.owner, earlierAt, 10, 0);
      await observeRate(db, exactBrand, exactOwner.owner, dueAt, 9, 1);
      const tied = await driveDueSamplingWindow(db, exactOwner.owner, drive(exact.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(tied.alert, null);

      const overOwner = await openedBrand(db);
      const overBrand = overOwner.brand;
      const over = await saveSamplingPlan(db, overOwner.owner, planInput(overBrand, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
        slot(randomUUID(), laterAt),
      ]), () => createdAt);
      await observeRate(db, overBrand, overOwner.owner, earlierAt, 10, 0);
      await observeRate(db, overBrand, overOwner.owner, dueAt, 8, 2);
      const first = await driveDueSamplingWindow(db, overOwner.owner, drive(over.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(first.alert.kind, "trend");
      const [written] = await alerts(db, overBrand);
      assert.equal(written.id, first.alert.id);
      assert.equal(written.kind, "trend");
      assert.equal(written.reason, "recommendation_drop");
      assert.equal(Number(written.claimBrandDecline), 1);
      const versioned = await reviseSamplingPlanBudget(
        db, overOwner.owner, over.plan.id, { budgetMinor: 80, trendThresholdPp: 30 }, () => revisedAt,
      );
      assert.equal(versioned.plan.version, 2);
      assert.equal(versioned.plan.trendThresholdPp, 30);
      assert.equal((await readSamplingPlanVersion(db, overOwner.owner, over.plan.id, 1)).trendThresholdPp, 10);
      const replay = await driveDueSamplingWindow(db, overOwner.owner, drive(over.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(replay.alert.id, written.id);
      assert.equal(replay.alert.created, false);
      await observeRate(db, overBrand, overOwner.owner, laterAt, 6, 4);
      const future = await driveDueSamplingWindow(db, overOwner.owner, drive(over.plan.id, secondDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(future.alert, null);
      const kept = await alerts(db, overBrand);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].id, written.id);
      assert.equal(kept[0].kind, "trend");
      assert.equal(kept[0].reason, "recommendation_drop");
      assert.equal(kept[0].windowId, written.windowId);

      const movedOwner = await openedBrand(db);
      const movedBrand = movedOwner.brand;
      const moved = await saveSamplingPlan(db, movedOwner.owner, planInput(movedBrand, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
        slot(randomUUID(), laterAt),
      ]), () => createdAt);
      await observeRate(db, movedBrand, movedOwner.owner, earlierAt, 10, 0);
      await observeRate(db, movedBrand, movedOwner.owner, dueAt, 8, 2);
      const original = await driveDueSamplingWindow(db, movedOwner.owner, drive(moved.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      await reviseSamplingPlanBudget(db, movedOwner.owner, moved.plan.id, { budgetMinor: 90, trendThresholdPp: 30 }, () => revisedAt);
      await observeRate(db, movedBrand, movedOwner.owner, laterAt, 4, 6);
      const nextWindow = await driveDueSamplingWindow(db, movedOwner.owner, drive(moved.plan.id, secondDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(nextWindow.alert.kind, "trend");
      assert.equal(nextWindow.alert.created, true);
      assert.notEqual(nextWindow.alert.id, original.alert.id);
      const both = await alerts(db, movedBrand);
      assert.equal(both.length, 2);
      assert.equal(both[0].id, original.alert.id);
      assert.equal(both[0].kind, "trend");
      assert.equal(both[0].reason, "recommendation_drop");
      assert.equal(both[1].windowId, "2026-11-25");

      const heldOwner = await openedBrand(db);
      const heldBrand = heldOwner.brand;
      const held = await saveSamplingPlan(db, heldOwner.owner, planInput(heldBrand, "active", [
        slot(randomUUID(), earlierAt),
        slot(randomUUID(), dueAt),
      ], 15), () => createdAt);
      await observeRate(db, heldBrand, heldOwner.owner, earlierAt, 25, 0);
      await observeRate(db, heldBrand, heldOwner.owner, dueAt, 22, 3);
      assert.equal((await driveDueSamplingWindow(db, heldOwner.owner, drive(held.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      })).alert, null);
      await reviseSamplingPlanBudget(db, heldOwner.owner, held.plan.id, { budgetMinor: 70, trendThresholdPp: 5 }, () => revisedAt);
      const stillQuiet = await driveDueSamplingWindow(db, heldOwner.owner, drive(held.plan.id, firstDrive), async () => {
        throw new Error("completed slots must not start sampling");
      });
      assert.equal(stillQuiet.alert, null);
      assert.equal((await alerts(db, heldBrand)).length, 0);
    } finally {
      await fixture.cleanup();
    }
  });
}
