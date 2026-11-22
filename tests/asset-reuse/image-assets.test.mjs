import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  expireImageAsset,
  listImageAssets,
  readImageAsset,
  registerImageAsset,
  registerImageAssetUse,
  revokeImageAsset,
} from "../../src/features/asset-reuse/image-asset-commands.ts";
import { registerImageAssetSchema, registerImageAssetUseSchema } from "../../src/features/asset-reuse/image-asset-contracts.ts";
import { imageAssetUsesQuery, ownedImageAssetsQuery } from "../../src/features/asset-reuse/image-asset-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const secretName = "机密产品图.png";
const brandFields = {
  name: "己品牌",
  description: "Synthetic brand for image assets",
  website: "https://mu.example.com",
  aliases: ["己"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

test("image asset messages and input stay bilingual and strict", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  assert.match(zhCN.imageAssets.RIGHTS_CLOSED, /不能登记新引用/);
  assert.match(zhCN.imageAssets.revoked, /待办/);
  assert.match(zhCN.imageAssets.description, /不上传图片/);
  assert.match(zhCN.content.assetsLink, /图片素材/);
  assert.match(en.imageAssets.RIGHTS_CLOSED, /cannot be registered/i);
  assert.match(en.imageAssets.revoked, /todo/i);
  assert.match(en.imageAssets.description, /does not upload/i);
  assert.match(en.content.assetsLink, /image asset/i);
  assert.equal(safeReturnTo("/dashboard/content/assets?brandId=1"), "/dashboard/content/assets?brandId=1");
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const id = randomUUID();
  assert.equal(registerImageAssetSchema.safeParse({
    brandId, fileName: secretName, version: 2, byteSize: null, extra: true,
  }).success, false);
  assert.equal(registerImageAssetSchema.safeParse({
    brandId, fileName: "../secret.png", version: 2,
  }).success, false);
  assert.equal(registerImageAssetSchema.safeParse({
    brandId, fileName: secretName, version: 2, byteSize: null,
  }).success, true);
  assert.equal(registerImageAssetUseSchema.safeParse({
    brandId, id, contentVersionId: id, note: "x",
  }).success, false);
});

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
    query(sql, values) {
      queries.push(sql);
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((nested) => work(wrap(nested)));
    },
    close() {
      return current.close();
    },
  });
  return { connection: wrap(connection), queries };
}

async function addUser(db, id) {
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "素材夹具", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
}

async function addBrand(db, ownerId, id) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, id, time);
  await brands.insertVersion(id, 1, brandFields, time);
}

async function seedVersion(db, brand, ownerId) {
  const briefId = randomUUID();
  const briefVersionId = randomUUID();
  const batchId = randomUUID();
  const unitId = randomUUID();
  const versionId = randomUUID();
  const run = (sql, values) => queryWithParameters(db, sql, values);
  await run(
    "INSERT INTO content_brief (id, brand_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
    [briefId, brand, ownerId, time, time],
  );
  await run(
    `INSERT INTO content_brief_version (
      id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary,
      primary_page, conversion_action, template_kind, title_candidates_json, fact_version_ids_json, created_at
    ) VALUES (?, ?, ?, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["t"]', '[]', ?)`,
    [briefVersionId, briefId, brand, time],
  );
  await run(
    `INSERT INTO content_batch (id, brand_id, owner_id, status, operation_id, cost_ledger_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', ?, '{}', ?, ?)`,
    [batchId, brand, ownerId, randomUUID(), time, time],
  );
  await run(
    `INSERT INTO content_batch_unit (id, batch_id, brief_id, brand_id, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?)`,
    [unitId, batchId, briefId, brand, time, time],
  );
  await run(
    `INSERT INTO content_version (
      id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id, template_kind, title, body_markdown,
      claims_json, status, fingerprint, created_at, updated_at, target_channel, labeling_profile_version,
      labeling_profile_status, image_asset_ids_json, fact_version_ids_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', '合成标题', '合成正文', '{}', 'draft', 'fp', ?, ?, 'primary_page', 'unverified', 'unverified', '[]', '[]')`,
    [versionId, brand, ownerId, briefId, briefVersionId, unitId, time, time],
  );
  return versionId;
}

