import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { storeFacts } from "../../src/features/local-presence/rules.ts";
import {
  listBrandStores,
  readBrandStore,
  readBrandStoresForBrand,
  recordStoreFactUse,
  registerBrandStore,
} from "../../src/features/local-presence/store-commands.ts";
import { brandStoreErrors, recordStoreFactUseSchema, registerBrandStoreSchema } from "../../src/features/local-presence/store-contracts.ts";
import { BrandStoreDao, brandStoresForBrandQuery } from "../../src/features/local-presence/store-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
const westArea = "西湖";
const riverArea = "滨江";

test("storeFacts keeps the selected service area and marks the other store unused", () => {
  const row = storeFacts({ storeId: "west", serviceArea: westArea, otherStoreArea: riverArea });
  assert.equal(row.storeId, "west");
  assert.equal(row.serviceArea, westArea);
  assert.equal(row.otherStoreArea, riverArea);
  assert.equal(row.usedOtherStore, false);
  const input = { brandId, name: "湖滨店", serviceArea: westArea };
  assert.equal(registerBrandStoreSchema.safeParse(input).success, true);
  assert.equal(registerBrandStoreSchema.safeParse({ ...input, usedOtherStore: true }).success, false);
  assert.equal(registerBrandStoreSchema.safeParse({ ...input, otherStoreArea: riverArea }).success, false);
  assert.equal(recordStoreFactUseSchema.safeParse({ serviceArea: westArea }).success, true);
  assert.equal(recordStoreFactUseSchema.safeParse({ serviceArea: westArea, otherStoreArea: riverArea }).success, false);
  assert.equal(recordStoreFactUseSchema.safeParse({ serviceArea: westArea, usedOtherStore: 1 }).success, false);
  assert.equal(brandStoreErrors.OTHER_STORE, 400);
  assert.equal(brandStoreErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/brands/stores"), "/dashboard/brands/stores");
});

test("store copy keeps each service area on its own store", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.brandStores.description, /服务范围/);
  assert.match(zhCN.brandStores.description, /另一家门店/);
  assert.match(zhCN.brandStores.OTHER_STORE, /其他门店/);
  assert.match(zhCN.brandStores.serviceAreaLine, /服务范围 \{area\}/);
  assert.match(zhCN.brandStores.useLine, /核对使用的范围 \{area\}/);
  assert.equal(JSON.stringify(zhCN.brandStores).includes(westArea), false);
  assert.equal(JSON.stringify(zhCN.brandStores).includes(riverArea), false);
  assert.match(en.brandStores.description, /service area/i);
  assert.match(en.brandStores.description, /another store/i);
  assert.match(en.brandStores.OTHER_STORE, /another store/i);
  assert.match(en.brandStores.serviceAreaLine, /Service area \{area\}/);
  assert.match(en.brandStores.useLine, /Checked area \{area\}/);
  assert.equal(JSON.stringify(en.brandStores).includes(westArea), false);
  assert.equal(JSON.stringify(en.brandStores).includes(riverArea), false);
  assert.equal(zhCN.brands.openBrandStores.length > 0, true);
  assert.equal(en.brands.openBrandStores.length > 0, true);
  const page = await readFile(new URL("../../src/features/local-presence/stores-page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../src/features/local-presence/stores-panel.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  assert.equal(panel.includes("serviceAreaLine") && panel.includes("useLine") && panel.includes("ownStoreOnly"), true);
  assert.equal(panel.includes("store.serviceArea"), true);
  assert.equal(panel.includes(westArea), false);
  assert.equal(panel.includes(riverArea), false);
  const source = await readFile(new URL("../../src/features/local-presence/store-commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("storeFacts"), true);
  assert.equal(source.includes("otherStoreArea"), true);
  assert.equal(source.includes("facts.serviceArea"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
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

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 60_000).toISOString();
}

function isSelect(sql, table) {
  return /^\s*select/i.test(sql) && new RegExp(`\\b${table}\\b`, "i").test(sql);
}

function writes(captured) {
  return captured.filter((item) => /^\s*(insert|update|delete)/i.test(item.sql));
}

function tableSql(shape, table) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === table)
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === table)
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Store owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function storeInput(brand, name, serviceArea) {
  return { brandId: brand, name, serviceArea };
}

async function useCount(db, storeId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT count(*) AS "total" FROM store_fact_use WHERE store_id = ?`,
    [storeId],
  );
  return Number(row.total);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: two store areas stay separate and a cross-store check is refused`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /brand_store_owner_brand_idx/);
        assert.match(defined, /brand_store_state_check/);
        assert.match(defined, /store_fact_use_owner_idx/);
        assert.match(defined, /store_fact_use_state_check/);
        if (db.kind === "postgresql") {
          assert.match(defined, /brand_store_brand_id_brand_id_fk/);
          assert.match(defined, /store_fact_use_store_id_brand_store_id_fk/);
        } else {
          assert.match(defined, /FOREIGN KEY \(`brand_id`\) REFERENCES `brand`/);
          assert.match(defined, /FOREIGN KEY \(`store_id`\) REFERENCES `brand_store`/);
        }
        const storeColumns = tableSql(migrated, "brand_store");
        const useColumns = tableSql(migrated, "store_fact_use");
        for (const word of ["latitude", "longitude", "ranking", "password", "token", "secret", "cookie", "user_agent", "other_store_area"]) {
          assert.equal(storeColumns.includes(word), false, word);
          assert.equal(useColumns.includes(word), false, word);
        }
        assert.equal(storeColumns.includes("service_area"), true);
        assert.equal(useColumns.includes("service_area"), true);
        assert.equal(useColumns.includes("used_other_store"), true);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);

        const hiddenWatch = watch(db);
        const hidden = await registerBrandStore(hiddenWatch.connection, outsider, storeInput(brand, "湖滨店", westArea), clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(writes(hiddenWatch.captured).length, 0);
        assert.equal(JSON.stringify(hidden).includes(westArea), false);
        assert.equal(JSON.stringify(hidden).includes(riverArea), false);

        const west = await registerBrandStore(db, owner, storeInput(brand, "湖滨店", westArea), clock);
        const river = await registerBrandStore(db, owner, storeInput(brand, "滨江店", riverArea), clock);
        assert.equal(west.store.serviceArea, westArea);
        assert.equal(river.store.serviceArea, riverArea);
        assert.notEqual(west.store.id, river.store.id);

        const storedAreas = await queryWithParameters(
          db,
          `SELECT id, name, service_area AS "serviceArea" FROM brand_store WHERE brand_id = ? ORDER BY created_at ASC, id ASC`,
          [brand],
        );
        assert.deepEqual(storedAreas.map((row) => row.serviceArea), [westArea, riverArea]);
        assert.deepEqual(storedAreas.map((row) => row.name), ["湖滨店", "滨江店"]);

        const foreignBrand = await readBrandStoresForBrand(db, owner, otherBrand);
        assert.deepEqual(foreignBrand, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(foreignBrand).includes(westArea), false);
        assert.equal(JSON.stringify(foreignBrand).includes(riverArea), false);

        const hiddenStore = await readBrandStore(db, outsider, west.store.id);
        assert.deepEqual(hiddenStore, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hiddenStore).includes(westArea), false);
        const hiddenList = await listBrandStores(db, outsider);
        assert.equal(hiddenList.stores.some((row) => row.id === west.store.id || row.id === river.store.id), false);
        assert.equal(JSON.stringify(hiddenList).includes(westArea), false);
        assert.equal(JSON.stringify(hiddenList).includes(riverArea), false);

        const brandWatch = watch(db);
        const ownedBrand = await readBrandStoresForBrand(brandWatch.connection, owner, brand);
        const brandSelects = brandWatch.captured.filter((item) => isSelect(item.sql, "brand_store"));
        assert.equal(brandSelects.length, 1);
        assert.equal(ownedBrand.stores.length, 2);
        assert.deepEqual(ownedBrand.stores.map((row) => row.serviceArea), [westArea, riverArea]);

        const rejectedWatch = watch(db);
        const before = await useCount(db, west.store.id);
        const rejected = await recordStoreFactUse(rejectedWatch.connection, owner, west.store.id, { serviceArea: riverArea }, clock);
        assert.deepEqual(rejected, { error: "OTHER_STORE" });
        assert.equal(writes(rejectedWatch.captured).length, 0);
        assert.equal(await useCount(db, west.store.id), before);
        assert.equal(JSON.stringify(rejected).includes(riverArea), false);
        assert.equal(JSON.stringify(rejected).includes(westArea), false);

        const outsiderUse = await recordStoreFactUse(db, outsider, west.store.id, { serviceArea: riverArea }, clock);
        assert.deepEqual(outsiderUse, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderUse).includes(westArea), false);
        assert.equal(JSON.stringify(outsiderUse).includes(riverArea), false);
        assert.equal(await useCount(db, west.store.id), before);

        const useWatch = watch(db);
        const recorded = await recordStoreFactUse(useWatch.connection, owner, west.store.id, { serviceArea: westArea }, clock);
        const useStoreSelects = useWatch.captured.filter((item) => isSelect(item.sql, "brand_store"));
        assert.equal(useStoreSelects.length, 1);
        assert.equal(recorded.use.storeId, west.store.id);
        assert.equal(recorded.use.serviceArea, westArea);
        assert.equal(recorded.use.usedOtherStore, false);
        assert.equal(JSON.stringify(recorded).includes(riverArea), false);

        const storedUse = await queryWithParameters(
          db,
          `SELECT store_id AS "storeId", service_area AS "serviceArea", used_other_store AS "usedOtherStore"
            FROM store_fact_use WHERE id = ?`,
          [recorded.use.id],
        );
        assert.equal(storedUse[0].storeId, west.store.id);
        assert.equal(storedUse[0].serviceArea, westArea);
        assert.equal(Number(storedUse[0].usedOtherStore), 0);
        const stillSeparate = await queryWithParameters(
          db,
          `SELECT service_area AS "serviceArea" FROM brand_store WHERE id IN (?, ?) ORDER BY created_at ASC, id ASC`,
          [west.store.id, river.store.id],
        );
        assert.deepEqual(stillSeparate.map((row) => row.serviceArea), [westArea, riverArea]);

        const visible = await readBrandStore(db, owner, west.store.id);
        assert.equal(visible.store.serviceArea, westArea);
        assert.equal(visible.uses[0].serviceArea, westArea);
        assert.equal(visible.uses[0].usedOtherStore, false);
        assert.equal(JSON.stringify(visible).includes(riverArea), false);

        const listWatch = watch(db);
        const listed = await listBrandStores(listWatch.connection, owner);
        const listSelects = listWatch.captured.filter((item) => isSelect(item.sql, "brand_store"));
        assert.equal(listSelects.length, 1);
        assert.equal(listed.stores.some((row) => row.serviceArea === westArea), true);
        assert.equal(listed.stores.some((row) => row.serviceArea === riverArea), true);
        assert.equal(listed.uses.some((row) => row.storeId === west.store.id && row.usedOtherStore === false), true);

        const rolled = randomUUID();
        await assert.rejects(
          () => db.transaction(async (tx) => {
            await new BrandStoreDao(tx).insertStores([{
              id: rolled,
              brandId: brand,
              ownerId: owner,
              name: "回滚店",
              serviceArea: westArea,
              createdAt: time,
            }]);
            throw new Error("rollback-fixture");
          }),
          /rollback-fixture/,
        );
        assert.deepEqual(await readBrandStore(db, owner, rolled), { error: "NOT_FOUND" });

        const extra = Array.from({ length: 3000 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand_store (
            id, brand_id, owner_id, name, service_area, created_at
          ) VALUES ${extra.map(() => "(?, ?, ?, '对照店', '钱塘', ?)").join(", ")}`,
          extra.flatMap((id) => [id, otherBrand, outsider, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE brand_store");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = brandStoresForBrandQuery(owner, brand);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, /brand_store_owner_brand_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(ownerPlan, /Seq Scan on brand_store/);

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE store_fact_use SET used_other_store = 1 WHERE id = ?`, [recorded.use.id]),
          /CHECK|check constraint/i,
        );
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
