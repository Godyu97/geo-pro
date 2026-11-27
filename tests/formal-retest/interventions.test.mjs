import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  createInterventionBatch,
  getInterventionBatch,
  listInterventionBatches,
  registerInterventionPage,
} from "../../src/features/formal-retest/intervention-commands.ts";
import {
  createInterventionBatchSchema,
  interventionBatchErrors,
  registerInterventionPageSchema,
} from "../../src/features/formal-retest/intervention-contracts.ts";
import {
  interventionBatchListQuery,
  interventionBatchPageListQuery,
} from "../../src/features/formal-retest/intervention-dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const t1 = "2026-11-01T00:00:00.000Z";
const t2 = "2026-11-02T08:30:00.000Z";
const t3 = "2026-11-03T00:00:00.000Z";
const keyA = "https://owner.example/secret-page-a";
const keyB = "https://owner.example/secret-page-b";
const keyC = "https://owner.example/secret-page-c";

test("intervention input rejects a planned date and keeps an empty verification", () => {
  assert.equal(interventionBatchErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  assert.equal(createInterventionBatchSchema.safeParse({
    brandId,
    effectiveAt: t3,
    effectiveOn: "2026-11-22",
  }).success, false);
  assert.equal(createInterventionBatchSchema.safeParse({ brandId }).success, true);
  assert.equal(registerInterventionPageSchema.safeParse({
    pageKey: ` ${keyA} `,
    verifiedAt: t3,
    plannedOn: "2026-12-01",
  }).success, false);
  assert.equal(registerInterventionPageSchema.safeParse({
    pageKey: keyA,
    verifiedAt: "2026-11-03",
  }).success, false);
  const parsed = registerInterventionPageSchema.safeParse({ pageKey: ` ${keyA} `, verifiedAt: null });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.pageKey, keyA);
  assert.equal(parsed.data.verifiedAt, null);
});

test("intervention copy states that a missing verification leaves the batch ineffective", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.interventionBatches.description, /未生效/);
  assert.match(zhCN.interventionBatches.description, /不抓取/);
  assert.match(zhCN.interventionBatches.pendingLine, /为空/);
  assert.match(en.interventionBatches.description, /ineffective/i);
  assert.match(en.interventionBatches.description, /does not fetch/i);
  assert.equal(zhCN.interventionBatches.effectiveLine.includes("{time}"), true);
  assert.equal(en.interventionBatches.effectiveLine.includes("{time}"), true);
  assert.equal(zhCN.reports.openInterventions.length > 0, true);
  assert.equal(en.reports.openInterventions.length > 0, true);
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

