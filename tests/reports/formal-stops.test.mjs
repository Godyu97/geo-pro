import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import {
  createFormalObservation,
  readFormalObservation,
  recordFormalCheckpoint,
  stopFormalObservation,
} from "../../src/features/formal-retest/commands.ts";
import {
  formalObservationErrors,
  stopFormalObservationSchema,
} from "../../src/features/formal-retest/contracts.ts";
import {
  formalObservationForOwnerQuery,
  formalObservationListQuery,
} from "../../src/features/formal-retest/dao.ts";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import { stopObservation } from "../../src/features/formal-retest/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const reason = "渠道变化，客户要求停止等待";
const zh = JSON.parse(readFileSync(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));

test("an early stop keeps the named slots and rejects an empty reason", () => {
  assert.equal(formalObservationErrors.OBSERVATION_STOPPED, 409);
  assert.equal(formalObservationErrors.NOT_FOUND, 404);
  assert.equal(formalObservationErrors.INVALID_INPUT, 400);
  assert.equal(stopFormalObservationSchema.safeParse({ reason: "  " }).success, false);
  assert.equal(stopFormalObservationSchema.safeParse({ reason: "", mode: "formal" }).success, false);
  assert.equal(stopFormalObservationSchema.safeParse({ reason }).success, true);
  const rejected = stopObservation({ reason: "   ", slotIds: ["s1", "s2"] });
  assert.equal(rejected.stopped, false);
  if (!rejected.stopped) assert.deepEqual(rejected.retainedSlotIds, ["s1", "s2"]);
  const accepted = stopObservation({ reason, slotIds: ["s2", "s1"] });
  assert.equal(accepted.stopped, true);
  if (accepted.stopped) {
    assert.equal(accepted.reason, reason);
    assert.deepEqual(accepted.retainedSlotIds, ["s2", "s1"]);
  }
  assert.equal(zh.formalObservations.statusStopped, "已停止");
  assert.match(zh.formalObservations.stopHint, /尚未写入的 D\+7、D\+14 和 D\+28 只显示已停止和这条原因/);
  assert.match(zh.formalObservations.OBSERVATION_STOPPED, /不会新增正式结论/);
  assert.equal(en.formalObservations.statusStopped, "Stopped");
  assert.match(en.formalObservations.stopHint, /show only the stopped status and this reason/);
  assert.match(en.formalObservations.stopReasonLine, /\{reason\}/);
  const page = readFileSync(new URL("../../src/features/formal-retest/observations-page.tsx", import.meta.url), "utf8");
  assert.match(page, /stopFormalObservationAction/);
  assert.match(page, /statusStopped/);
  assert.match(page, /unwrittenCheckpoint/);
  assert.match(page, /saveStop/);
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

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Stop owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function seedWindowRun(db, { owner, brand, frozenSetId, at }) {
  const monitoring = new MonitoringDao(db);
  const evidence = new EvidenceDao(db);
  const runId = randomUUID();
  const channelId = randomUUID();
  await monitoring.insertRun({
    id: runId, brandId: brand, ownerId: owner, operationId: randomUUID(),
    fingerprint: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    track: "model_api", promptSetId: frozenSetId, promptSetVersion: 1, repeatCount: 1,
    questionCount: 1, naturalCount: 1, channelCount: 1, slotCount: 1,
    region: "CN", language: "zh-CN", requestedNetworkMode: "off", currency: "CNY",
    upperMinor: 0, estimateHighMinor: 0, createdAt: at,
  });
  const slot = {
    id: randomUUID(), runId, brandId: brand, questionId: "q01",
    natural: 1, channelId, channelVersion: 1, repeatIndex: 1, reservationId: null, createdAt: at,
  };
  await monitoring.insertSlots([slot]);
  await queryWithParameters(
    db,
    `UPDATE monitoring_slot SET status = 'succeeded', adopted_attempt_id = ? WHERE id = ?`,
    [slot.id, slot.id],
  );
  const observationId = randomUUID();
  await evidence.insertObservation({
    id: observationId, brandId: brand, ownerId: owner, slotId: slot.id, attemptId: null,
    sourceMode: "model_api", captureMethod: "isolated", questionText: "Question q01?",
    answerText: "Synthetic answer", fingerprint: "b".repeat(64),
    region: "CN", targetRegion: "CN", observedRegion: "unknown", newSession: "unknown", productMode: "unknown",
    networkTrigger: "not_triggered", language: "zh-CN", requestedNetworkMode: "off", entityVersion: 1,
    citationSetState: "complete", evidenceState: "complete",
    locatorRef: null, collectorId: null, missingReason: null, capturedAt: at, createdAt: at,
  });
  await evidence.insertAnalysis({
    id: randomUUID(), observationId, brandId: brand, version: 1, entityVersion: 1,
    ruleVersion: "rule-v1", mentioned: "true", recommended: "unknown", officialSiteCited: "true",
    evidenceSpan: null, status: "classified", revisedFrom: null, reason: null, reviewerId: null, createdAt: at,
  });
  return slot.id;
}

async function ids(db, table, brandId) {
  const rows = await queryWithParameters(db, `SELECT id FROM ${table} WHERE brand_id = ? ORDER BY id ASC`, [brandId]);
  return rows.map((row) => row.id);
}

async function checkpointRows(db, observationId) {
  return queryWithParameters(
    db,
    `SELECT id, checkpoint, mode, conclusion, evaluation_json AS "evaluationJson"
      FROM formal_checkpoint WHERE observation_id = ? ORDER BY created_at ASC, id ASC`,
    [observationId],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: stopping keeps the exploratory checkpoint and slot ids, then blocks a new formal conclusion`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        await new BrandDao(db).insertBrand(owner, brand, time);
        const created = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-stop",
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 1,
        }, () => "2026-05-01T00:00:00.000Z");
        const observationId = created.observation.id;
        assert.equal(created.observation.status, "observing");
        assert.equal(created.observation.stopReason, null);
        const beforeSlot = await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-stop", at: "2026-09-20T12:00:00.000Z" });
        const afterSlot = await seedWindowRun(db, { owner, brand, frozenSetId: "frozen-stop", at: "2026-10-05T12:00:00.000Z" });
        const exploratory = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d14",
          today: "2026-11-22",
          comparableQuestions: 1,
          excluded: [],
          requestedMode: "formal",
        }, () => "2026-05-02T00:00:00.000Z");
        assert.equal(exploratory.checkpoint.mode, "exploratory");
        assert.deepEqual(exploratory.checkpoint.evaluation.slotIds, [beforeSlot, afterSlot].sort((a, b) => a.localeCompare(b)));
        const beforeCheckpoints = await checkpointRows(db, observationId);
        const beforeSlots = await ids(db, "monitoring_slot", brand);
        const beforeAnswers = await ids(db, "answer_observation", brand);

        const writing = watch(db);
        const stopped = await stopFormalObservation(writing.connection, owner, observationId, {
          reason: `  ${reason}  `,
        }, () => "2026-05-03T00:00:00.000Z");
        assert.equal(stopped.observation.status, "stopped");
        assert.equal(stopped.observation.stopReason, reason);
        assert.equal(stopped.observation.checkpoints.length, 1);
        assert.equal(stopped.observation.checkpoints[0].mode, "exploratory");
        assert.equal(stopped.observation.checkpoints[0].id, exploratory.checkpoint.id);
        assert.deepEqual(stopped.retainedSlotIds, exploratory.checkpoint.evaluation.slotIds);
        assert.deepEqual(stopped.observation.retainedSlotIds, stopped.retainedSlotIds);
        assert.equal(writing.captured.filter((item) => /UPDATE formal_observation/i.test(item.sql)).length, 1);
        assert.equal(writing.captured.some((item) => /DELETE\s+FROM|UPDATE\s+formal_checkpoint|INSERT INTO formal_checkpoint|INSERT INTO monitoring_slot|INSERT INTO answer_observation/i.test(item.sql)), false);
        assert.deepEqual(await checkpointRows(db, observationId), beforeCheckpoints);
        assert.deepEqual(await ids(db, "monitoring_slot", brand), beforeSlots);
        assert.deepEqual(await ids(db, "answer_observation", brand), beforeAnswers);

        const again = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d14",
          today: "2026-11-22",
          comparableQuestions: 1,
          excluded: [],
          requestedMode: "formal",
        }, () => "2026-05-04T00:00:00.000Z");
        assert.deepEqual(again, { error: "OBSERVATION_STOPPED" });
        assert.equal(JSON.stringify(again).includes("formal"), false);
        assert.deepEqual(await checkpointRows(db, observationId), beforeCheckpoints);
        const reread = await readFormalObservation(db, owner, observationId);
        assert.equal(reread.observation.status, "stopped");
        assert.equal(reread.observation.stopReason, reason);
        assert.deepEqual(reread.observation.retainedSlotIds, stopped.retainedSlotIds);
        assert.equal(reread.observation.checkpoints[0].mode, "exploratory");

        const open = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-open",
          effectiveOn: "2026-10-02",
          frozenNonBrandCount: 1,
        }, () => "2026-05-05T00:00:00.000Z");
        const emptyWatch = watch(db);
        const empty = await stopFormalObservation(emptyWatch.connection, owner, open.observation.id, { reason: "   " });
        assert.deepEqual(empty, { error: "INVALID_INPUT" });
        assert.equal(emptyWatch.captured.some((item) => /UPDATE formal_observation/i.test(item.sql)), false);
        const stillOpen = await readFormalObservation(db, owner, open.observation.id);
        assert.equal(stillOpen.observation.status, "observing");
        assert.equal(stillOpen.observation.stopReason, null);

        const deniedRead = await readFormalObservation(db, outsider, observationId);
        assert.deepEqual(deniedRead, { error: "NOT_FOUND" });
        const deniedText = JSON.stringify(deniedRead);
        assert.equal(deniedText.includes(reason), false);
        assert.equal(deniedText.includes(beforeSlot), false);
        assert.equal(deniedText.includes(afterSlot), false);
        const deniedStop = await stopFormalObservation(db, outsider, observationId, { reason: "另一账号的停止原因" });
        assert.deepEqual(deniedStop, { error: "NOT_FOUND" });
        const deniedStopText = JSON.stringify(deniedStop);
        assert.equal(deniedStopText.includes(reason), false);
        assert.equal(deniedStopText.includes("另一账号的停止原因"), false);
        assert.equal(deniedStopText.includes(beforeSlot), false);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE formal_observation SET status = 'stopped', stop_reason = NULL WHERE id = ?`,
            [open.observation.id],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE formal_observation SET stop_reason = ? WHERE id = ?`,
            ["仍在观察", open.observation.id],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE formal_observation SET status = 'stopped', stop_reason = '   ' WHERE id = ?`,
            [open.observation.id],
          ),
          /CHECK|check constraint/i,
        );
        const unchanged = await readFormalObservation(db, owner, open.observation.id);
        assert.equal(unchanged.observation.status, "observing");
        assert.equal(unchanged.observation.stopReason, null);

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
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'frozen-stop', '2026-10-01', 1, 'observing', ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE formal_observation");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = formalObservationForOwnerQuery(owner, observationId);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, db.kind === "postgresql" ? /formal_observation_pkey/ : /sqlite_autoindex_formal_observation_1/);
        const listQuery = formalObservationListQuery(owner, brand);
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        assert.match(listPlan, /formal_observation_owner_idx/);
        const scaled = watch(db);
        const scaledRead = await readFormalObservation(scaled.connection, owner, observationId);
        assert.equal(scaledRead.observation.stopReason, reason);
        assert.deepEqual(scaledRead.observation.retainedSlotIds, stopped.retainedSlotIds);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_observation")).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
