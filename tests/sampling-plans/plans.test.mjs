import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  arriveAtSamplingWindow,
  listSamplingPlans,
  pauseExpiredSamplingChannel,
  readSamplingPlan,
  readSamplingPlanVersion,
  reviseSamplingPlanBudget,
  saveSamplingPlan,
  transitionSamplingPlan,
} from "../../src/features/sampling-plans/commands.ts";
import { createSamplingPlanSchema, samplingPlanErrors } from "../../src/features/sampling-plans/contracts.ts";
import { samplingPlanListQuery, samplingSlotListQuery } from "../../src/features/sampling-plans/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const clock = () => time;
const laterWindow = "2026-12-01T00:00:00.000Z";
const nextWindow = "2026-11-18T00:00:00.000Z";
const markerAt = "2026-11-20T04:05:06.000Z";
const markerCost = 250013;

test("ended plans use a stable conflict and empty creates are rejected", () => {
  assert.equal(samplingPlanErrors.PLAN_PHASE_CONFLICT, 409);
  assert.equal(samplingPlanErrors.NOT_FOUND, 404);
  assert.equal(createSamplingPlanSchema.safeParse({ action: "create", slots: [] }).success, false);
});

function slot(id, channelId, at, status, manual, costMinor) {
  return { id, channelId, at, status, manual, costMinor };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Sampling plan owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function watch(db) {
  const captured = [];
  const wrap = (target) => ({
    kind: target.kind,
    query(sql, values) {
      captured.push({ sql, values });
      return target.query(sql, values);
    },
    transaction: target.transaction
      ? (work) => target.transaction((tx) => work(wrap(tx)))
      : undefined,
    savepoint: target.savepoint?.bind(target),
  });
  return { captured, connection: wrap(db) };
}

function statusOf(plan, id) {
  return plan.slots.find((item) => item.id === id)?.status;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: unaffordable future slots pause and old budget versions stay readable`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const failedId = randomUUID();
        const pastScheduledId = randomUUID();
        const futureApiId = randomUUID();
        const futureConsumerId = randomUUID();
        const completedId = randomUUID();
        const base = {
          action: "create",
          brandId: brand,
          phase: "active",
          currency: "CNY",
          budgetMinor: 100,
          spentMinor: 70,
          pendingMinor: 20,
          nextAt: laterWindow,
        };
        const slots = [
          slot(failedId, "official-api", "2026-11-01T00:00:00.000Z", "failed", false, 10),
          slot(pastScheduledId, "official-api", "2026-11-02T00:00:00.000Z", "scheduled", false, 10),
          slot(futureApiId, "official-api", markerAt, "scheduled", false, markerCost),
          slot(futureConsumerId, "consumer-sheet", "2026-11-21T00:00:00.000Z", "scheduled", true, markerCost),
          slot(completedId, "official-api", "2026-11-22T00:00:00.000Z", "completed", false, markerCost),
        ];
        const duplicate = await saveSamplingPlan(db, owner, { ...base, slots: [slots[0], slots[0]] }, clock);
        assert.equal(duplicate.error, "INVALID_INPUT");

        const createdWatch = watch(db);
        const saved = await saveSamplingPlan(createdWatch.connection, owner, { ...base, slots }, clock);
        assert.equal(saved.error, undefined);
        const planId = saved.plan.id;
        assert.equal(createdWatch.captured.filter((item) => item.sql.includes("INSERT INTO sampling_slot")).length, 1);
        assert.equal(createdWatch.captured.some((item) => item.sql.includes("UPDATE sampling_slot")), false);
        assert.equal(statusOf(saved.plan, futureApiId), "scheduled");
        assert.equal(saved.plan.coverageSlotIds.includes(failedId), true);

        const hidden = await readSamplingPlan(db, outsider, planId);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(markerAt), false);
        assert.equal(JSON.stringify(hidden).includes(String(markerCost)), false);
        assert.deepEqual(await listSamplingPlans(db, outsider, brand), { error: "NOT_FOUND" });
        assert.deepEqual(
          await arriveAtSamplingWindow(db, outsider, { action: "arrive", planId, nextAt: nextWindow }),
          { error: "NOT_FOUND" },
        );
        assert.equal(statusOf((await readSamplingPlan(db, owner, planId)).plan, futureApiId), "scheduled");

        const arrivedWatch = watch(db);
        const arrived = await arriveAtSamplingWindow(
          arrivedWatch.connection,
          owner,
          { action: "arrive", planId, nextAt: nextWindow },
        );
        assert.equal(arrived.error, undefined);
        assert.deepEqual(arrived.pausedIds, [futureApiId, futureConsumerId]);
        assert.equal(arrivedWatch.captured.filter((item) => item.sql.includes("FROM sampling_slot")).length, 1);
        const slotUpdate = arrivedWatch.captured.find((item) => item.sql.includes("UPDATE sampling_slot"));
        assert.ok(slotUpdate);
        assert.equal(slotUpdate.sql.includes("manual"), false);
        assert.equal(slotUpdate.values.includes(failedId), false);
        assert.equal(slotUpdate.values.includes(completedId), false);
        assert.equal(slotUpdate.values.includes(pastScheduledId), false);
        assert.equal(statusOf(arrived.plan, futureApiId), "paused");
        assert.equal(statusOf(arrived.plan, futureConsumerId), "paused");
        assert.equal(statusOf(arrived.plan, pastScheduledId), "scheduled");
        assert.equal(statusOf(arrived.plan, failedId), "failed");
        assert.equal(statusOf(arrived.plan, completedId), "completed");
        const consumer = arrived.plan.slots.find((item) => item.id === futureConsumerId);
        assert.equal(consumer.manual, true);
        assert.equal(consumer.channelId, "consumer-sheet");
        assert.equal(arrived.plan.coverageSlotIds.includes(failedId), true);
        assert.equal(arrived.plan.coverageSlotIds.includes(completedId), true);
        assert.equal(arrived.plan.coverageSlotIds.includes(futureApiId), false);
        const stored = await readSamplingPlan(db, owner, planId);
        assert.equal(statusOf(stored.plan, futureApiId), "paused");
        assert.equal(stored.plan.slots.find((item) => item.id === futureConsumerId).manual, true);

        assert.deepEqual(
          await reviseSamplingPlanBudget(db, outsider, planId, { budgetMinor: 200 }, clock),
          { error: "NOT_FOUND" },
        );
        const revised = await reviseSamplingPlanBudget(db, owner, planId, { budgetMinor: 200 }, clock);
        assert.equal(revised.error, undefined);
        assert.deepEqual(revised.failedSlotIds, [failedId]);
        assert.equal(revised.plan.version, 2);
        assert.equal(revised.plan.budgetMinor, 200);
        assert.equal(statusOf(revised.plan, failedId), "failed");
        assert.equal(statusOf(revised.plan, futureApiId), "paused");
        const versionOne = await readSamplingPlanVersion(db, owner, planId, 1);
        const versionTwo = await readSamplingPlanVersion(db, owner, planId, 2);
        assert.equal(versionOne.budgetMinor, 100);
        assert.equal(versionOne.currency, "CNY");
        assert.equal(versionOne.phase, "active");
        assert.equal(versionTwo.budgetMinor, 200);
        assert.deepEqual(await readSamplingPlanVersion(db, outsider, planId, 1), { error: "NOT_FOUND" });

        const ended = await transitionSamplingPlan(db, owner, { action: "transition", planId, phase: "ended" });
        assert.equal(ended.plan.phase, "ended");
        const reactivated = await transitionSamplingPlan(db, owner, { action: "transition", planId, phase: "active" });
        assert.equal(reactivated.error, "PLAN_PHASE_CONFLICT");
        assert.equal((await readSamplingPlanVersion(db, owner, planId, 1)).budgetMinor, 100);
        assert.equal((await readSamplingPlanVersion(db, owner, planId, 1)).phase, "active");
        assert.equal((await readSamplingPlanVersion(db, owner, planId, 2)).phase, "ended");
        assert.equal((await readSamplingPlanVersion(db, owner, planId, 2)).budgetMinor, 200);

        const otherOwnerPlans = await listSamplingPlans(db, outsider, otherBrand);
        assert.equal(otherOwnerPlans.plans.length, 0);
        assert.equal(JSON.stringify(otherOwnerPlans).includes(markerAt), false);
        const ownedList = await listSamplingPlans(db, owner, brand);
        assert.equal(ownedList.plans.length, 1);
        assert.equal(ownedList.plans[0].slots.some((item) => item.at === markerAt), true);

        const fundedWatch = watch(db);
        const funded = await saveSamplingPlan(fundedWatch.connection, owner, {
          ...base,
          budgetMinor: 1000,
          spentMinor: 0,
          pendingMinor: 0,
          slots: [
            slot(randomUUID(), "official-api", "2026-11-01T00:00:00.000Z", "failed", false, 10),
            slot(randomUUID(), "official-api", markerAt, "scheduled", false, 25),
            slot(randomUUID(), "consumer-sheet", "2026-11-21T00:00:00.000Z", "scheduled", true, 25),
          ],
        }, clock);
        assert.equal(fundedWatch.captured.filter((item) => item.sql.includes("INSERT INTO sampling_slot")).length, 1);
        const fundedId = funded.plan.id;
        const official = funded.plan.slots.find((item) => item.channelId === "official-api" && item.status === "scheduled");
        const consumerSlot = funded.plan.slots.find((item) => item.channelId === "consumer-sheet");
        const expired = await pauseExpiredSamplingChannel(db, owner, {
          action: "expire-channel",
          planId: fundedId,
          channelId: "consumer-sheet",
          nextAt: nextWindow,
        });
        assert.deepEqual(expired.pausedIds, [consumerSlot.id]);
        const afterExpiry = await readSamplingPlan(db, owner, fundedId);
        assert.equal(statusOf(afterExpiry.plan, official.id), "scheduled");
        assert.equal(statusOf(afterExpiry.plan, consumerSlot.id), "paused");
        assert.equal(afterExpiry.plan.slots.find((item) => item.id === consumerSlot.id).manual, true);
        assert.equal(afterExpiry.plan.slots.find((item) => item.id === consumerSlot.id).channelId, "consumer-sheet");
        assert.equal(afterExpiry.plan.slots.some((item) => item.status === "failed"), true);

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extraBrands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO sampling_plan (
            id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at
          ) VALUES ${extraBrands.map(() => "(?, 1, ?, ?, 'active', 'CNY', 100, 0, 0, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO sampling_slot (
            id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 'bulk-channel', ?, 'scheduled', 0, 1)").join(", ")}`,
          extraBrands.flatMap((id, index) => [
            randomUUID(),
            id,
            id,
            outsider,
            `2026-11-22T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
          ]),
        );
        const filler = Array.from({ length: 3000 }, (_, index) => index);
        await queryWithParameters(
          db,
          `INSERT INTO sampling_slot (
            id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
          ) VALUES ${filler.map(() => "(?, ?, ?, ?, 'bulk-channel', '2026-11-22T00:00:00.000Z', 'scheduled', 0, 1)").join(", ")}`,
          filler.flatMap((index) => {
            const brandId = extraBrands[index % extraBrands.length] ?? extraBrands[0];
            return [randomUUID(), brandId, brandId, outsider];
          }),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE sampling_plan");
          await db.query("ANALYZE sampling_slot");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const planQuery = samplingPlanListQuery(brand, owner);
        const slotQuery = samplingSlotListQuery(owner, [planId]);
        const planExplain = JSON.stringify(await queryWithParameters(db, explain + planQuery.sql, planQuery.values));
        const slotExplain = JSON.stringify(await queryWithParameters(db, explain + slotQuery.sql, slotQuery.values));
        assert.match(planExplain, /sampling_plan_owner_idx/);
        assert.match(slotExplain, /sampling_slot_plan_at_idx/);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
