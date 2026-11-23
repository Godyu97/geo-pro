import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { retryBrandPurge } from "../../src/features/brands/purge.ts";
import { submitManualEvidence, reviseAnalysis } from "../../src/features/evidence/commands.ts";
import { adoptedPromptQuery, scopedObservationQuery } from "../../src/features/evidence/dao.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { generateFromEvidence, updateTask } from "../../src/features/optimization/commands.ts";
import { memoryCache, openCache } from "../../src/lib/cache/store.ts";
import { overviewCacheTtlSeconds } from "../../src/features/evidence/overview-cache.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T08:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌", description: "Synthetic brand for overview cache", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

function sha(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function at(index) {
  return new Date(Date.parse(time) + index * 1000).toISOString();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Overview owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

function counting(db) {
  let count = 0;
  function wrap(connection) {
    const wrapped = {
      kind: connection.kind,
      async query(sql, values) {
        count += 1;
        return connection.query(sql, values);
      },
    };
    if (connection.transaction) {
      wrapped.transaction = (work) => connection.transaction((tx) => work(wrap(tx)));
    }
    if (connection.savepoint) {
      wrapped.savepoint = (work) => connection.savepoint((nested) => work(wrap(nested)));
    }
    if (connection.close) wrapped.close = () => connection.close();
    return wrapped;
  }
  return {
    connection: wrap(db),
    count: () => count,
    reset() { count = 0; },
  };
}

async function insertRows(db, prefix, rows) {
  for (let index = 0; index < rows.length; index += 20) {
    const part = rows.slice(index, index + 20);
    const placeholders = part.map((row) => `(${row.map(() => "?").join(", ")})`).join(", ");
    await queryWithParameters(db, `${prefix} VALUES ${placeholders}`, part.flat());
  }
}

async function seedTracked(db, ownerId, brandId, total) {
  const questions = Array.from({ length: total }, (_, index) => ({
    id: randomUUID(),
    text: `品类比较问题${String(index).padStart(3, "0")}`,
    type: index % 10 === 0 ? "comparison" : "discovery",
  }));
  const runs = [];
  let discoveryObservationId = null;
  for (let offset = 0; offset < questions.length; offset += 30) {
    const slice = questions.slice(offset, offset + 30);
    const setId = randomUUID();
    const clusterId = randomUUID();
    const content = JSON.stringify({
      clusters: [{
        id: clusterId, audience: "买家", intent: "选型", primaryPage: "https://yi.example.com/guide", conversionAction: "了解",
      }],
      questions: slice.map((question) => ({
        id: question.id,
        clusterId,
        text: question.text,
        source: "manual",
        sourceNote: "",
        type: question.type,
        stage: "consider",
        region: "CN",
        language: "zh-CN",
        status: "confirmed",
        acceptSimilar: false,
        primary: question.type !== "comparison",
      })),
    });
    await queryWithParameters(db, `INSERT INTO prompt_set
      (brand_id, id, set_id, version, entity_version, region, language, content, created_at)
      VALUES (?, ?, ?, 1, 1, 'CN', 'zh-CN', ?, ?)`, [brandId, setId, setId, content, time]);
    const runId = randomUUID();
    const channelId = randomUUID();
    await queryWithParameters(db, `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, ?, ?, 1, ?, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'succeeded', 1, ?)`,
    [runId, brandId, ownerId, randomUUID(), sha(runId), setId, slice.length, slice.length, slice.length, time]);
    const slots = slice.map((question, index) => ({
      question,
      slotId: randomUUID(),
      attemptId: randomUUID(),
      observationId: randomUUID(),
      analysisId: randomUUID(),
      index: offset + index,
    }));
    await insertRows(db, `INSERT INTO monitoring_slot (
      id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
      reservation_id, status, created_at, adopted_attempt_id, late
    )`, slots.map((slot) => [
      slot.slotId, runId, brandId, slot.question.id, 1, channelId, 1, 1, null, "queued", at(slot.index), null, 0,
    ]));
    await insertRows(db, `INSERT INTO monitoring_attempt (
      id, slot_id, run_id, brand_id, kind, ordinal, transport, synthetic, disposition, raw_text,
      currency, upper_minor, actual_minor, cost_state, quota_attempt_id, late, created_at
    )`, slots.map((slot) => [
      slot.attemptId, slot.slotId, runId, brandId, "sampling", 1, "isolated", 1, "adopted", "可以考虑其他方案。",
      null, null, null, "none", null, 0, at(slot.index),
    ]));
    await queryWithParameters(db, `UPDATE monitoring_slot
      SET status = 'succeeded', adopted_attempt_id = (
        SELECT id FROM monitoring_attempt WHERE monitoring_attempt.slot_id = monitoring_slot.id AND disposition = 'adopted'
      ) WHERE run_id = ?`, [runId]);
    await insertRows(db, `INSERT INTO answer_observation (
      id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
      fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
      evidence_state, locator_ref, collector_id, missing_reason, created_at,
      target_region, observed_region, new_session, product_mode
    )`, slots.map((slot) => [
      slot.observationId, brandId, ownerId, slot.slotId, slot.attemptId, "consumer_ui", "manual",
      slot.question.text, "样本回答未点名品牌。", sha(slot.observationId), at(slot.index), "CN", "zh-CN", "unknown",
      1, "complete", "complete", null, null, null, at(slot.index), "CN", "unknown", "unknown", "unknown",
    ]));
    await insertRows(db, `INSERT INTO answer_analysis_version (
      id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
      official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
    )`, slots.map((slot) => [
      slot.analysisId, slot.observationId, brandId, 1, 1, "s-m0-06-v1", "true", "false", "false",
      null, "classified", null, null, null, at(slot.index),
    ]));
    const discovery = slots.find((slot) => slot.question.type !== "comparison");
    if (!discoveryObservationId && discovery) discoveryObservationId = discovery.observationId;
    runs.push({ runId, slotId: slots[0].slotId });
  }
  return { slotId: runs[0].slotId, discoveryObservationId };
}

function scopeOf(brandId) {
  return { brandId, sourceMode: "consumer_ui" };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: overview batch SQL, cache freshness and write invalidation`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
    const meter = counting(db);
    const [ownerSmall, ownerLarge, ownerManual, outsider] = await Promise.all([account(db), account(db), account(db), account(db)]);
    const brands = new BrandDao(db);
    const small = randomUUID();
    const large = randomUUID();
    const manual = randomUUID();
    await brands.insertBrand(ownerSmall, small, time);
    await brands.insertVersion(small, 1, fields, time);
    await brands.insertBrand(ownerLarge, large, time);
    await brands.insertVersion(large, 1, fields, time);
    await brands.insertBrand(ownerManual, manual, time);
    await brands.insertVersion(manual, 1, fields, time);
    const smallSeed = await seedTracked(db, ownerSmall, small, 30);
    const largeSeed = await seedTracked(db, ownerLarge, large, 120);
    const comparisons = (total) => Math.ceil(total / 10);
    const cache = memoryCache();

    meter.reset();
    const smallStarted = performance.now();
    const smallView = await readEvidenceOverview(meter.connection, ownerSmall, scopeOf(small), cache);
    const smallMs = performance.now() - smallStarted;
    const smallQueries = meter.count();
    assert.equal(smallView.sampleCount, 30 - comparisons(30));
    assert.equal(smallView.answers.length, 30);
    assert.equal(smallView.demo, false);
    assert.equal(smallView.scope.hasOfficialWebsite, true);

    meter.reset();
    const smallHit = await readEvidenceOverview(meter.connection, ownerSmall, scopeOf(small), cache);
    const hitQueries = meter.count();
    assert.equal(smallHit.sampleCount, smallView.sampleCount);
    assert.equal(smallHit.metrics.recommended.equalWeight, smallView.metrics.recommended.equalWeight);
    assert.equal(hitQueries, 1);

    const largeCache = memoryCache();
    meter.reset();
    const largeStarted = performance.now();
    const largeView = await readEvidenceOverview(meter.connection, ownerLarge, scopeOf(large), largeCache);
    const largeMs = performance.now() - largeStarted;
    const largeQueries = meter.count();
    assert.equal(largeView.sampleCount, 120 - comparisons(120));
    assert.equal(largeView.answers.length, 120);
    assert.ok(largeQueries < 20, `large query count ${largeQueries}`);
    assert.ok(largeQueries <= smallQueries + 3, `small ${smallQueries} large ${largeQueries}`);
    assert.ok(largeQueries < 120 / 4, `queries scaled with samples: ${largeQueries}`);

    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const listQuery = scopedObservationQuery({ ownerId: ownerLarge, brandId: large, sourceMode: "consumer_ui" });
    const adoptedQuery = adoptedPromptQuery(large, ownerLarge, [smallSeed.slotId]);
    const listPlan = await queryWithParameters(db, explainPrefix + listQuery.sql, listQuery.values);
    const adoptedPlan = await queryWithParameters(db, explainPrefix + adoptedQuery.sql, adoptedQuery.values);
    assert.ok(JSON.stringify(listPlan).length > 20);
    assert.ok(JSON.stringify(adoptedPlan).length > 10);

    let now = 1_000_000;
    const timed = memoryCache(() => now);
    await readEvidenceOverview(db, ownerSmall, scopeOf(small), timed);
    now += (overviewCacheTtlSeconds * 1000) + 1;
    meter.reset();
    const expired = await readEvidenceOverview(meter.connection, ownerSmall, scopeOf(small), timed);
    assert.equal(expired.sampleCount, smallView.sampleCount);
    assert.ok(meter.count() > 1, "expired cache must read the database again");

    let gets = 0;
    const inner = memoryCache();
    const watched = {
      driver: "memory",
      async get(key) {
        gets += 1;
        return inner.get(key);
      },
      set: (key, value, ttl) => inner.set(key, value, ttl),
      delete: (key) => inner.delete(key),
    };
    const denied = await readEvidenceOverview(db, outsider, scopeOf(small), watched);
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(gets, 0);

    const shared = memoryCache();
    const smallIsolated = await readEvidenceOverview(db, ownerSmall, scopeOf(small), shared);
    const manualSubmitted = await submitManualEvidence(db, ownerManual, {
      action: "submit-manual",
      brandId: manual,
      operationId: randomUUID(),
      questionText: "这个品类里有哪些选择？",
      answerText: "这里没有点名任何品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://overview-cache",
      collectorId: ownerManual,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock, shared);
    assert.equal(manualSubmitted.error, undefined);
    const manualView = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(manualView.sampleCount, 1);
    assert.equal(manualView.metrics.recommended.equalWeight, 0);
    assert.notEqual(smallIsolated.sampleCount, manualView.sampleCount);

    const generated = await generateFromEvidence(db, ownerManual, {
      action: "generate-from-evidence",
      brandId: manual,
      operationId: randomUUID(),
      observationId: manualSubmitted.observation.id,
      businessImportance: 2,
    }, clock, shared);
    assert.ok(generated.tasks?.length > 0);
    const withTask = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(withTask.suggestions.length, 1);
    assert.equal(withTask.suggestions[0].status, "todo");
    const updated = await updateTask(db, ownerManual, {
      action: "update-task",
      brandId: manual,
      taskId: generated.tasks[0].taskId,
      operationId: randomUUID(),
      status: "doing",
    }, clock, shared);
    assert.equal(updated.task.status, "doing");
    const afterTask = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(afterTask.suggestions[0].status, "doing");

    const revised = await reviseAnalysis(db, ownerManual, {
      action: "revise-analysis",
      brandId: manual,
      observationId: manualSubmitted.observation.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
      reason: "人工复核确认推荐",
    }, clock, shared);
    assert.equal(revised.error, undefined);
    const afterRevise = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(afterRevise.metrics.recommended.equalWeight, 1);
    const otherMemory = memoryCache();
    const otherInstance = await readEvidenceOverview(db, ownerManual, scopeOf(manual), otherMemory);
    assert.equal(otherInstance.metrics.recommended.equalWeight, 1);

    const capped = memoryCache();
    await readEvidenceOverview(db, ownerSmall, scopeOf(small), capped);
    for (let index = 0; index < 100; index += 1) await capped.set(`pad:${index}`, "x", 30);
    const afterEvict = await readEvidenceOverview(db, ownerSmall, scopeOf(small), capped);
    assert.equal(afterEvict.sampleCount, smallView.sampleCount);

    const logged = [];
    const original = console.error;
    console.error = (event, extra) => {
      logged.push(event);
      original(event, extra);
    };
    try {
      const dead = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: "redis://127.0.0.1:1" });
      const fallback = await readEvidenceOverview(db, ownerSmall, scopeOf(small), dead);
      assert.equal(fallback.sampleCount, smallView.sampleCount);
      assert.equal(fallback.scope.brandId, small);
    } finally {
      console.error = original;
    }
    assert.ok(logged.includes("evidence-overview-cache-unavailable"));

    const frozen = await executeBrandCommand(db, ownerManual, {
      action: "freeze",
      operationId: randomUUID(),
      actorId: ownerManual,
      brandId: manual,
      expectedBrandRevision: 1,
      confirmed: true,
    }, undefined, () => new Date(time), shared);
    assert.equal("mutation" in frozen, true);
    const frozenView = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(frozenView.error, "NOT_FOUND");
    await queryWithParameters(db, "UPDATE brand SET restore_until = ? WHERE id = ?", ["2026-11-01T00:00:00.000Z", manual]);
    const purged = await retryBrandPurge(db, { ownerId: ownerManual, brandId: manual }, () => time, shared);
    assert.notEqual(purged.status, "failed");
    const purgedView = await readEvidenceOverview(db, ownerManual, scopeOf(manual), shared);
    assert.equal(purgedView.error, "NOT_FOUND");

    const probeUrl = process.env.REDIS_URL;
    const probe = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: probeUrl });
    const probed = await probe.get(`evidence-overview:probe:${randomUUID()}`);
    let redisShared = "unavailable";
    if (probed.state !== "blocked") {
      const first = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: probeUrl });
      const second = openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: probeUrl });
      const before = await readEvidenceOverview(db, ownerLarge, scopeOf(large), first);
      const revisedLarge = await reviseAnalysis(db, ownerLarge, {
        action: "revise-analysis",
        brandId: large,
        observationId: largeSeed.discoveryObservationId,
        expectedVersion: 1,
        operationId: randomUUID(),
        mentioned: "true",
        recommended: "true",
        officialSiteCited: "false",
        reason: "共享缓存失效复核",
      }, clock, first);
      assert.equal(revisedLarge.error, undefined);
      const after = await readEvidenceOverview(db, ownerLarge, scopeOf(large), second);
      assert.notEqual(after.metrics.recommended.equalWeight, before.metrics.recommended.equalWeight);
      redisShared = "shared-client-invalidated";
    }

    console.log(JSON.stringify({
      event: "overview-perf",
      kind,
      smallSamples: 30,
      largeSamples: 120,
      smallQueries,
      largeQueries,
      hitQueries,
      smallMs: Number(smallMs.toFixed(1)),
      largeMs: Number(largeMs.toFixed(1)),
      listPlan,
      adoptedPlan,
      redisShared,
    }));
  });
}
