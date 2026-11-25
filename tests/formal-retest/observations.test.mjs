import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import {
  createFormalObservation,
  listFormalObservations,
  recordFormalCheckpoint,
} from "../../src/features/formal-retest/commands.ts";
import {
  createFormalObservationSchema,
  formalObservationErrors,
  recordFormalCheckpointSchema,
} from "../../src/features/formal-retest/contracts.ts";
import {
  effectiveInterventionQuery,
  formalCheckpointListQuery,
  formalObservationListQuery,
  formalSavedSlotsQuery,
  verifiedPublicationQuery,
} from "../../src/features/formal-retest/dao.ts";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const excluded = ["q24", "q25", "q26", "q27", "q28", "q29", "q30"];

test("checkpoint requests reject a caller-supplied conclusion and an impossible day", () => {
  assert.equal(formalObservationErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  assert.equal(createFormalObservationSchema.safeParse({
    brandId,
    frozenSetId: "frozen-core",
    effectiveOn: "2026-11-22",
    frozenNonBrandCount: 30,
    conclusion: "品牌已提升",
  }).success, false);
  assert.equal(recordFormalCheckpointSchema.safeParse({
    checkpoint: "d14",
    today: "2026-02-31",
    comparableQuestions: 23,
    excluded,
    requestedMode: "formal",
  }).success, false);
  assert.equal(recordFormalCheckpointSchema.safeParse({
    checkpoint: "d14",
    today: "2026-11-22",
    comparableQuestions: 23,
    excluded,
    requestedMode: "formal",
    conclusion: "完整观察结论",
  }).success, false);
  assert.equal(recordFormalCheckpointSchema.safeParse({
    checkpoint: "d14",
    today: "2026-11-22",
    requestedMode: "formal",
  }).success, true);
});

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
    savepoint: target.savepoint
      ? (work) => target.savepoint((inner) => work(wrap(inner)))
      : undefined,
  });
  return { captured, connection: wrap(db) };
}

