import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { readOwnerUsage } from "../../src/features/monitoring/activity.ts";
import { acceptMonitoringRun, previewMonitoringRun, readMonitoringRun } from "../../src/features/monitoring/commands.ts";
import {
  cancelMonitoringRun,
  continueMonitoringRun,
  executeMonitoringRun,
  pauseMonitoringRun,
  reconcileMonitoringCost,
  recordLateMonitoringResult,
  redoMonitoringAnalysis,
} from "../../src/features/monitoring/execution.ts";
import { closedOfficialPort } from "../../src/features/monitoring/transport.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T06:00:00.000Z";
const secret = "monitoring-test-secret-monitoring-test";
const clock = () => time;
const fields = {
  name: "Synthetic", description: "Synthetic brand for run execution", website: "", aliases: [],
  region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db, verified = false) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Synthetic execution", `${id}@example.invalid`, verified ? (db.kind === "sqlite" ? 1 : true) : (db.kind === "sqlite" ? 0 : false)]);
  return id;
}

function capability(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 0, citationCapability: "partial",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Human SOP without secrets", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

function transport(decide) {
  const calls = [];
  return {
    label: "isolated",
    calls,
    sample(input) {
      calls.push(input.slotId);
      return Promise.resolve(decide(input));
    },
  };
}

async function acceptRun(db, owner, brand, setId, channelId) {
  const preview = await previewMonitoringRun(db, owner, {
    action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats: 1,
    requestedNetworkMode: "unknown", channelIds: [channelId], ceiling: { currency: "CNY", upperMinor: 10 },
  }, secret, clock);
  assert.equal(preview.error, undefined);
  return acceptMonitoringRun(db, owner, {
    action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
  }, secret, clock);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: isolated execution recovers progress, budget and owner usage`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider, operator] = await Promise.all([account(db, true), account(db), account(db)]);
    const brand = randomUUID();
    const otherBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    await brands.insertBrand(outsider, otherBrand, time);
    await brands.insertVersion(otherBrand, 1, fields, time);
    for (const permission of ["capabilities.manage", "quotas.manage"]) {
      assert.equal((await changeMaintenanceGrant(db, {
        action: "grant", operatorId: operator, userId: operator, permission, reason: "initial-setup",
      })).status, "allowed");
    }
    const api = (await recordCapability(db, operator, capability(operator), clock)).data.after;
    const verified = (await recordCapability(db, operator, capability(operator, {
      expectedVersion: 1, channelId: api.channelId, reason: "verification", status: "verified", verifiedAt: time, publicVisible: 0,
    }), clock)).data.after;
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 20, budgetMinor: 5000, currency: "CNY",
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: otherBrand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 50, budgetMinor: 5000, currency: "CNY",
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");

    const clusterId = randomUUID();
    const questions = [
      ["这个品类里，大家通常会比较哪些条件？", true, "discovery"],
      ["日常使用时，最先要确认的使用场景是什么？", true, "scenario"],
      ["预算有限时，怎样判断一个选择是否合适？", true, "constraint"],
      ["和甲品牌相比，这个方案适合哪些限制？", false, "comparison"],
    ].map(([text, primary, type]) => ({
      id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type, stage: "awareness",
      region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary,
    }));
    const setId = randomUUID();
    await new PromptDao(db, brand).insertSet({
      id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time,
      content: { clusters: [{ id: clusterId, audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }], questions },
    });

    const accepted = await acceptRun(db, owner, brand, setId, verified.channelId);
    assert.equal(accepted.slotCount, 4);
    const unknownSlot = [...accepted.slots].sort((left, right) => left.id.localeCompare(right.id))[3];
    const sampler = transport((input) => input.slotId === unknownSlot.id
      ? { disposition: "unknown", synthetic: true }
      : { disposition: "adopted", rawText: `isolated ${input.slotId}`, actualMinor: 4, synthetic: true });
    const executed = await executeMonitoringRun(db, owner, accepted.id, sampler, clock);
    assert.equal(executed.error, undefined);
    assert.equal(executed.slotCount, 4);
    assert.equal(executed.slots.filter((slot) => slot.status === "succeeded").length, 3);
    assert.equal(executed.slots.filter((slot) => slot.status === "reconciliation_required").length, 1);
    assert.equal(sampler.calls.length, 4);
    const again = await executeMonitoringRun(db, owner, accepted.id, sampler, clock);
    assert.equal(again.error, undefined);
    assert.equal(sampler.calls.length, 4);
    const [unknownReservation] = await queryWithParameters(db, "SELECT state FROM quota_reservation WHERE id = ?", [unknownSlot.reservationId]);
    assert.equal(unknownReservation.state, "reserved");
    const reread = await readMonitoringRun(db, owner, accepted.id);
    assert.equal(reread.slotCount, 4);
    assert.equal(reread.slots.filter((slot) => slot.status === "succeeded").length, 3);
    assert.equal((await readMonitoringRun(db, outsider, accepted.id)).error, "NOT_FOUND");
    const closed = await executeMonitoringRun(db, owner, accepted.id, closedOfficialPort(), clock);
    assert.equal(closed.error, "REAL_CHANNEL_CLOSED");
    assert.equal(sampler.calls.length, 4);

    const [costBefore] = await queryWithParameters(db, "SELECT COALESCE(SUM(actual_minor), 0) AS actual FROM quota_attempt WHERE brand_id = ? AND state = 'known'", [brand]);
    const succeeded = executed.slots.find((slot) => slot.status === "succeeded");
    const redone = await redoMonitoringAnalysis(db, owner, accepted.id, succeeded.id, clock);
    assert.equal(redone.error, undefined);
    const analysis = redone.attempts.find((attempt) => attempt.kind === "analysis" && attempt.slotId === succeeded.id);
    const adopted = redone.attempts.find((attempt) => attempt.id === succeeded.adoptedAttemptId);
    assert.equal(analysis.disposition, "analysis_reuse");
    assert.equal(analysis.rawText, adopted.rawText);
    assert.equal(analysis.actualMinor, null);
    const [costAfter] = await queryWithParameters(db, "SELECT COALESCE(SUM(actual_minor), 0) AS actual FROM quota_attempt WHERE brand_id = ? AND state = 'known'", [brand]);
    assert.equal(Number(costAfter.actual), Number(costBefore.actual));
    assert.equal(sampler.calls.length, 4);

    const unknownAttempt = executed.attempts.find((attempt) => attempt.slotId === unknownSlot.id);
    assert.equal(unknownAttempt.actualMinor, null);
    const late = await recordLateMonitoringResult(db, owner, accepted.id, unknownAttempt.id, "late synthetic text", 6, clock);
    assert.equal(late.error, undefined);
    assert.equal(late.slotCount, 4);
    assert.equal(late.slots.find((slot) => slot.id === unknownSlot.id).late, 1);
    assert.equal(sampler.calls.length, 4);
    const replayedCost = await reconcileMonitoringCost(db, owner, accepted.id, unknownAttempt.id, 6, clock);
    assert.equal(replayedCost.replayed, true);
    assert.equal((await reconcileMonitoringCost(db, owner, accepted.id, unknownAttempt.id, 7, clock)).error, "OPERATION_CONFLICT");

    const rollbackRun = await acceptRun(db, owner, brand, setId, verified.channelId);
    await assert.rejects(() => executeMonitoringRun(db, owner, rollbackRun.id, transport(() => {
      throw new Error("should-not-sample");
    }), clock, { failBeforeCommit: true }), /forced-rollback/);
    const [attemptCount] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM monitoring_attempt WHERE run_id = ?", [rollbackRun.id]);
    assert.equal(Number(attemptCount.count), 0);
    assert.equal((await readMonitoringRun(db, owner, rollbackRun.id)).status, "queued");
    const paused = await pauseMonitoringRun(db, owner, rollbackRun.id);
    assert.equal(paused.status, "paused");
    assert.equal(paused.slots.every((slot) => slot.status === "paused"), true);
    assert.equal((await pauseMonitoringRun(db, owner, rollbackRun.id)).replayed, true);
    const continued = await continueMonitoringRun(db, owner, rollbackRun.id);
    assert.equal(continued.status, "queued");
    assert.equal((await readMonitoringRun(db, owner, rollbackRun.id)).slots.every((slot) => slot.status === "queued"), true);
    const cancelled = await cancelMonitoringRun(db, owner, rollbackRun.id, clock);
    assert.equal(cancelled.slotCount, 4);
    assert.equal(cancelled.slots.every((slot) => slot.status === "cancelled"), true);
    const [released] = await queryWithParameters(db, `SELECT COUNT(*) AS count FROM quota_reservation WHERE id IN (${rollbackRun.slots.map(() => "?").join(", ")}) AND state = 'released'`,
      rollbackRun.slots.map((slot) => slot.reservationId));
    assert.equal(Number(released.count), 4);
    assert.equal((await cancelMonitoringRun(db, owner, rollbackRun.id, clock)).replayed, true);

    const contested = await acceptRun(db, owner, brand, setId, verified.channelId);
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: 1, reason: "budget-decrease", countLimit: 5, budgetMinor: 5000, currency: "CNY",
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");
    const racing = transport(() => ({ disposition: "adopted", rawText: "one unit", actualMinor: 4, synthetic: true }));
    const [first, second] = await Promise.all([
      executeMonitoringRun(db, owner, contested.id, racing, clock),
      executeMonitoringRun(db, owner, contested.id, racing, clock),
    ]);
    assert.equal(first.error, undefined);
    assert.equal(second.error, undefined);
    assert.equal(racing.calls.length, 1);
    const raced = await readMonitoringRun(db, owner, contested.id);
    assert.equal(raced.slotCount, 4);
    assert.equal(raced.slots.filter((slot) => slot.status === "succeeded").length, 1);
    assert.equal(raced.slots.filter((slot) => slot.status === "paused").length, 3);

    const noise = Array.from({ length: 30 }, () => randomUUID());
    await queryWithParameters(db, `INSERT INTO quota_reservation (brand_id, kind, id, grant_version, upper_minor, state, created_at)
      VALUES ${noise.map(() => "(?, 'sampling', ?, 1, 10, 'reserved', '2026-11-18T00:00:00.000Z')").join(", ")}`,
    noise.flatMap((id) => [otherBrand, id]));
    const older = Array.from({ length: 25 }, () => randomUUID());
    await queryWithParameters(db, `INSERT INTO quota_reservation (brand_id, kind, id, grant_version, upper_minor, state, created_at)
      VALUES ${older.map(() => "(?, 'sampling', ?, 1, 10, 'reserved', '2026-11-18T00:00:00.000Z')").join(", ")}`,
    older.flatMap((id) => [brand, id]));
    if (db.kind === "postgresql") {
      await db.query("ANALYZE quota_reservation");
      await db.query("SET enable_seqscan = off");
    }
    const listSql = "SELECT id FROM quota_reservation WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
    const plan = JSON.stringify(await queryWithParameters(db, (db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ") + listSql, [brand, 20]));
    assert.match(plan, /quota_reservation_brand_recent_idx/);
    if (db.kind === "postgresql") await db.query("SET enable_seqscan = on");

    const usage = await readOwnerUsage(db, owner, {});
    assert.equal(usage.customerPayableMinor, 0);
    assert.equal(usage.items.length, 20);
    assert.ok(usage.next);
    assert.equal(usage.items.every((item) => item.brandId === brand), true);
    assert.ok(usage.summaries.some((summary) => summary.currency === "CNY" && summary.actualMinor > 0));
    assert.equal(usage.attempts.some((attempt) => attempt.state !== "known" && attempt.actualMinor === 0), false);
    const seen = new Set(usage.items.map((item) => item.id));
    let cursor = usage.next;
    let pages = 1;
    while (cursor) {
      const next = await readOwnerUsage(db, owner, cursor);
      pages += 1;
      for (const item of next.items) {
        assert.equal(seen.has(item.id), false);
        assert.equal(item.brandId, brand);
        seen.add(item.id);
      }
      cursor = next.next;
    }
    assert.ok(pages > 1);
    assert.equal((await readOwnerUsage(db, owner, { currency: "USD" })).items.length, 0);
    const hidden = await readOwnerUsage(db, outsider, {});
    assert.equal(hidden.items.some((item) => item.brandId === brand), false);
    assert.equal((await readOwnerUsage(db, operator, {})).items.length, 0);
  });
}