function isSelect(sql, table) {
  return /^\s*select/i.test(sql) && new RegExp(`\\b${table}\\b`, "i").test(sql);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Intervention owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function pageCount(db, batchId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT COUNT(*) AS "count" FROM intervention_batch_page WHERE batch_id = ?`,
    [batchId],
  );
  return Number(row.count);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: the latest verification is the effective point and a missing page keeps the batch pending`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const defined = JSON.stringify(await structure(db));
        assert.match(defined, /intervention_batch_owner_idx/);
        assert.match(defined, /intervention_batch_page_key_uidx/);
        assert.match(defined, /intervention_batch_state_check/);
        assert.match(defined, /intervention_batch_page_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /intervention_batch_page_batch_fk/);
        else assert.match(defined, /FOREIGN KEY \(`batch_id`\) REFERENCES `intervention_batch`/);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom([
          "2026-11-22T08:00:00.000Z",
          "2026-11-22T08:01:00.000Z",
          "2026-11-22T08:02:00.000Z",
          "2026-11-22T08:03:00.000Z",
          "2026-11-22T08:04:00.000Z",
          "2026-11-22T08:05:00.000Z",
          "2026-11-22T08:06:00.000Z",
          "2026-11-22T08:07:00.000Z",
          "2026-11-22T08:08:00.000Z",
        ]);

        const hidden = await createInterventionBatch(db, outsider, { brandId: brand }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("secret-page"), false);

        const createWatch = watch(db);
        const created = await createInterventionBatch(createWatch.connection, owner, { brandId: brand }, clock);
        assert.equal(created.batch.status, "pending");
        assert.equal(created.batch.effectiveAt, null);
        assert.deepEqual(created.batch.pages, []);
        assert.equal(createWatch.captured.some((item) => /formal_observation|formal_checkpoint/.test(item.sql)), false);
        const inserted = createWatch.captured.find((item) => /insert into intervention_batch\b/i.test(item.sql));
        assert.equal(inserted.values[3], "pending");
        assert.equal(inserted.values[4], null);

        const empty = await createInterventionBatch(db, owner, { brandId: brand }, clock);
        assert.equal(empty.batch.status, "pending");
        assert.equal(empty.batch.effectiveAt, null);
        assert.equal(empty.batch.pages.length, 0);
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE intervention_batch SET status = 'effective', effective_at = NULL, updated_at = ? WHERE id = ?`,
            [time, empty.batch.id],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE intervention_batch SET status = 'pending', effective_at = ?, updated_at = ? WHERE id = ?`,
            ["2026-12-01T00:00:00.000Z", time, empty.batch.id],
          ),
          /CHECK|check constraint/i,
        );
        const stillEmpty = await getInterventionBatch(db, owner, empty.batch.id);
        assert.equal(stillEmpty.batch.status, "pending");
        assert.equal(stillEmpty.batch.effectiveAt, null);

        const first = await registerInterventionPage(db, owner, created.batch.id, { pageKey: keyB, verifiedAt: t2 }, clock);
        assert.equal(first.batch.status, "effective");
        assert.equal(first.batch.effectiveAt, t2);
        assert.equal(first.batch.pages.length, 1);
        const pageId = first.batch.pages[0].id;
        const updated = await registerInterventionPage(db, owner, created.batch.id, { pageKey: keyB, verifiedAt: t3 }, clock);
        assert.equal(updated.batch.pages.length, 1);
        assert.equal(updated.batch.pages[0].id, pageId);
        assert.equal(updated.batch.effectiveAt, t3);
        assert.equal(await pageCount(db, created.batch.id), 1);

        const earlier = await registerInterventionPage(db, owner, created.batch.id, { pageKey: keyC, verifiedAt: t1 }, clock);
        assert.equal(earlier.batch.effectiveAt, t3);
        assert.notEqual(earlier.batch.effectiveAt, earlier.batch.updatedAt);

        const third = watch(db);
        const complete = await registerInterventionPage(
          third.connection,
          owner,
          created.batch.id,
          { pageKey: keyA, verifiedAt: t2 },
          clock,
        );
        assert.equal(complete.batch.status, "effective");
        assert.equal(complete.batch.effectiveAt, t3);
        assert.notEqual(complete.batch.effectiveAt, complete.batch.updatedAt);
        assert.equal(complete.batch.pages.length, 3);
        assert.deepEqual(
          complete.batch.pages.map((page) => page.verifiedAt).sort(),
          [t1, t2, t3].sort(),
        );
        const pageSelects = third.captured.filter((item) => isSelect(item.sql, "intervention_batch_page"));
        assert.equal(pageSelects.length, 1);
        assert.deepEqual(pageSelects[0].values, [created.batch.id, owner]);
        const updates = third.captured.filter((item) => /^\s*update\s+intervention_batch\b/i.test(item.sql));
        assert.equal(updates.length, 1);
        assert.equal(updates[0].values[0], "effective");
        assert.equal(updates[0].values[1], t3);
        assert.equal(third.captured.some((item) => /formal_observation|formal_checkpoint/.test(item.sql)), false);
        const stored = await queryWithParameters(
          db,
          `SELECT status, effective_at AS "effectiveAt" FROM intervention_batch WHERE id = ?`,
          [created.batch.id],
        );
        assert.equal(stored[0].status, "effective");
        assert.equal(stored[0].effectiveAt, t3);

        const cleared = await registerInterventionPage(
          db,
          owner,
          created.batch.id,
          { pageKey: keyC, verifiedAt: null },
          clock,
        );
        assert.equal(cleared.batch.status, "pending");
        assert.equal(cleared.batch.effectiveAt, null);
        assert.equal(cleared.batch.pages.length, 3);
        assert.equal(cleared.batch.pages.some((page) => page.verifiedAt === null), true);
        const clearedRow = await queryWithParameters(
          db,
          `SELECT status, effective_at AS "effectiveAt" FROM intervention_batch WHERE id = ?`,
          [created.batch.id],
        );
        assert.equal(clearedRow[0].status, "pending");
        assert.equal(clearedRow[0].effectiveAt, null);

        const restored = await registerInterventionPage(
          db,
          owner,
          created.batch.id,
          { pageKey: keyC, verifiedAt: t1 },
          clock,
        );
        assert.equal(restored.batch.status, "effective");
        assert.equal(restored.batch.effectiveAt, t3);

        const beforeSneak = await pageCount(db, created.batch.id);
        const sneak = watch(db);
        const sneaked = await registerInterventionPage(
          sneak.connection,
          outsider,
          created.batch.id,
          { pageKey: keyA, verifiedAt: t1 },
          clock,
        );
        assert.deepEqual(sneaked, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(sneaked).includes("secret-page"), false);
        assert.equal(sneak.captured.some((item) => JSON.stringify(item.values ?? []).includes("secret-page")), false);
        assert.equal(sneak.captured.some((item) => /\bintervention_batch_page\b/i.test(item.sql)), false);
        assert.equal(await pageCount(db, created.batch.id), beforeSneak);

        const deniedWatch = watch(db);
        const denied = await getInterventionBatch(deniedWatch.connection, outsider, created.batch.id);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes("secret-page"), false);
        assert.equal(JSON.stringify(denied).includes(t3), false);
        assert.equal(deniedWatch.captured.some((item) => /\bintervention_batch_page\b/i.test(item.sql)), false);

        const listWatch = watch(db);
        const listed = await listInterventionBatches(listWatch.connection, owner, brand);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "intervention_batch_page")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "intervention_batch")).length, 1);
        const visible = listed.batches.find((batch) => batch.id === created.batch.id);
        assert.equal(visible.pages.length, 3);
        assert.equal(visible.effectiveAt, t3);
        assert.equal(listed.batches.find((batch) => batch.id === empty.batch.id).status, "pending");
        const listValues = listWatch.captured.find((item) => isSelect(item.sql, "intervention_batch_page")).values;
        assert.equal(listValues.length, 3);
        assert.equal(listValues.includes(keyA), false);
        assert.equal(listValues.includes(owner), true);
        assert.equal(listValues.includes(created.batch.id), true);
        assert.equal(listValues.includes(empty.batch.id), true);

        const outsiderWatch = watch(db);
        const outsiderList = await listInterventionBatches(outsiderWatch.connection, outsider, brand);
        assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderList).includes("secret-page"), false);
        assert.equal(outsiderWatch.captured.some((item) => /\bintervention_batch_page\b/i.test(item.sql)), false);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO intervention_batch_page (
              id, batch_id, brand_id, owner_id, page_key, verified_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), created.batch.id, brand, owner, keyA, t1, time, time],
          ),
          /unique|UNIQUE/i,
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
          `INSERT INTO intervention_batch (
            id, brand_id, owner_id, status, effective_at, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'pending', NULL, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO intervention_batch_page (
            id, batch_id, brand_id, owner_id, page_key, verified_at, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, `extra-${id}`, t1, time, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE intervention_batch");
          await db.query("ANALYZE intervention_batch_page");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = interventionBatchListQuery(owner, brand);
        const pageQuery = interventionBatchPageListQuery(owner, created.batch.id);
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        const pagePlan = JSON.stringify(await queryWithParameters(db, explain + pageQuery.sql, pageQuery.values));
        assert.match(listPlan, /intervention_batch_owner_idx/);
        assert.match(pagePlan, /intervention_batch_page_key_uidx/);
        const detail = watch(db);
        assert.deepEqual(await getInterventionBatch(detail.connection, owner, created.batch.id), { batch: visible });
        const batchReads = detail.captured.filter((item) => isSelect(item.sql, "intervention_batch"));
        assert.equal(batchReads.length, 2);
        const identityRead = batchReads[0];
        assert.deepEqual(identityRead.values, [created.batch.id]);
        const identityPlan = JSON.stringify(await queryWithParameters(db, explain + identityRead.sql, identityRead.values));
        assert.match(identityPlan, db.kind === "postgresql" ? /intervention_batch_pkey/ : /sqlite_autoindex_intervention_batch_1/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(listPlan, /Seq Scan on intervention_batch(?!_)/);
          assert.doesNotMatch(pagePlan, /Seq Scan on intervention_batch_page/);
        }
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
