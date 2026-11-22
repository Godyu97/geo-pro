import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { listEntityReviews, recordEntityReviews } from "../../src/features/entity-accuracy/commands.ts";
import {
  entityReviewBodySchema,
  entityReviewErrors,
  entityReviewWriteSchema,
} from "../../src/features/entity-accuracy/contracts.ts";
import { entityReviewListQuery } from "../../src/features/entity-accuracy/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const method = "随机抽检";

test("review writes reject a population rate and keep the insufficient label free of one", async () => {
  assert.equal(entityReviewErrors.INVALID_INPUT, 400);
  assert.equal(entityReviewErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const sample = mark(randomUUID(), randomUUID(), { confirmed: true });
  const body = { method, population: 50, marks: [sample] };
  assert.equal(entityReviewBodySchema.safeParse(body).success, true);
  assert.equal(entityReviewBodySchema.safeParse({ ...body, populationRate: 0.04 }).success, false);
  assert.equal(entityReviewWriteSchema.safeParse({ ...body, brandId, overallErrorRate: 0.04 }).success, false);
  assert.equal(entityReviewWriteSchema.safeParse({
    brandId,
    method,
    population: 50,
    marks: [mark(randomUUID(), randomUUID(), { reviewed: false, confirmed: true })],
  }).success, false);
  assert.equal(entityReviewWriteSchema.safeParse({
    brandId,
    method,
    population: 50,
    marks: [mark(randomUUID(), randomUUID(), { fact: "expired", confirmed: true })],
  }).success, false);
  assert.equal(entityReviewWriteSchema.safeParse({
    brandId,
    method,
    population: 50,
    marks: [mark(randomUUID(), randomUUID(), { fact: "conflict", confirmed: true })],
  }).success, false);
  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  assert.equal(zh.entityReviews.insufficient.includes("%"), false);
  assert.equal(en.entityReviews.insufficient.includes("%"), false);
  assert.equal(zh.entityReviews.sample.includes("%"), false);
  assert.equal(en.entityReviews.coverage.includes("%"), false);
});

function mark(observationId, analysisVersionId, overrides = {}) {
  return {
    observationId,
    analysisVersionId,
    reviewed: true,
    confirmed: false,
    fact: "active",
    ...overrides,
  };
}

function input(brandId, marks, population = 50) {
  return { brandId, method, population, marks };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Entity review owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
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

async function stored(db, brandId) {
  return queryWithParameters(
    db,
    `SELECT id, observation_id AS "observationId", confirmed_error AS "confirmedError", reviewed, fact
     FROM entity_review WHERE brand_id = ? ORDER BY created_at ASC, id ASC`,
    [brandId],
  );
}

function hides(body, ids) {
  const text = JSON.stringify(body);
  assert.equal(text.includes("%"), false);
  assert.equal(text.includes("0.04"), false);
  assert.equal(text.includes("0.2"), false);
  for (const id of ids) assert.equal(text.includes(id), false);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: reviewed errors stay a sample ratio and corrections append`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const probe = randomUUID();
        const brand = randomUUID();
        const brands = new BrandDao(db);
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES (?, ?, 'archived', 1, 1, ?)`,
          [probe, owner, time],
        );
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, randomUUID(), time);
        const clock = clockFrom([
          "2026-11-22T08:00:00.000Z",
          "2026-11-22T08:00:01.000Z",
          "2026-11-22T08:00:02.000Z",
          "2026-11-22T08:00:03.000Z",
        ]);
        const samples = Array.from({ length: 10 }, () => ({ observationId: randomUUID(), analysisVersionId: randomUUID() }));
        const marks = samples.map((sample, index) => mark(sample.observationId, sample.analysisVersionId, { confirmed: index < 2 }));
        const rejectedWatch = watch(db);
        const rejected = await recordEntityReviews(rejectedWatch.connection, owner, input(brand, [
          mark(randomUUID(), randomUUID(), { reviewed: false, confirmed: true }),
        ]), clock);
        assert.equal(rejected.error, "INVALID_INPUT");
        assert.equal(rejectedWatch.captured.some((item) => item.sql.includes("INSERT INTO entity_review")), false);
        assert.deepEqual(await stored(db, brand), []);
        const expired = await recordEntityReviews(db, owner, input(probe, [
          mark(randomUUID(), randomUUID(), { fact: "expired", confirmed: true }),
        ]), clock);
        assert.equal(expired.error, "INVALID_INPUT");
        const conflict = await recordEntityReviews(db, owner, input(probe, [
          mark(randomUUID(), randomUUID(), { fact: "conflict", confirmed: true }),
        ]), clock);
        assert.equal(conflict.error, "INVALID_INPUT");
        assert.deepEqual(await stored(db, probe), []);

        const noted = await recordEntityReviews(db, owner, input(probe, [
          mark(randomUUID(), randomUUID(), { fact: "expired", confirmed: false }),
        ]), clock);
        assert.equal(noted.board.errorLabel, "0/1");
        assert.equal(noted.board.coverage, "1/50");
        assert.equal(noted.board.populationRate, null);
        assert.equal(noted.board.reviews[0].confirmed, false);
        assert.equal((await stored(db, probe))[0].fact, "expired");
        assert.equal((await stored(db, probe))[0].confirmedError, 0);

        const hidden = await recordEntityReviews(db, outsider, input(brand, marks), clock);
        assert.equal(hidden.error, "NOT_FOUND");
        hides(hidden, samples.flatMap((sample) => [sample.observationId, sample.analysisVersionId]));
        assert.deepEqual(await stored(db, brand), []);

        const firstWatch = watch(db);
        const first = await recordEntityReviews(firstWatch.connection, owner, input(brand, marks), clock);
        assert.equal(first.board.errorLabel, "2/10");
        assert.equal(first.board.coverage, "10/50");
        assert.equal(first.board.populationRate, null);
        assert.equal(first.board.label, "sample");
        assert.equal("rate" in first.board, false);
        assert.equal(first.board.reviews.length, 10);
        assert.equal(first.board.reviews.filter((review) => review.confirmed).length, 2);
        assert.equal(JSON.stringify(first.board).includes("%"), false);
        assert.equal(JSON.stringify(first.board).includes("0.04"), false);
        assert.equal(firstWatch.captured.filter((item) => item.sql.includes("INSERT INTO entity_review")).length, 1);
        assert.equal(firstWatch.captured.some((item) => /UPDATE\s+entity_review/i.test(item.sql)), false);
        assert.equal(firstWatch.captured.some((item) => /answer_observation|answer_analysis_version/.test(item.sql)), false);
        const original = first.board.reviews.find((review) => review.confirmed);
        const originalRow = (await stored(db, brand)).find((row) => row.id === original.id);
        assert.equal(originalRow.confirmedError, 1);

        const deniedList = await listEntityReviews(db, outsider, brand);
        hides(deniedList, [
          ...first.board.reviews.map((review) => review.id),
          ...samples.flatMap((sample) => [sample.observationId, sample.analysisVersionId]),
        ]);
        const listWatch = watch(db);
        const listed = await listEntityReviews(listWatch.connection, owner, brand);
        assert.equal(listed.board.errorLabel, "2/10");
        assert.equal(listed.board.coverage, "10/50");
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM entity_review")).length, 1);
        assert.equal(listWatch.captured.some((item) => /count\s*\(/i.test(item.sql)), false);

        const corrected = await recordEntityReviews(db, owner, input(brand, [
          mark(original.observationId, original.analysisVersionId, { confirmed: false }),
        ]), clock);
        assert.equal(corrected.board.errorLabel, "1/10");
        assert.equal(corrected.board.coverage, "10/50");
        assert.equal(corrected.board.populationRate, null);
        const afterCorrection = await stored(db, brand);
        assert.equal(afterCorrection.length, 11);
        assert.equal(afterCorrection.find((row) => row.id === original.id).confirmedError, 1);
        assert.equal(afterCorrection.find((row) => row.id === original.id).reviewed, 1);
        assert.notEqual(corrected.board.reviews.find((review) => review.observationId === original.observationId).id, original.id);

        const cleared = await recordEntityReviews(db, owner, input(brand, samples.map((sample) => mark(
          sample.observationId,
          sample.analysisVersionId,
          { reviewed: false, confirmed: false },
        ))), clock);
        assert.equal(cleared.board.label, "insufficient");
        assert.equal(cleared.board.errorLabel, null);
        assert.equal(cleared.board.coverage, null);
        assert.equal(cleared.board.populationRate, null);
        assert.equal(cleared.board.reviews.length, 0);
        hides(cleared.board, []);
        assert.equal((await stored(db, brand)).length, 21);
        assert.equal((await stored(db, brand)).find((row) => row.id === original.id).confirmedError, 1);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO entity_review (
              id, brand_id, owner_id, observation_id, analysis_version_id, confirmed_error, reviewed,
              population_count, method, fact, created_at
            ) VALUES (?, ?, ?, ?, ?, 1, 1, 50, '手工', 'expired', ?)`,
            [randomUUID(), brand, owner, randomUUID(), randomUUID(), time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO entity_review (
              id, brand_id, owner_id, observation_id, analysis_version_id, confirmed_error, reviewed,
              population_count, method, fact, created_at
            ) VALUES (?, ?, ?, ?, ?, 1, 0, 50, '手工', 'active', ?)`,
            [randomUUID(), brand, owner, randomUUID(), randomUUID(), time],
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
          `INSERT INTO entity_review (
            id, brand_id, owner_id, observation_id, analysis_version_id, confirmed_error, reviewed,
            population_count, method, fact, created_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, ?, 0, 1, 1, '批量', 'active', ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, outsider, id, id, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE entity_review");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = entityReviewListQuery(owner, brand);
        const plan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        assert.match(plan, /entity_review_owner_idx/);
        const observations = await queryWithParameters(db, "SELECT id FROM answer_observation", []);
        const versions = await queryWithParameters(db, "SELECT id FROM answer_analysis_version", []);
        assert.equal(observations.length, 0);
        assert.equal(versions.length, 0);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
