import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import {
  appendFormalConfounder,
  listFormalConfounders,
  listFormalObservations,
  recordFormalCheckpoint,
  createFormalObservation,
} from "../../src/features/formal-retest/commands.ts";
import {
  appendFormalConfounderSchema,
  formalObservationErrors,
} from "../../src/features/formal-retest/contracts.ts";
import { formalConfounderListQuery } from "../../src/features/formal-retest/dao.ts";
import { recordConfounders } from "../../src/features/formal-retest/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const secret = "阈值秘密说明";

test("confounder factors stay within model, marketing, and price and never change the threshold", () => {
  assert.equal(formalObservationErrors.THRESHOLD_REJECTED, 409);
  assert.equal(formalObservationErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/reports/observations"), "/dashboard/reports/observations");
  const legacy = recordConfounders({ factors: ["价格调整"], thresholdPp: 10 });
  assert.equal(legacy.thresholdChanged, false);
  assert.equal(legacy.accepted, false);
  assert.equal(legacy.thresholdPp, 10);
  const accepted = recordConfounders({ factors: ["model", "marketing", "price"], thresholdPp: 10 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.thresholdChanged, false);
  assert.deepEqual(accepted.factors, ["model", "marketing", "price"]);
  assert.equal(appendFormalConfounderSchema.safeParse({ factor: "model", note: "  " }).success, false);
  assert.equal(appendFormalConfounderSchema.safeParse({ factor: "price", note: "调价", thresholdPp: 8 }).success, false);
  assert.equal(appendFormalConfounderSchema.safeParse({ factor: "price", note: "调价", conclusion: "已提升" }).success, false);
  assert.equal(appendFormalConfounderSchema.safeParse({ factor: "marketing", note: " 渠道增加 " }).success, true);
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
    [id, "Confounder owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function checkpointBytes(db, observationId) {
  const rows = await queryWithParameters(
    db,
    `SELECT mode, conclusion FROM formal_checkpoint
      WHERE observation_id = ? ORDER BY created_at ASC, id ASC`,
    [observationId],
  );
  return rows.map((row) => ({ mode: row.mode, conclusion: row.conclusion }));
}

async function observationStamp(db, observationId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT status, updated_at AS "updatedAt" FROM formal_observation WHERE id = ?`,
    [observationId],
  );
  return row;
}

async function seedFormalSamples(db, owner, brand, frozenSetId) {
  const monitoring = new MonitoringDao(db);
  const evidence = new EvidenceDao(db);
  const channelId = randomUUID();
  for (const [windowIndex, at] of ["2026-09-20T12:00:00.000Z", "2026-10-05T12:00:00.000Z"].entries()) {
    const runId = randomUUID();
    await monitoring.insertRun({
      id: runId, brandId: brand, ownerId: owner, operationId: randomUUID(),
      fingerprint: String(windowIndex).repeat(64), track: "model_api",
      promptSetId: frozenSetId, promptSetVersion: 1, repeatCount: 1,
      questionCount: 30, naturalCount: 30, channelCount: 1, slotCount: 30,
      region: "CN", language: "zh-CN", requestedNetworkMode: "off", currency: "CNY",
      upperMinor: 0, estimateHighMinor: 0, createdAt: at,
    });
    const slots = Array.from({ length: 30 }, (_, index) => ({
      id: randomUUID(), runId, brandId: brand, questionId: `q${String(index + 1).padStart(2, "0")}`,
      natural: 1, channelId, channelVersion: 1, repeatIndex: 1, reservationId: null, createdAt: at,
    }));
    await monitoring.insertSlots(slots);
    await queryWithParameters(
      db,
      `UPDATE monitoring_slot SET status = 'succeeded', adopted_attempt_id = id WHERE run_id = ?`,
      [runId],
    );
    for (const slot of slots) {
      const obsId = randomUUID();
      await evidence.insertObservation({
        id: obsId, brandId: brand, ownerId: owner, slotId: slot.id, attemptId: null,
        sourceMode: "model_api", captureMethod: "isolated", questionText: `Question ${slot.questionId}?`,
        answerText: "Synthetic answer", fingerprint: "a".repeat(64),
        region: "CN", targetRegion: "CN", observedRegion: "unknown", newSession: "unknown", productMode: "unknown",
        networkTrigger: "not_triggered", language: "zh-CN", requestedNetworkMode: "off", entityVersion: 1,
        citationSetState: "complete", evidenceState: "complete",
        locatorRef: null, collectorId: null, missingReason: null, capturedAt: at, createdAt: at,
      });
      await evidence.insertAnalysis({
        id: randomUUID(), observationId: obsId, brandId: brand, version: 1, entityVersion: 1,
        ruleVersion: "rule-v1", mentioned: "true", recommended: "false", officialSiteCited: "true",
        evidenceSpan: null, status: "classified", revisedFrom: null, reason: null, reviewerId: null, createdAt: at,
      });
    }
  }
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: confounders append in a stable order without rewriting checkpoints or thresholds`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        await new BrandDao(db).insertBrand(owner, brand, time);
        await seedFormalSamples(db, owner, brand, "frozen-core");
        const created = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 30,
        }, () => "2026-05-01T00:00:00.000Z");
        const observationId = created.observation.id;
        const progress = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d7",
          today: "2026-10-01",
          comparableQuestions: 30,
          excluded: [],
          requestedMode: "formal",
        }, () => "2026-05-02T00:00:00.000Z");
        assert.equal(progress.checkpoint.mode, "progress");
        assert.equal(progress.checkpoint.conclusion, null);
        const formal = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d14",
          today: "2026-11-22",
          comparableQuestions: 24,
          excluded: [],
          requestedMode: "formal",
        }, () => "2026-05-03T00:00:00.000Z");
        assert.equal(formal.checkpoint.mode, "formal");
        assert.equal(formal.checkpoint.conclusion.includes("formal"), true);
        const beforeBytes = await checkpointBytes(db, observationId);
        const beforeObservation = await observationStamp(db, observationId);

        const notes = {
          price: "价格表已调整",
          model: "采样模型从 A 换到 B",
          marketing: "投放渠道增加了搜索",
        };
        const writing = watch(db);
        const price = await appendFormalConfounder(writing.connection, owner, observationId, {
          factor: "price",
          note: notes.price,
        }, clockFrom(["2026-03-03T00:00:00.000Z"]));
        const model = await appendFormalConfounder(writing.connection, owner, observationId, {
          factor: "model",
          note: `  ${notes.model}  `,
        }, clockFrom(["2026-01-01T00:00:00.000Z"]));
        const marketing = await appendFormalConfounder(writing.connection, owner, observationId, {
          factor: "marketing",
          note: notes.marketing,
        }, clockFrom(["2026-02-02T00:00:00.000Z"]));
        assert.equal(writing.captured.some((item) => /UPDATE\s+formal_checkpoint|UPDATE\s+formal_observation|INSERT INTO formal_checkpoint/i.test(item.sql)), false);
        assert.equal(writing.captured.filter((item) => item.sql.includes("INSERT INTO formal_confounder")).length, 3);
        assert.equal(price.confounders.at(-1).factor, "price");
        assert.deepEqual(model.confounders.map((item) => item.factor), ["model", "price"]);
        assert.deepEqual(marketing.confounders.map((item) => item.factor), ["model", "marketing", "price"]);
        assert.equal(marketing.confounders[0].note, notes.model);

        const sameClock = () => "2026-04-04T00:00:00.000Z";
        await appendFormalConfounder(db, owner, observationId, { factor: "model", note: "第二次模型说明" }, sameClock);
        await appendFormalConfounder(db, owner, observationId, { factor: "marketing", note: "第二次营销说明" }, sameClock);
        const listed = await listFormalConfounders(db, owner, observationId);
        const again = await listFormalConfounders(db, owner, observationId);
        assert.deepEqual(listed, again);
        assert.deepEqual(listed.confounders.slice(0, 3).map((item) => item.factor), ["model", "marketing", "price"]);
        assert.deepEqual(listed.confounders.slice(0, 3).map((item) => item.note), [notes.model, notes.marketing, notes.price]);
        assert.deepEqual(listed.confounders.map((item) => item.recordedAt), ["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z", "2026-03-03T00:00:00.000Z", "2026-04-04T00:00:00.000Z", "2026-04-04T00:00:00.000Z"]);
        assert.ok(listed.confounders[3].id < listed.confounders[4].id);
        assert.deepEqual(await checkpointBytes(db, observationId), beforeBytes);
        assert.deepEqual(await observationStamp(db, observationId), beforeObservation);

        const thresholdWatch = watch(db);
        const rejected = await appendFormalConfounder(thresholdWatch.connection, owner, observationId, {
          factor: "model",
          note: secret,
          thresholdPp: 12,
        });
        assert.deepEqual(rejected, { error: "THRESHOLD_REJECTED" });
        assert.equal(JSON.stringify(rejected).includes(secret), false);
        const namedThreshold = await appendFormalConfounder(thresholdWatch.connection, owner, observationId, {
          factor: "price",
          note: secret,
          threshold: 4,
        });
        assert.deepEqual(namedThreshold, { error: "THRESHOLD_REJECTED" });
        assert.equal(thresholdWatch.captured.some((item) => /INSERT INTO formal_|UPDATE\s+formal_/i.test(item.sql)), false);
        assert.deepEqual(await checkpointBytes(db, observationId), beforeBytes);
        const storedSecret = await queryWithParameters(db, "SELECT id FROM formal_confounder WHERE note = ?", [secret]);
        assert.equal(storedSecret.length, 0);

        const invalid = await appendFormalConfounder(db, owner, observationId, { factor: "价格调整", note: "不应写入" });
        assert.deepEqual(invalid, { error: "INVALID_INPUT" });
        const blank = await appendFormalConfounder(db, owner, observationId, { factor: "model", note: "   " });
        assert.deepEqual(blank, { error: "INVALID_INPUT" });
        const conclusion = await appendFormalConfounder(db, owner, observationId, {
          factor: "model",
          note: "不应改结论",
          conclusion: "品牌已提升",
        });
        assert.deepEqual(conclusion, { error: "INVALID_INPUT" });
        assert.deepEqual(await checkpointBytes(db, observationId), beforeBytes);

        const denied = await listFormalConfounders(db, outsider, observationId);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes(notes.price), false);
        const deniedWrite = await appendFormalConfounder(db, outsider, observationId, {
          factor: "price",
          note: secret,
          thresholdPp: 9,
        });
        assert.deepEqual(deniedWrite, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedWrite).includes(secret), false);
        assert.equal(JSON.stringify(deniedWrite).includes(notes.price), false);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_confounder (
              id, observation_id, brand_id, owner_id, factor, note, recorded_at
            ) VALUES (?, ?, ?, ?, 'brand', '其他变化', ?)`,
            [randomUUID(), observationId, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_confounder (
              id, observation_id, brand_id, owner_id, factor, note, recorded_at
            ) VALUES (?, ?, ?, ?, 'model', ' ', ?)`,
            [randomUUID(), observationId, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );

        const listWatch = watch(db);
        const ownedList = await listFormalObservations(listWatch.connection, owner, brand);
        assert.equal(ownedList.observations.length, 1);
        assert.deepEqual(ownedList.observations[0].confounders.map((item) => item.factor).slice(0, 3), ["model", "marketing", "price"]);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM formal_confounder")).length, 1);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM formal_checkpoint")).length, 1);

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
          `INSERT INTO formal_confounder (
            id, observation_id, brand_id, owner_id, factor, note, recorded_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 'model', '规模说明', ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE formal_confounder");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const planQuery = formalConfounderListQuery(owner, [observationId]);
        const plan = JSON.stringify(await queryWithParameters(db, explain + planQuery.sql, planQuery.values));
        assert.match(plan, /formal_confounder_observation_idx/);
        const scaled = watch(db);
        const scaledList = await listFormalConfounders(scaled.connection, owner, observationId);
        assert.equal(scaledList.confounders.length, 5);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_confounder")).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
