import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { exportRequestSchema } from "../../src/features/data-exports/contracts.ts";
import { getExportSummary, prepareExport, readExportFile } from "../../src/features/data-exports/service.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-18T08:00:00.000Z";
const fields = { ...initialBrandFields, name: "合成品牌 🚀", description: "合成导出验收资料" };
const profile = { name: "测试负责人 🚀", email: "owner@example.invalid" };

function request(actorId, scopes, previousId = null, locale = "zh-CN") {
  return exportRequestSchema.parse({ actorId, scopes, previousId, locale });
}

async function insertOwner(db, id, email = profile.email) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, image) VALUES (?, ?, ?, ?)',
    [id, profile.name, email, "excluded-image-marker"]);
}

async function insertBrand(db, ownerId, status, name) {
  const dao = new BrandDao(db);
  const id = randomUUID();
  // Seed the historical schema before introducing freeze columns.
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, ?, 1, 1, ?)`, [id, ownerId, status, time]);
  await dao.insertVersion(id, 1, { ...fields, name }, time);
  return id;
}

async function queryEvidence(db, owner) {
  const observed = [];
  const dao = new BrandDao({ kind: db.kind, query(sql, values) {
    observed.push({ sql, values });
    return db.query(sql, values);
  } });
  for (const count of [10, 500]) {
    const extra = count === 10 ? 10 : 490;
    const other = randomUUID();
    await insertOwner(db, other, `${other}@example.invalid`);
    const ids = Array.from({ length: extra }, randomUUID);
    await db.transaction(async (tx) => {
      await queryWithParameters(tx, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at) VALUES
        ${ids.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
      ids.flatMap((id) => [id, other, time]));
      await queryWithParameters(tx, `INSERT INTO brand_version (brand_id, version, name, content, created_at) VALUES
        ${ids.map(() => "(?, 1, ?, ?, ?)").join(", ")}`,
      ids.flatMap((id) => [id, fields.name, JSON.stringify(fields), time]));
    });
    if (db.kind === "postgresql") await db.query("ANALYZE brand, brand_version, brand_draft");
    observed.length = 0;
    const before = performance.now();
    const versions = await dao.exportVersions(owner, 64);
    const drafts = await dao.exportDrafts(owner, 64, "");
    assert.equal(versions.length, 2);
    assert.equal(drafts.length, 1);
    assert.equal(observed.length, 2);
    console.log(`${db.kind} brand export with ${count} unrelated synthetic brands, ${observed.length} SQL, ${(performance.now() - before).toFixed(2)} ms`);
    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const plans = [];
    for (const { sql, values } of observed) plans.push(await db.query(explain + sql, values));
    if (count === 500) {
      assert.match(JSON.stringify(plans[0]), /brand_owner_status_created_idx|brand_active_owner_uidx/);
      assert.match(JSON.stringify(plans[0]), /brand_version_brand_id_version_pk|sqlite_autoindex_brand_version_1/);
      console.log(`${db.kind} export plans ${JSON.stringify(plans)}`);
    }
  }
}

test("export request bounds, scope and language are validated", () => {
  const valid = request(randomUUID(), ["brands", "profile"]);
  for (const change of [
    { scopes: [] }, { scopes: ["profile", "profile"] }, { scopes: ["sessions"] },
    { locale: "zh" }, { previousId: "other" }, { ownerId: randomUUID() },
  ]) assert.equal(exportRequestSchema.safeParse({ ...valid, ...change }).success, false);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: upgrade, export scope, rollback, concurrency and revocation`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, kind === "sqlite" ? "0001_lowly_domino" : "0002_lame_jubilee");
    const owner = randomUUID(), other = randomUUID();
    await insertOwner(db, owner);
    await insertOwner(db, other, "other@example.invalid");
    const archived = await insertBrand(db, owner, "archived", "已归档的合成档案");
    const current = await insertBrand(db, owner, "active", fields.name);
    const foreign = await insertBrand(db, other, "active", "Foreign synthetic brand");
    const dao = new BrandDao(db);
    await dao.saveDraft(owner, "new", randomUUID(), null, 2, fields, time);
    await dao.saveDraft(owner, foreign, randomUUID(), 1, 0, { ...fields, name: "Excluded draft" }, time);
    for (let repeat = 0; repeat < 2; repeat++) {
      execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
    }
    const ddl = await testDatabase(kind, { ddl: true });
    try { assert.deepEqual(await structure(db), await structure(ddl.connection)); }
    finally { await ddl.cleanup(); }

    assert.equal(await getExportSummary(db, owner), null);
    const { summary: ready } = await prepareExport(db, owner, request(owner, ["brands", "profile"]));
    assert.equal(ready.status, "ready");
    const file = await readExportFile(db, owner, ready.id, true);
    const body = JSON.parse(file.body);
    assert.deepEqual(body.unavailable, []);
    assert.deepEqual(body.data.profile, profile);
    assert.deepEqual(body.data.brands.versions.map(({ id }) => id), [current, archived]);
    assert.deepEqual(body.data.brands.drafts.map(({ scope }) => scope), ["new"]);
    assert.equal(body.data.brands.versions[0].fields.name, fields.name);
    assert.equal(body.data.brands.versions[0].fields.language, "zh-CN");
    assert.doesNotMatch(file.body, /Foreign synthetic|Excluded draft|excluded-image-marker|password|session/);
    assert.equal(await readExportFile(db, other, ready.id, true), null);
    assert.equal(await readExportFile(db, owner, ready.id, false), null);
    await queryEvidence(db, owner);

    // A cursor can advance within one brand as well as across brand IDs.
    await db.transaction(async (tx) => {
      const inside = new BrandDao(tx);
      for (let version = 2; version <= 65; version++) await inside.insertVersion(current, version, fields, time);
      await queryWithParameters(tx, "UPDATE brand SET revision = 65, entity_version = 65 WHERE owner_id = ? AND id = ?", [owner, current]);
    });
    assert.equal(await readExportFile(db, owner, ready.id, true), null);
    const newRequest = request(owner, ["brands", "profile"], ready.id);
    const outcomes = await Promise.all([prepareExport(db, owner, newRequest), prepareExport(db, owner, newRequest)]);
    const latest = outcomes.find((result) => result.summary).summary;
    assert.deepEqual(outcomes.find((result) => result.error), { error: "CONFLICT" });
    const versions = JSON.parse((await readExportFile(db, owner, latest.id, true)).body).data.brands.versions;
    assert.equal(versions.length, 66);
    assert.deepEqual(versions.filter(({ id }) => id === current).map(({ version }) => version), Array.from({ length: 65 }, (_, i) => i + 1));
    assert.equal(await readExportFile(db, owner, ready.id, true), null);

    await queryWithParameters(db, "DELETE FROM brand WHERE id = ?", [archived]);
    assert.equal(await readExportFile(db, owner, latest.id, true), null);
    const { summary: profileOnly } = await prepareExport(db, other, request(other, ["profile"], null, "en"));
    assert.deepEqual(Object.keys(JSON.parse((await readExportFile(db, other, profileOnly.id, false)).body).data), ["profile"]);

    await db.query("CREATE UNIQUE INDEX export_test_failure ON user_data_export (locale)");
    try {
      await assert.rejects(prepareExport(db, owner, request(owner, ["profile"], latest.id, "en")));
      assert.deepEqual(await getExportSummary(db, owner), latest);
    } finally { await db.query("DROP INDEX export_test_failure"); }

    await db.query("ALTER TABLE brand_version RENAME TO brand_test_unavailable");
    try {
      const { summary: partial } = await prepareExport(db, owner, request(owner, ["profile", "brands"], latest.id));
      assert.equal(partial.status, "partial");
      assert.deepEqual(partial.missing, ["brands"]);
      const partialBody = JSON.parse((await readExportFile(db, owner, partial.id, true)).body);
      assert.deepEqual(partialBody.data, { profile });
      assert.equal(partialBody.status, "partial");
      const { summary: failed } = await prepareExport(db, owner, request(owner, ["brands"], partial.id));
      assert.equal(failed.status, "failed");
      assert.equal(await readExportFile(db, owner, failed.id, true), null);
    } finally { await db.query("ALTER TABLE brand_test_unavailable RENAME TO brand_version"); }

    const longFields = { ...fields, questions: Array(10).fill("🚀".repeat(500)) };
    await db.transaction(async (tx) => {
      for (let from = 66; from <= 525; from += 20) {
        const versions = Array.from({ length: 20 }, (_, offset) => from + offset);
        await queryWithParameters(tx, `INSERT INTO brand_version (brand_id, version, name, content, created_at) VALUES
          ${versions.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
        versions.flatMap((version) => [current, version, longFields.name, JSON.stringify(longFields), time]));
      }
      await queryWithParameters(tx, "UPDATE brand SET revision = 525, entity_version = 525 WHERE owner_id = ? AND id = ?", [owner, current]);
    });
    const previous = await getExportSummary(db, owner);
    const { summary: oversized } = await prepareExport(db, owner, request(owner, ["profile", "brands"], previous.id));
    assert.equal(oversized.status, "partial");
    assert.deepEqual(oversized.missing, ["brands"]);
    assert.deepEqual(JSON.parse((await readExportFile(db, owner, oversized.id, true)).body).data, { profile });

    await assert.rejects(queryWithParameters(db, "UPDATE user_data_export SET included = 3 WHERE owner_id = ?", [other]));
    await assert.rejects(queryWithParameters(db, "UPDATE user_data_export SET fingerprint = NULL WHERE owner_id = ?", [other]));
    await queryWithParameters(db, 'DELETE FROM "user" WHERE id = ?', [other]);
    assert.equal(await getExportSummary(db, other), null);
    assert.equal(await readExportFile(db, other, profileOnly.id, true), null);
  });
}
