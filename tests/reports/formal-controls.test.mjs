import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  createFormalObservation,
  listFormalControls,
  listFormalObservations,
  recordFormalCheckpoint,
  registerFormalControl,
} from "../../src/features/formal-retest/commands.ts";
import {
  formalObservationErrors,
  registerFormalControlSchema,
} from "../../src/features/formal-retest/contracts.ts";
import { formalControlListQuery } from "../../src/features/formal-retest/dao.ts";
import { registerControlPage } from "../../src/features/formal-retest/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const pageKey = "https://example.invalid/unchanged-control";
const zh = JSON.parse(readFileSync(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));

test("control registration stays observational and closes after any checkpoint", () => {
  assert.equal(formalObservationErrors.CHECKPOINT_EXISTS, 409);
  assert.equal(formalObservationErrors.NOT_FOUND, 404);
  assert.equal(zh.formalObservations.controlsHeading, "观察对照");
  assert.match(zh.formalObservations.controlsHint, /不是因果试验/);
  assert.match(en.formalObservations.controlsHint, /not a causal experiment/i);
  assert.match(en.formalObservations.controlsHeading, /control/i);
  const closed = registerControlPage({ label: "observation", checkpointCount: 1, checkpointMode: "exploratory" });
  assert.equal(closed.accepted, false);
  assert.equal(closed.reason, "checkpoint");
  assert.equal(closed.checkpointMode, "exploratory");
  const causal = registerControlPage({ label: "causal", checkpointCount: 0, checkpointMode: null });
  assert.equal(causal.accepted, false);
  assert.equal(causal.reason, "label");
  assert.equal(causal.checkpointMode, null);
  const open = registerControlPage({ label: "observation", checkpointCount: 0, checkpointMode: null });
  assert.equal(open.accepted, true);
  assert.equal(open.label, "observation");
  assert.equal(open.checkpointMode, null);
  assert.equal(registerFormalControlSchema.safeParse({ pageKey, label: "causal" }).success, false);
  assert.equal(registerFormalControlSchema.safeParse({ pageKey, label: "observation", mode: "formal" }).success, false);
  assert.equal(registerFormalControlSchema.safeParse({ pageKey: "  /pricing  ", label: "observation" }).success, true);
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
    [id, "Control owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function checkpointBytes(db, observationId) {
  const rows = await queryWithParameters(
    db,
    `SELECT checkpoint, mode, conclusion FROM formal_checkpoint
      WHERE observation_id = ? ORDER BY created_at ASC, id ASC`,
    [observationId],
  );
  return rows.map((row) => ({ checkpoint: row.checkpoint, mode: row.mode, conclusion: row.conclusion }));
}

async function controlRows(db, observationId) {
  return queryWithParameters(
    db,
    `SELECT id, label, page_key AS "pageKey" FROM formal_control_page
      WHERE observation_id = ? ORDER BY registered_at ASC, id ASC`,
    [observationId],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a control page is registered once, then a checkpoint blocks another row`, async () => {
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
          frozenSetId: "frozen-core",
          effectiveOn: "2026-10-01",
          frozenNonBrandCount: 30,
        }, () => "2026-05-01T00:00:00.000Z");
        const observationId = created.observation.id;

        const writing = watch(db);
        const registered = await registerFormalControl(writing.connection, owner, observationId, {
          pageKey: `  ${pageKey}  `,
          label: "observation",
        }, () => "2026-05-02T00:00:00.000Z");
        assert.equal(writing.captured.some((item) => /UPDATE\s+formal_checkpoint|UPDATE\s+formal_observation|INSERT INTO formal_checkpoint/i.test(item.sql)), false);
        assert.equal(writing.captured.filter((item) => item.sql.includes("INSERT INTO formal_control_page")).length, 1);
        assert.equal(registered.controls.length, 1);
        assert.equal(registered.controls[0].label, "observation");
        assert.equal(registered.controls[0].pageKey, pageKey);

        const again = await registerFormalControl(db, owner, observationId, {
          pageKey,
          label: "observation",
        }, () => "2026-05-03T00:00:00.000Z");
        assert.equal(again.controls.length, 1);
        assert.equal(again.controls[0].id, registered.controls[0].id);
        assert.deepEqual((await controlRows(db, observationId)).map((row) => ({
          id: row.id,
          label: row.label,
          pageKey: row.pageKey,
        })), [{
          id: registered.controls[0].id,
          label: "observation",
          pageKey,
        }]);

        const progress = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d7",
          today: "2026-10-01",
          comparableQuestions: 30,
          excluded: [],
          requestedMode: "formal",
        }, () => "2026-05-04T00:00:00.000Z");
        assert.equal(progress.checkpoint.mode, "progress");
        assert.equal(progress.checkpoint.conclusion, null);
        assert.equal(progress.observation.controls.length, 1);
        assert.equal(progress.observation.controls[0].label, "observation");
        const beforeBytes = await checkpointBytes(db, observationId);

        const blockedWatch = watch(db);
        const blocked = await registerFormalControl(blockedWatch.connection, owner, observationId, {
          pageKey: "https://example.invalid/late-control",
          label: "observation",
        }, () => "2026-05-05T00:00:00.000Z");
        assert.deepEqual(blocked, { error: "CHECKPOINT_EXISTS" });
        assert.equal(blockedWatch.captured.some((item) => /INSERT INTO formal_control_page|UPDATE\s+formal_/i.test(item.sql)), false);
        assert.equal((await controlRows(db, observationId)).length, 1);
        assert.deepEqual(await checkpointBytes(db, observationId), beforeBytes);

        const exploratory = await recordFormalCheckpoint(db, owner, observationId, {
          checkpoint: "d14",
          today: "2026-11-22",
          comparableQuestions: 23,
          excluded: ["q24"],
          requestedMode: "formal",
        }, () => "2026-05-06T00:00:00.000Z");
        assert.equal(exploratory.checkpoint.mode, "exploratory");
        assert.equal(exploratory.checkpoint.conclusion.includes("exploratory"), true);
        assert.equal(exploratory.observation.checkpoints[0].mode, "progress");
        assert.equal(exploratory.observation.controls[0].label, "observation");
        const afterExploratory = await checkpointBytes(db, observationId);
        const stillBlocked = await registerFormalControl(db, owner, observationId, {
          pageKey: "https://example.invalid/after-exploratory",
          label: "observation",
        });
        assert.deepEqual(stillBlocked, { error: "CHECKPOINT_EXISTS" });
        assert.equal((await controlRows(db, observationId)).length, 1);
        assert.deepEqual(await checkpointBytes(db, observationId), afterExploratory);

        const causalWatch = watch(db);
        const causal = await registerFormalControl(causalWatch.connection, owner, observationId, {
          pageKey: "https://example.invalid/causal-page",
          label: "causal",
        });
        assert.deepEqual(causal, { error: "INVALID_INPUT" });
        assert.equal(JSON.stringify(causal).includes("causal-page"), false);
        assert.equal(causalWatch.captured.some((item) => /INSERT INTO formal_control_page/i.test(item.sql)), false);
        const storedCausal = await queryWithParameters(
          db,
          "SELECT id FROM formal_control_page WHERE page_key LIKE ?",
          ["%causal%"],
        );
        assert.equal(storedCausal.length, 0);

        const fresh = await createFormalObservation(db, owner, {
          brandId: brand,
          frozenSetId: "frozen-open",
          effectiveOn: "2026-10-02",
          frozenNonBrandCount: 30,
        }, () => "2026-05-07T00:00:00.000Z");
        const rejectedLabel = await registerFormalControl(db, owner, fresh.observation.id, {
          pageKey: "https://example.invalid/causal-only",
          label: "causal",
        });
        assert.deepEqual(rejectedLabel, { error: "INVALID_INPUT" });
        assert.equal((await controlRows(db, fresh.observation.id)).length, 0);

        const listed = await listFormalControls(db, owner, observationId);
        assert.equal(listed.controls.length, 1);
        assert.equal(listed.controls[0].label, "observation");
        assert.equal(listed.controls[0].pageKey, pageKey);
        const denied = await listFormalControls(db, outsider, observationId);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes(pageKey), false);
        const deniedWrite = await registerFormalControl(db, outsider, observationId, {
          pageKey,
          label: "observation",
        });
        assert.deepEqual(deniedWrite, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedWrite).includes(pageKey), false);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_control_page (
              id, observation_id, brand_id, owner_id, page_key, label, registered_at
            ) VALUES (?, ?, ?, ?, 'https://example.invalid/db-causal', 'causal', ?)`,
            [randomUUID(), fresh.observation.id, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO formal_control_page (
              id, observation_id, brand_id, owner_id, page_key, label, registered_at
            ) VALUES (?, ?, ?, ?, '   ', 'observation', ?)`,
            [randomUUID(), fresh.observation.id, brand, owner, time],
          ),
          /CHECK|check constraint/i,
        );
        assert.equal((await controlRows(db, fresh.observation.id)).length, 0);

        const listWatch = watch(db);
        const ownedList = await listFormalObservations(listWatch.connection, owner, brand);
        const saved = ownedList.observations.find((item) => item.id === observationId);
        assert.equal(saved.controls.length, 1);
        assert.equal(saved.controls[0].label, "observation");
        assert.equal(saved.checkpoints.map((item) => item.mode).join(","), "progress,exploratory");
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM formal_control_page")).length, 1);

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
          `INSERT INTO formal_control_page (
            id, observation_id, brand_id, owner_id, page_key, label, registered_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 'https://example.invalid/scaled', 'observation', ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE formal_control_page");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const planQuery = formalControlListQuery(owner, [observationId]);
        const plan = JSON.stringify(await queryWithParameters(db, explain + planQuery.sql, planQuery.values));
        assert.match(plan, /formal_control_page_observation_idx/);
        const scaled = watch(db);
        const scaledList = await listFormalControls(scaled.connection, owner, observationId);
        assert.equal(scaledList.controls.length, 1);
        assert.equal(scaledList.controls[0].pageKey, pageKey);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM formal_control_page")).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
