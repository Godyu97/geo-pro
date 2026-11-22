import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
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
import { formalCheckpointListQuery, formalObservationListQuery } from "../../src/features/formal-retest/dao.ts";
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

function formalRequest(today, comparableQuestions, ids = excluded) {
  return {
    checkpoint: "d14",
    today,
    comparableQuestions,
    excluded: ids,
    requestedMode: "formal",
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: an early D+14 stays progress and a short comparable set stays exploratory`, async () => {
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
        ]);

        const hidden = await createFormalObservation(db, outsider, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-11-22",
          frozenNonBrandCount: 30,
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("frozen-core"), false);

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

        const baseline = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-core",
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 30,
        }, clock);
        const exploratory = await recordFormalCheckpoint(
          db,
          owner,
          baseline.observation.id,
          formalRequest("2026-11-22", 23),
          clock,
        );
        assert.equal(exploratory.checkpoint.mode, "exploratory");
        assert.equal(exploratory.checkpoint.conclusion.includes("formal"), false);
        assert.deepEqual(exploratory.checkpoint.excluded, excluded);
        assert.equal(exploratory.observation.status, "checkpoint_due");
        const storedExcluded = await queryWithParameters(
          db,
          `SELECT excluded_json AS "excludedJson", mode, conclusion FROM formal_checkpoint WHERE id = ?`,
          [exploratory.checkpoint.id],
        );
        assert.deepEqual(JSON.parse(storedExcluded[0].excludedJson), excluded);
        assert.equal(storedExcluded[0].mode, "exploratory");

        const formal = await recordFormalCheckpoint(
          db,
          owner,
          baseline.observation.id,
          formalRequest("2026-11-22", 24, []),
          clock,
        );
        assert.equal(formal.checkpoint.mode, "formal");
        assert.notEqual(formal.checkpoint.conclusion, null);
        assert.equal(formal.observation.checkpoints.length, 2);
        const previous = formal.observation.checkpoints.find((item) => item.id === exploratory.checkpoint.id);
        assert.equal(previous.mode, "exploratory");
        assert.deepEqual(previous.excluded, excluded);
        const rows = await queryWithParameters(
          db,
          `SELECT id, mode FROM formal_checkpoint WHERE observation_id = ? ORDER BY created_at ASC, id ASC`,
          [baseline.observation.id],
        );
        assert.deepEqual(rows.map((row) => row.mode), ["exploratory", "formal"]);

        const outsiderList = await listFormalObservations(db, outsider, brand);
        assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderList).includes("q24"), false);
        const listWatch = watch(db);
        const ownedList = await listFormalObservations(listWatch.connection, owner, brand);
        assert.equal(ownedList.observations.length, 2);
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
        if (db.kind === "postgresql") {
          await db.query("ANALYZE formal_observation");
          await db.query("ANALYZE formal_checkpoint");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = formalObservationListQuery(owner, brand);
        const pointQuery = formalCheckpointListQuery(owner, [baseline.observation.id]);
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        const pointPlan = JSON.stringify(await queryWithParameters(db, explain + pointQuery.sql, pointQuery.values));
        assert.match(listPlan, /formal_observation_owner_idx/);
        assert.match(pointPlan, /formal_checkpoint_observation_idx/);
        const scaled = watch(db);
        const scaledList = await listFormalObservations(scaled.connection, owner, brand);
        assert.equal(scaledList.observations.length, 2);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_checkpoint")).length, 1);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_observation")).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
