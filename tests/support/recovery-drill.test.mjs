import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { GET as health } from "../../src/app/api/health/route.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { retryBrandPurge } from "../../src/features/brands/purge.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { acceptMonitoringRun, previewMonitoringRun } from "../../src/features/monitoring/commands.ts";
import { executeMonitoringRun, reconcileMonitoringCost } from "../../src/features/monitoring/execution.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { readSupportCase } from "../../src/features/support/read.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { memoryCache, openCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T08:00:00.000Z";
const secret = "support-drill-secret-support-drill-secret";
const answer = "isolated customer answer secret";
const brandBody = "Synthetic customer body";
const poison = "private report secret";
const clock = () => time;

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db, verified = false) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Synthetic support", `${id}@example.invalid`, verified ? (db.kind === "sqlite" ? 1 : true) : (db.kind === "sqlite" ? 0 : false)]);
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

function containsSecret(value) {
  const text = JSON.stringify(value);
  return text.includes(answer) || text.includes(brandBody) || text.includes(poison) || text.includes("Acme API") || text.includes("sopSummary") || text.includes("rawText");
}

test("cache defaults to redis and does not silently use memory", async () => {
  const unconfigured = openCache({ GEO_CACHE_DRIVER: "redis" });
  assert.equal(unconfigured.driver, "redis");
  assert.deepEqual(await unconfigured.get("support:v1:missing"), { state: "blocked", fault: "redis-unconfigured" });
  const isolated = memoryCache();
  const dead = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: "redis://127.0.0.1:1" });
  assert.equal((await dead.get("support:v1:missing")).fault, "redis-unavailable");
  assert.deepEqual(await isolated.get("support:v1:missing"), { state: "miss" });
  assert.equal(openCache({ GEO_CACHE_DRIVER: "memory" }).driver, "memory");
  assert.equal(openCache({ GEO_CACHE_DRIVER: "file" }).driver, "redis");
  assert.equal((await openCache({ GEO_CACHE_DRIVER: "file" }).get("support:v1:missing")).fault, "unsupported-driver");
  let now = 0;
  const timed = memoryCache(() => now);
  assert.equal(await timed.set("empty", "", 30), "stored");
  assert.deepEqual(await timed.get("empty"), { state: "hit", value: "" });
  await timed.set("short", "value", 1);
  now = 1000;
  assert.deepEqual(await timed.get("short"), { state: "miss" });
  const capped = memoryCache();
  for (let index = 0; index < 101; index += 1) await capped.set(`key-${index}`, "value", 30);
  assert.deepEqual(await capped.get("key-0"), { state: "miss" });
  assert.deepEqual(await capped.get("key-100"), { state: "hit", value: "value" });
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: support lookup locates faults without customer content and recovery does not redo success`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await (await import("../maintenance/helpers.mjs")).migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider, operator, supporter] = await Promise.all([account(db, true), account(db), account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, { ...initialBrandFields, name: "Synthetic", description: brandBody }, time);
    for (const permission of ["capabilities.manage", "quotas.manage"]) {
      assert.equal((await changeMaintenanceGrant(db, {
        action: "grant", operatorId: operator, userId: operator, permission, reason: "initial-setup",
      })).status, "allowed");
    }
    const recorded = await recordCapability(db, operator, capability(operator), clock);
    assert.equal(recorded.status, "allowed");
    const channelId = recorded.data.after.channelId;
    const verified = await recordCapability(db, operator, capability(operator, {
      expectedVersion: 1, channelId, reason: "verification", status: "verified", verifiedAt: time, publicVisible: 0,
    }), clock);
    assert.equal(verified.status, "allowed");
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 8, budgetMinor: 1000, currency: "CNY",
      expiresAt: "2026-12-19T08:00:00.000Z",
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
    const preview = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats: 1,
      requestedNetworkMode: "unknown", channelIds: [channelId], ceiling: { currency: "CNY", upperMinor: 10 },
    }, secret, clock);
    assert.equal(preview.error, undefined);
    const operationId = randomUUID();
    const accepted = await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId,
    }, secret, clock);
    assert.equal(accepted.slotCount, 4);
    const unknownSlot = [...accepted.slots].sort((left, right) => left.id.localeCompare(right.id))[0];
    const executed = await executeMonitoringRun(db, owner, accepted.id, {
      label: "isolated",
      sample(input) {
        return Promise.resolve(input.slotId === unknownSlot.id
          ? { disposition: "unknown", rawText: answer, synthetic: true }
          : { disposition: "adopted", rawText: `other ${input.slotId}`, actualMinor: 4, synthetic: true });
      },
    }, clock);
    assert.equal(executed.error, undefined);
    const unknownAttempt = executed.attempts.find((attempt) => attempt.slotId === unknownSlot.id);
    const degradedOperation = randomUUID();
    const degraded = await recordCapability(db, operator, capability(operator, {
      operationId: degradedOperation, expectedVersion: 2, channelId, reason: "significant-change", status: "degraded",
    }), clock);
    assert.equal(degraded.status, "allowed");
    assert.equal(degraded.data.after.status, "degraded");

    const purgeBrand = randomUUID();
    await brands.insertBrand(outsider, purgeBrand, time);
    await brands.insertVersion(purgeBrand, 1, { ...initialBrandFields, name: brandBody, description: brandBody }, time);
    await queryWithParameters(db, `INSERT INTO brand_purge (brand_id, owner_id, frozen_at, started_at, step, issue, completed_at)
      VALUES (?, ?, ?, ?, 1, 'exports-failed', NULL)`, [purgeBrand, outsider, time, time]);

    assert.equal((await changeMaintenanceGrant(db, {
      action: "grant", operatorId: operator, userId: supporter, permission: "support.read", reason: "incident-response",
    })).status, "allowed");
    const cache = memoryCache();
    await cache.set(`support:v1:${accepted.id}`, JSON.stringify({ rawText: answer, privateReport: poison, displayName: "Acme API" }), 30);
    const located = await readSupportCase(db, supporter, accepted.id, cache, false, clock);
    assert.equal(located.status, "allowed");
    assert.equal(located.cache, "origin");
    assert.equal(containsSecret(located), false);
    const runMatch = located.data.matches.find((match) => match.kind === "monitoring-run");
    assert.equal(runMatch.failure, "cost-unknown");
    assert.equal(runMatch.reconciliation, "required");
    assert.equal(runMatch.recovery, "monitoring.reconcile");
    assert.deepEqual(runMatch.remaining, [unknownSlot.id]);
    const byOperation = await readSupportCase(db, supporter, operationId, cache, false, clock);
    assert.equal(byOperation.data.matches[0].subjectId, accepted.id);
    const byAttempt = await readSupportCase(db, supporter, unknownAttempt.id, cache, false, clock);
    assert.equal(byAttempt.data.matches[0].failure, "cost-unknown");
    const channel = await readSupportCase(db, supporter, channelId, memoryCache(), false, clock);
    assert.equal(channel.data.matches.find((match) => match.kind === "capability").failure, "channel-degraded");
    assert.equal(channel.data.matches[0].recovery, "capabilities.review");
    const version = await readSupportCase(db, supporter, degradedOperation, memoryCache(), false, clock);
    assert.equal(version.data.matches[0].status, "degraded");
    const deletion = await readSupportCase(db, supporter, purgeBrand, memoryCache(), false, clock);
    assert.equal(containsSecret(deletion), false);
    assert.equal(deletion.data.matches[0].failure, "deletion-incomplete");
    assert.deepEqual(deletion.data.matches[0].remaining, ["exports", "costs"]);
    assert.equal(deletion.data.matches[0].recovery, "brands.purge.retry");

    const reconciled = await reconcileMonitoringCost(db, owner, accepted.id, unknownAttempt.id, 6, clock);
    assert.equal(reconciled.error, undefined);
    assert.equal((await reconcileMonitoringCost(db, owner, accepted.id, unknownAttempt.id, 7, clock)).error, "OPERATION_CONFLICT");
    const replayed = await reconcileMonitoringCost(db, owner, accepted.id, unknownAttempt.id, 6, clock);
    assert.equal(replayed.replayed, true);
    const afterCost = await readSupportCase(db, supporter, accepted.id, memoryCache(), false, clock);
    assert.equal(afterCost.data.matches[0].reconciliation, "clear");
    assert.deepEqual(afterCost.data.matches[0].remaining, []);
    assert.equal(containsSecret(afterCost), false);

    const queries = [];
    const traced = {
      ...db,
      transaction: (work) => db.transaction((tx) => work({
        ...tx,
        query(sql, params) {
          queries.push(sql);
          return tx.query(sql, params);
        },
        savepoint: (stage) => tx.savepoint((nested) => stage({
          ...nested,
          query(sql, params) {
            queries.push(sql);
            return nested.query(sql, params);
          },
        })),
      })),
    };
    const retried = await retryBrandPurge(traced, { ownerId: outsider, brandId: purgeBrand }, clock);
    assert.equal(retried.status, "cleared");
    assert.equal(queries.some((sql) => sql.startsWith("DELETE FROM brand_version")), false);
    const again = await retryBrandPurge(traced, { ownerId: outsider, brandId: purgeBrand }, clock);
    assert.equal(again.status, "cleared");
    assert.deepEqual(again.remaining, []);
    assert.equal(queries.some((sql) => sql.startsWith("DELETE FROM brand_version")), false);
    const afterPurge = await readSupportCase(db, supporter, purgeBrand, memoryCache(), false, clock);
    assert.equal(afterPurge.data.matches[0].status, "cleared");
    assert.deepEqual(afterPurge.data.matches[0].remaining, []);

    assert.equal((await readSupportCase(db, owner, accepted.id, memoryCache(), false, clock)).reason, "not-granted");
    assert.equal((await readSupportCase(db, operator, accepted.id, memoryCache(), false, clock)).reason, "not-granted");
    assert.equal((await readSupportCase(db, null, accepted.id, memoryCache(), false, clock)).reason, "session-required");
    assert.equal((await readSupportCase(db, supporter, "not an id", memoryCache(), false, clock)).reason, "invalid-input");
    assert.equal((await changeMaintenanceGrant(db, {
      action: "revoke", operatorId: operator, userId: supporter, permission: "support.read", reason: "access-review",
    })).status, "allowed");
    await cache.set(`support:v1:${accepted.id}`, JSON.stringify({ privateReport: poison, rawText: answer }), 30);
    const revoked = await readSupportCase(db, supporter, accepted.id, cache, false, clock);
    assert.equal(revoked.status, "denied");
    assert.equal(containsSecret(revoked), false);
    const audits = await queryWithParameters(db, "SELECT actor_id, subject_id, action, result, reason FROM maintenance_audit", []);
    assert.equal(containsSecret(audits), false);
    assert.ok(audits.some((row) => row.action === "support.read" && row.result === "allowed" && row.subject_id === accepted.id));

    const broken = { ...db, transaction() { return Promise.reject(new Error("synthetic database fault")); } };
    const unavailable = await readSupportCase(broken, supporter, accepted.id, memoryCache(), false, clock);
    assert.equal(unavailable.status, "unavailable");
    assert.equal(JSON.stringify(unavailable).includes("synthetic database fault"), false);
    const redis = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: "redis://127.0.0.1:1" });
    await changeMaintenanceGrant(db, {
      action: "grant", operatorId: operator, userId: supporter, permission: "support.read", reason: "incident-response",
    });
    const fromDatabase = await readSupportCase(db, supporter, channelId, redis, false, clock);
    assert.equal(fromDatabase.status, "allowed");
    assert.equal(fromDatabase.cache, "blocked");
    assert.equal(fromDatabase.data.matches[0].failure, "channel-degraded");
    assert.equal(containsSecret(fromDatabase), false);
    assert.deepEqual(await cache.get("support:v1:unrelated"), { state: "miss" });

    const plan = await db.transaction(async (tx) => {
      if (kind === "postgresql") await tx.query("SET LOCAL enable_seqscan = off");
      const explain = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
      return queryWithParameters(tx, `${explain}SELECT id FROM monitoring_run WHERE operation_id = ?`, [operationId]);
    });
    assert.match(JSON.stringify(plan), /monitoring_run_operation_idx/);
    const live = await health();
    assert.deepEqual(await live.json(), { status: "ok", service: "geo-pro" });
    assert.equal(live.headers.get("cache-control"), "no-store");
    console.log(JSON.stringify({
      kind, runFailure: runMatch.failure, remainingBefore: runMatch.remaining.length,
      reconciliationAfter: afterCost.data.matches[0].reconciliation, deletionRemaining: deletion.data.matches[0].remaining,
      channelFailure: channel.data.matches[0].failure, cache: fromDatabase.cache, revoked: revoked.reason,
    }));
  });
}