async function countOf(db, table) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table}`, []);
  return Number(row.n);
}

async function versionLedger(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT status, image_asset_ids_json AS "imageAssetIdsJson" FROM content_version WHERE id = ?`,
    [id],
  );
  return { status: row.status, imageAssetIdsJson: row.imageAssetIdsJson };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: revoked image citations stay and open one todo each`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const owner = randomUUID();
      const stranger = randomUUID();
      const brand = randomUUID();
      const strangerBrand = randomUUID();
      await addUser(db, owner);
      await addUser(db, stranger);
      await addBrand(db, owner, brand);
      await addBrand(db, stranger, strangerBrand);
      const firstVersion = await seedVersion(db, brand, owner);
      const secondVersion = await seedVersion(db, brand, owner);
      const thirdVersion = await seedVersion(db, brand, owner);
      const strangerVersion = await seedVersion(db, strangerBrand, stranger);
      const packagesBefore = await countOf(db, "content_delivery_package");

      const registered = await registerImageAsset(db, owner, {
        brandId: brand, fileName: secretName, version: 3, byteSize: null,
      }, time);
      assert.equal(registered.asset.fileName, secretName);
      assert.equal(registered.asset.version, 3);
      assert.equal(registered.asset.rightsStatus, "active");
      assert.equal(registered.asset.byteSize, null);
      const assetId = registered.asset.id;

      const firstUse = await registerImageAssetUse(db, owner, {
        brandId: brand, id: assetId, contentVersionId: firstVersion,
      }, time);
      const secondUse = await registerImageAssetUse(db, owner, {
        brandId: brand, id: assetId, contentVersionId: secondVersion,
      }, time);
      assert.equal(firstUse.use.assetVersion, 3);
      assert.equal(secondUse.use.assetVersion, 3);
      const repeated = await registerImageAssetUse(db, owner, {
        brandId: brand, id: assetId, contentVersionId: firstVersion,
      }, time);
      assert.equal(repeated.use.id, firstUse.use.id);
      assert.equal(await countOf(db, "image_asset_use"), 2);
      assert.deepEqual(await versionLedger(db, firstVersion), { status: "draft", imageAssetIdsJson: "[]" });
      assert.deepEqual(await versionLedger(db, secondVersion), { status: "draft", imageAssetIdsJson: "[]" });

      const foreignUse = await registerImageAssetUse(db, owner, {
        brandId: brand, id: assetId, contentVersionId: strangerVersion,
      }, time);
      assert.deepEqual(foreignUse, { error: "NOT_FOUND" });
      assert.equal(JSON.stringify(foreignUse).includes(strangerVersion), false);
      assert.equal(await countOf(db, "image_asset_use"), 2);

      const traced = trace(db);
      const revoked = await revokeImageAsset(traced.connection, owner, { brandId: brand, id: assetId }, time);
      assert.equal(revoked.asset.rightsStatus, "revoked");
      assert.equal(revoked.asset.fileName, secretName);
      assert.equal(revoked.uses.length, 2);
      assert.equal(revoked.todos.length, 2);
      assert.deepEqual(revoked.todos.map((todo) => todo.contentVersionId).sort(), [firstVersion, secondVersion].sort());
      assert.equal(revoked.todos.every((todo) => todo.assetVersion === 3), true);
      const useSelects = traced.queries.filter((sql) => /from image_asset_use/i.test(sql));
      assert.equal(useSelects.length, 2);
      assert.equal(useSelects.every((sql) => /left join image_asset_todo/i.test(sql)), true);
      assert.equal(traced.queries.some((sql) => /image_asset_ids_json/i.test(sql)), false);
      assert.equal(traced.queries.some((sql) => /delete\s+from\s+image_asset\b/i.test(sql)), false);
      assert.equal(await countOf(db, "image_asset"), 1);
      assert.equal(await countOf(db, "image_asset_use"), 2);
      assert.equal(await countOf(db, "image_asset_todo"), 2);
      assert.equal(await countOf(db, "content_delivery_package"), packagesBefore);
      assert.deepEqual(await versionLedger(db, firstVersion), { status: "draft", imageAssetIdsJson: "[]" });

      const again = await revokeImageAsset(db, owner, { brandId: brand, id: assetId }, time);
      assert.equal(again.asset.rightsStatus, "revoked");
      assert.equal(again.todos.length, 2);
      assert.equal(await countOf(db, "image_asset_todo"), 2);
      assert.equal(await countOf(db, "image_asset"), 1);

      const blocked = await registerImageAssetUse(db, owner, {
        brandId: brand, id: assetId, contentVersionId: thirdVersion,
      }, time);
      assert.deepEqual(blocked, { error: "RIGHTS_CLOSED" });
      assert.equal(JSON.stringify(blocked).includes(secretName), false);
      assert.equal(JSON.stringify(blocked).includes(thirdVersion), false);
      assert.equal(await countOf(db, "image_asset_use"), 2);

      const hidden = await readImageAsset(db, stranger, { brandId: brand, id: assetId });
      assert.deepEqual(hidden, { error: "NOT_FOUND" });
      assert.equal(JSON.stringify(hidden).includes(secretName), false);
      assert.equal(JSON.stringify(hidden).includes(firstVersion), false);
      assert.equal(JSON.stringify(hidden).includes(secondVersion), false);
      const strangerList = await listImageAssets(db, stranger, strangerBrand);
      assert.equal(JSON.stringify(strangerList).includes(secretName), false);
      const strangerRevoke = await revokeImageAsset(db, stranger, { brandId: brand, id: assetId }, time);
      assert.deepEqual(strangerRevoke, { error: "NOT_FOUND" });
      assert.equal(await countOf(db, "image_asset_todo"), 2);

      const expiredAsset = await registerImageAsset(db, owner, {
        brandId: brand, fileName: "到期示意图.png", version: 1,
      }, time);
      const expiredUse = await registerImageAssetUse(db, owner, {
        brandId: brand, id: expiredAsset.asset.id, contentVersionId: thirdVersion,
      }, time);
      assert.equal("use" in expiredUse, true);
      const expired = await expireImageAsset(db, owner, { brandId: brand, id: expiredAsset.asset.id }, time);
      assert.equal(expired.asset.rightsStatus, "expired");
      assert.equal(expired.uses.length, 1);
      assert.equal(expired.todos.length, 0);
      const fourthVersion = await seedVersion(db, brand, owner);
      const expiredBlock = await registerImageAssetUse(db, owner, {
        brandId: brand, id: expiredAsset.asset.id, contentVersionId: fourthVersion,
      }, time);
      assert.deepEqual(expiredBlock, { error: "RIGHTS_CLOSED" });
      assert.equal(await countOf(db, "image_asset_use"), 3);
      const stillReadable = await readImageAsset(db, owner, { brandId: brand, id: expiredAsset.asset.id });
      assert.equal(stillReadable.uses.length, 1);
      const expiredRevoke = await revokeImageAsset(db, owner, { brandId: brand, id: expiredAsset.asset.id }, time);
      assert.equal(expiredRevoke.asset.rightsStatus, "revoked");
      assert.equal(expiredRevoke.todos.length, 1);
      assert.equal(expiredRevoke.uses.length, 1);

      for (let index = 0; index < 12; index += 1) {
        await queryWithParameters(
          db,
          `INSERT INTO image_asset_use (id, asset_id, brand_id, content_version_id, asset_version, created_at)
            VALUES (?, ?, ?, ?, 3, ?)`,
          [randomUUID(), assetId, brand, randomUUID(), time],
        );
      }
      if (db.kind === "postgresql") {
        await db.query("ANALYZE image_asset");
        await db.query("ANALYZE image_asset_use");
        await db.query("ANALYZE image_asset_todo");
      }
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const usesQuery = imageAssetUsesQuery(assetId);
      const listQuery = ownedImageAssetsQuery(owner, brand);
      const usesPlan = await planFor(usesQuery.sql, usesQuery.values);
      const listPlan = await planFor(listQuery.sql, listQuery.values);
      assert.match(usesPlan, /image_asset_use_asset_idx/);
      assert.match(listPlan, /image_asset_owner_idx/);
      if (db.kind === "postgresql") {
        assert.doesNotMatch(usesPlan, /Seq Scan on image_asset_use/);
        assert.doesNotMatch(listPlan, /Seq Scan on image_asset/);
      }
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /image_asset_owner_idx/);
      assert.match(defined, /image_asset_use_asset_idx/);
      assert.match(defined, /image_asset_todo_use_uidx/);
      assert.match(defined, /image_asset_state_check/);
      if (db.kind === "postgresql") assert.match(defined, /image_asset_use_asset_fk/);
      else assert.match(defined, /FOREIGN KEY \(`asset_id`\) REFERENCES `image_asset`/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