function clockFrom(stamps) {
  let index = 0;
  return () => stamps[Math.min(index++, stamps.length - 1)];
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Observation owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function formalRequest(today, comparableQuestions = 0, ids = []) {
  return {
    checkpoint: "d14",
    today,
    comparableQuestions,
    excluded: ids,
    requestedMode: "formal",
  };
}

async function seedWindowRun(db, {
  owner,
  brand,
  frozenSetId,
  at,
  count = 30,
  exploreCount = 0,
  override = () => ({}),
}) {
  const monitoring = new MonitoringDao(db);
  const evidence = new EvidenceDao(db);
  const runId = randomUUID();
  const channelId = randomUUID();
  const totalSlots = count + exploreCount;
  await monitoring.insertRun({
    id: runId, brandId: brand, ownerId: owner, operationId: randomUUID(),
    fingerprint: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    track: "model_api", promptSetId: frozenSetId, promptSetVersion: 1, repeatCount: 1,
    questionCount: totalSlots, naturalCount: count, channelCount: 1, slotCount: totalSlots,
    region: "CN", language: "zh-CN", requestedNetworkMode: "off", currency: "CNY",
    upperMinor: 0, estimateHighMinor: 0, createdAt: at,
  });
  const slots = [];
  for (let i = 1; i <= count; i += 1) {
    slots.push({
      id: randomUUID(), runId, brandId: brand, questionId: `q${String(i).padStart(2, "0")}`,
      natural: 1, channelId, channelVersion: 1, repeatIndex: 1, reservationId: null, createdAt: at,
    });
  }
  for (let i = 1; i <= exploreCount; i += 1) {
    slots.push({
      id: randomUUID(), runId, brandId: brand, questionId: `ex${String(i).padStart(2, "0")}`,
      natural: 0, channelId, channelVersion: 1, repeatIndex: 1, reservationId: null, createdAt: at,
    });
  }
  await monitoring.insertSlots(slots);
  for (const [index, slot] of slots.entries()) {
    const config = slot.natural === 0 ? { slotStatus: "failed" } : override(index + 1);
    const status = config.slotStatus ?? "succeeded";
    if (status !== "succeeded") {
      await queryWithParameters(db, `UPDATE monitoring_slot SET status = ? WHERE id = ?`, [status, slot.id]);
      continue;
    }
    await queryWithParameters(
      db,
      `UPDATE monitoring_slot SET status = 'succeeded', adopted_attempt_id = ? WHERE id = ?`,
      [slot.id, slot.id],
    );
    const obsId = randomUUID();
    await evidence.insertObservation({
      id: obsId, brandId: brand, ownerId: owner, slotId: slot.id, attemptId: null,
      sourceMode: "model_api", captureMethod: "isolated", questionText: `Question ${slot.questionId}?`,
      answerText: "Synthetic answer", fingerprint: "b".repeat(64),
      region: "CN", targetRegion: "CN", observedRegion: "unknown", newSession: "unknown", productMode: "unknown",
      networkTrigger: "not_triggered", language: "zh-CN", requestedNetworkMode: "off", entityVersion: 1,
      citationSetState: config.citationSetState ?? "complete", evidenceState: config.evidenceState ?? "complete",
      locatorRef: null, collectorId: null, missingReason: null, capturedAt: at, createdAt: at,
    });
    await evidence.insertAnalysis({
      id: randomUUID(), observationId: obsId, brandId: brand, version: 1, entityVersion: 1,
      ruleVersion: "rule-v1",
      mentioned: config.mentioned ?? "true",
      recommended: config.recommended ?? "false",
      officialSiteCited: config.officialSiteCited ?? "true",
      evidenceSpan: null, status: "classified", revisedFrom: null, reason: null, reviewerId: null, createdAt: at,
    });
  }
  return slots;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: checkpoints use saved brand+set slots, reject manual override, and never rewrite rows`, async () => {
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
        const clock = clockFrom([
          "2026-12-31T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
          "2026-01-02T00:00:00.000Z",
          "2026-01-03T00:00:00.000Z",
          "2026-01-04T00:00:00.000Z",
          "2026-01-05T00:00:00.000Z",
          "2026-01-06T00:00:00.000Z",
        ]);

        const hidden = await createFormalObservation(db, outsider, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-11-22",
          frozenNonBrandCount: 30,
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("frozen-core"), false);

        // Outsider owns full passing runs on the same frozenSetId; they must never enter owner's calculation.
        await seedWindowRun(db, { owner: outsider, brand: otherBrand, frozenSetId: "frozen-core", at: "2026-09-20T12:00:00.000Z" });
        await seedWindowRun(db, { owner: outsider, brand: otherBrand, frozenSetId: "frozen-core", at: "2026-10-05T12:00:00.000Z" });

        const earlyWatch = watch(db);
        const early = await createFormalObservation(earlyWatch.connection, owner, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-11-22",
          frozenNonBrandCount: 30,
        }, clock);
        assert.equal(early.observation.frozenSetId, "frozen-core");
        assert.equal(early.observation.status, "observing");
        assert.equal(earlyWatch.captured.some((item) => /prompt_set|monitoring_run/.test(item.sql)), false);
        const earlyPoint = await recordFormalCheckpoint(
          db,
          owner,
          early.observation.id,
          formalRequest("2026-11-22", 30, []),
          clock,
        );
        assert.equal(earlyPoint.checkpoint.mode, "progress");
        assert.equal(earlyPoint.checkpoint.conclusion, null);
        assert.equal(earlyPoint.checkpoint.evaluation, null);
        assert.equal(earlyPoint.checkpoint.evaluatedOn, "2026-11-22");
        assert.equal(earlyPoint.checkpoint.createdAt, "2026-01-01T00:00:00.000Z");
        assert.equal(earlyPoint.observation.status, "observing");

        const deniedPoint = await recordFormalCheckpoint(
          db,
          outsider,
          early.observation.id,
          formalRequest("2026-11-22", 30, []),
          clock,
        );
        assert.deepEqual(deniedPoint, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedPoint).includes("frozen-core"), false);

        // Due observation with NO matching slots for owner -> manual comparableQuestions=30 cannot make it formal!
        const baseline = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 30,
        }, clock);
        const missing = await recordFormalCheckpoint(
          db,
          owner,
          baseline.observation.id,
          formalRequest("2026-11-22", 30, excluded),
          clock,
        );
        assert.equal(missing.checkpoint.mode, "exploratory");
        assert.equal(missing.checkpoint.comparableCount, 0);
        assert.equal(missing.checkpoint.conclusion.includes("formal"), false);
        assert.equal(missing.checkpoint.evaluation?.missingSamples, true);
        assert.deepEqual(missing.checkpoint.evaluation?.insufficiencyReasons, ["missing_samples"]);
        assert.deepEqual(missing.checkpoint.excluded, excluded);
        assert.equal(missing.observation.status, "checkpoint_due");

        // Now seed owner's saved slots for an observation where only 23/30 are comparable on recommendation
        // and citation Jc/E is below 80%.
        const partialSet = "frozen-partial-metrics";
        const partialObs = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: partialSet,
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 30,
        }, clock);
        await seedWindowRun(db, { owner, brand, frozenSetId: partialSet, at: "2026-09-20T12:00:00.000Z" });
        await seedWindowRun(db, {
          owner,
          brand,
          frozenSetId: partialSet,
          at: "2026-10-05T12:00:00.000Z",
          override: (i) => {
            if (i >= 24) return { recommended: "unknown", citationSetState: "partial", officialSiteCited: "unknown" };
            return {};
          },
        });
        const insufficient = await recordFormalCheckpoint(
          db,
          owner,
          partialObs.observation.id,
          formalRequest("2026-11-22", 30, []),
          clock,
        );
        assert.equal(insufficient.checkpoint.mode, "exploratory");
        assert.equal(insufficient.checkpoint.comparableCount, 23);
        assert.equal(insufficient.checkpoint.evaluation?.metrics.mention.comparableCount, 30);
        assert.equal(insufficient.checkpoint.evaluation?.metrics.recommendation.comparableCount, 23);
        assert.equal(insufficient.checkpoint.evaluation?.metrics.citation.comparableCount, 23);
        assert.equal(insufficient.checkpoint.evaluation?.metrics.citation.after.cOverE, 23 / 30);
        assert.equal(insufficient.checkpoint.evaluation?.metrics.citation.after.jcOverC, 1);
        assert.deepEqual(insufficient.checkpoint.excluded, excluded);

        // Now seed owner's saved slots for baseline ("frozen-core") meeting all coverage + 3 metric gates,
        // plus 2 failing exploration slots (natural_question = 0) that must NOT block formal.
        await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-core", at: "2026-09-20T12:00:00.000Z", exploreCount: 2 });
        await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-core", at: "2026-10-05T12:00:00.000Z", exploreCount: 2 });
        const formal = await recordFormalCheckpoint(
          db,
          owner,
          baseline.observation.id,
          formalRequest("2026-11-22", 0, []),
          clock,
        );
        assert.equal(formal.checkpoint.mode, "formal");
        assert.equal(formal.checkpoint.comparableCount, 30);
        assert.equal(formal.checkpoint.evaluation?.metrics.citation.before.cOverE, 1);
        assert.equal(formal.checkpoint.evaluation?.metrics.citation.before.jcOverC, 1);
        assert.equal(formal.checkpoint.evaluation?.metrics.citation.after.cOverE, 1);
        assert.equal(formal.checkpoint.evaluation?.metrics.citation.after.jcOverC, 1);
        assert.equal(formal.checkpoint.evaluation?.slotIds.length, 60);
        assert.notEqual(formal.checkpoint.conclusion, null);
        assert.equal(formal.observation.checkpoints.length, 2);
        const previous = formal.observation.checkpoints.find((item) => item.id === missing.checkpoint.id);
        assert.equal(previous.mode, "exploratory");
        assert.deepEqual(previous.excluded, excluded);

        // Submitting again must not rewrite the previously stored formal checkpoint row.
        const formalRowBefore = await queryWithParameters(
          db,
          `SELECT id, mode, comparable_count AS "comparableCount", excluded_json AS "excludedJson",
                  evaluation_json AS "evaluationJson", conclusion
           FROM formal_checkpoint WHERE id = ?`,
          [formal.checkpoint.id],
        );
        await recordFormalCheckpoint(db, owner, baseline.observation.id, formalRequest("2026-11-23", 1, ["q01"]), clock);
        const formalRowAfter = await queryWithParameters(
          db,
          `SELECT id, mode, comparable_count AS "comparableCount", excluded_json AS "excludedJson",
                  evaluation_json AS "evaluationJson", conclusion
           FROM formal_checkpoint WHERE id = ?`,
          [formal.checkpoint.id],
        );
        assert.deepEqual(formalRowAfter, formalRowBefore);

        const rows = await queryWithParameters(
          db,
          `SELECT id, mode FROM formal_checkpoint WHERE observation_id = ? ORDER BY created_at ASC, id ASC`,
          [baseline.observation.id],
        );
        assert.deepEqual(rows.map((row) => row.mode), ["exploratory", "formal", "formal"]);

        const outsiderList = await listFormalObservations(db, outsider, brand);
        assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderList).includes("q24"), false);
        const listWatch = watch(db);
        const ownedList = await listFormalObservations(listWatch.connection, owner, brand);
        assert.equal(ownedList.observations.length, 3);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM formal_observation")).length, 1);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM formal_checkpoint")).length, 1);
        const progress = ownedList.observations.find((item) => item.id === early.observation.id);
        assert.equal(progress.checkpoints[0].mode, "progress");
        assert.equal(progress.checkpoints[0].conclusion, null);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_checkpoint (
              id, observation_id, brand_id, owner_id, checkpoint, mode, comparable_count, excluded_json,
              conclusion, evaluated_on, created_at
            ) VALUES (?, ?, ?, ?, 'd14', 'progress', 30, '[]', 'formal', '2026-11-22', ?)`,
            [randomUUID(), early.observation.id, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_checkpoint (
              id, observation_id, brand_id, owner_id, checkpoint, mode, comparable_count, excluded_json,
              conclusion, evaluated_on, created_at
            ) VALUES (?, ?, ?, ?, 'd14', 'formal', 24, '[]', NULL, '2026-11-22', ?)`,
            [randomUUID(), baseline.observation.id, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extraBrands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO formal_observation (
            id, brand_id, owner_id, frozen_set_id, effective_on, frozen_non_brand_count, status, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'frozen-core', '2026-10-01', 30, 'observing', ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO formal_checkpoint (
            id, observation_id, brand_id, owner_id, checkpoint, mode, comparable_count, excluded_json,
            conclusion, evaluated_on, created_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 'd14', 'exploratory', 23, ?, ?, '2026-11-22', ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, JSON.stringify(excluded), JSON.stringify({ kind: "exploratory", comparableQuestions: 23, frozenQuestions: 30 }), time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO monitoring_run (
            id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
            repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
            requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
            status, sampling_complete, created_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, ?, 'model_api', 'frozen-core', 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 0, 0, 0, 'queued', 0, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, id, "d".repeat(64), time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO monitoring_slot (
            id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
            repeat_index, reservation_id, status, adopted_attempt_id, late, created_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'q01', 1, ?, 1, 1, NULL, 'queued', NULL, 0, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, id, id, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE formal_observation");
          await db.query("ANALYZE formal_checkpoint");
          await db.query("ANALYZE monitoring_run");
          await db.query("ANALYZE monitoring_slot");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = formalObservationListQuery(owner, brand);
        const pointQuery = formalCheckpointListQuery(owner, [baseline.observation.id]);
        const slotsQuery = formalSavedSlotsQuery(owner, brand, "frozen-core");
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        const pointPlan = JSON.stringify(await queryWithParameters(db, explain + pointQuery.sql, pointQuery.values));
        const slotsPlan = JSON.stringify(await queryWithParameters(db, explain + slotsQuery.sql, slotsQuery.values));
        assert.match(listPlan, /formal_observation_owner_idx/);
        assert.match(pointPlan, /formal_checkpoint_observation_idx/);
        assert.match(slotsPlan, /monitoring_slot_brand_idx|monitoring_slot_reservation_idx|monitoring_run_brand_recent_idx/);
        const scaled = watch(db);
        const scaledList = await listFormalObservations(scaled.connection, owner, brand);
        assert.equal(scaledList.observations.length, 3);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_checkpoint")).length, 1);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_observation")).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${kind}: a verified intervention inside the 14-day baseline blocks a formal conclusion`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const owner = await account(db);
      const outsider = await account(db);
      const cleanOwner = await account(db);
      const zonedOwner = await account(db);
      const brand = randomUUID();
      const otherBrand = randomUUID();
      const brands = new BrandDao(db);
      await brands.insertBrand(owner, brand, time);
      await brands.insertBrand(outsider, otherBrand, time);
      const stamp = "2026-11-10T04:00:00.000Z";
      await queryWithParameters(db, `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'effective', ?, ?, ?)`, [randomUUID(), brand, owner, stamp, time, time]);
      await queryWithParameters(db, `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', NULL, ?, ?)`, [randomUUID(), brand, owner, time, time]);
      await queryWithParameters(db, `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'effective', ?, ?, ?)`, [randomUUID(), otherBrand, outsider, stamp, time, time]);

      const created = await createFormalObservation(db, owner, {
        brandId: brand,
        frozenSetId: "frozen-baseline",
        effectiveOn: "2026-11-17",
        frozenNonBrandCount: 30,
      }, () => "2026-11-26T00:00:00.000Z");
      assert.equal(created.observation.status, "observing");
      assert.equal(created.observation.baseline.compliant, false);
      assert.equal(created.observation.baseline.timeZone, "Asia/Shanghai");
      assert.equal(created.observation.baseline.start, "2026-11-03");
      assert.equal(created.observation.baseline.end, "2026-11-17");
      assert.equal(created.observation.baseline.interventionCount, 1);
      assert.equal(created.observation.baseline.publicationCount, 0);
      assert.equal(created.observation.baseline.rescheduleOn, "2026-11-25");

      await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-baseline", at: "2026-11-10T04:00:00.000Z" });
      await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-baseline", at: "2026-11-20T04:00:00.000Z" });
      const blocked = await recordFormalCheckpoint(
        db,
        owner,
        created.observation.id,
        formalRequest("2026-12-02", 30, []),
        () => "2026-12-02T00:00:00.000Z",
      );
      assert.equal(blocked.checkpoint.mode, "exploratory");
      assert.equal(JSON.parse(blocked.checkpoint.conclusion).kind, "exploratory");
      assert.equal(blocked.checkpoint.evaluation.insufficiencyReasons.includes("baseline_intervention"), true);
      assert.equal(blocked.observation.baseline.compliant, false);
      const stored = await queryWithParameters(
        db,
        `SELECT effective_on AS "effectiveOn", status FROM formal_observation WHERE id = ?`,
        [created.observation.id],
      );
      assert.equal(stored[0].effectiveOn, "2026-11-17");

      const cleanBrand = randomUUID();
      await brands.insertBrand(cleanOwner, cleanBrand, time);
      await queryWithParameters(db, `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'effective', ?, ?, ?)`, [randomUUID(), cleanBrand, cleanOwner, "2026-11-17T07:30:00.000Z", time, time]);
      const clean = await createFormalObservation(db, cleanOwner, {
        brandId: cleanBrand,
        frozenSetId: "frozen-clean",
        effectiveOn: "2026-11-17",
        frozenNonBrandCount: 30,
      }, () => "2026-11-26T01:00:00.000Z");
      assert.equal(clean.observation.baseline.timeZone, "Asia/Shanghai");
      assert.equal(clean.observation.baseline.compliant, true);

      const zonedBrand = randomUUID();
      await brands.insertBrand(zonedOwner, zonedBrand, time);
      await queryWithParameters(db, `INSERT INTO sampling_protocol (
        id, protocol_id, brand_id, owner_id, version, new_session_required, search_required,
        target_region, timezone, status, fingerprint, operation_id, created_at
      ) VALUES (?, ?, ?, ?, 1, 0, 0, 'CN', 'America/Los_Angeles', 'frozen', ?, ?, ?)`, [
        randomUUID(), randomUUID(), zonedBrand, zonedOwner, "c".repeat(64), randomUUID(), time,
      ]);
      await queryWithParameters(db, `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'effective', ?, ?, ?)`, [randomUUID(), zonedBrand, zonedOwner, "2026-11-17T07:30:00.000Z", time, time]);
      const zoned = await createFormalObservation(db, zonedOwner, {
        brandId: zonedBrand,
        frozenSetId: "frozen-zoned",
        effectiveOn: "2026-11-17",
        frozenNonBrandCount: 30,
      }, () => "2026-11-26T02:00:00.000Z");
      assert.equal(zoned.observation.baseline.timeZone, "America/Los_Angeles");
      assert.equal(zoned.observation.baseline.compliant, false);
      assert.equal(zoned.observation.baseline.rescheduleOn, "2026-12-01");

      if (db.kind === "postgresql") {
        await db.query("ANALYZE intervention_batch");
        await db.query("ANALYZE content_publication");
      }
      const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      const interventionQuery = effectiveInterventionQuery(owner, brand);
      const publicationQuery = verifiedPublicationQuery(owner, brand);
      const interventionPlan = JSON.stringify(await queryWithParameters(db, explain + interventionQuery.sql, interventionQuery.values));
      const publicationPlan = JSON.stringify(await queryWithParameters(db, explain + publicationQuery.sql, publicationQuery.values));
      assert.match(interventionQuery.sql, /owner_id = \? AND brand_id = \? AND status = 'effective'/);
      assert.match(publicationQuery.sql, /verified_public/);
      assert.match(publicationQuery.sql, /verified_manual/);
      assert.match(interventionPlan, /intervention_batch_owner_idx|Seq Scan on intervention_batch|SCAN intervention_batch/);
      assert.match(publicationPlan, /content_publication_brand_idx|content_publication_owner_idx|content_publication_operation_uidx|Seq Scan on content_publication|SCAN content_publication/);
    } finally {
      await fixture.cleanup();
    }
  });
}
