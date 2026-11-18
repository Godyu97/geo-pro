import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { brandCommandSchema, brandFieldsSchema, initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const fields = { ...initialBrandFields, name: "合成品牌 🚀", description: "用于品牌验收的合成业务" };
const time = "2026-11-18T08:00:00.000Z";

test("brand validation preserves Unicode and allows optional fields and legitimate public domains", () => {
  assert.equal(brandFieldsSchema.parse({ ...fields, name: "  北🚀  ", region: "cn", language: "zh-cn" }).name, "北🚀");
  assert.equal(brandFieldsSchema.parse(fields).website, "");
  assert.equal(brandFieldsSchema.parse({ ...fields, website: "https://例子.中国/业务" }).website, "https://例子.中国/业务");
  for (const website of ["https://127.0.0.1", "https://host.local", "file:///tmp", "https://name:secret@example.org", "https://example.org\\x"]) {
    assert.equal(brandFieldsSchema.safeParse({ ...fields, website }).success, false);
  }
  for (const change of [
    { name: "字" }, { name: "🚀".repeat(81) }, { description: "短".repeat(4) },
    { aliases: Array(11).fill("别名") }, { competitors: Array(4).fill("竞品") },
    { region: "China" }, { language: "not_a_tag" }, { questions: ["Q".repeat(501)] }, { password: "unexpected" },
  ]) {
    assert.equal(brandFieldsSchema.safeParse({ ...fields, ...change }).success, false);
  }
});

function addUser(db, id) {
  return queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic brand owner", `${id}@example.invalid`]);
}

async function checkUpgrade(kind, fixture) {
  const db = fixture.connection;
  await migrateThrough(db, kind === "sqlite" ? "0000_magical_stepford_cuckoos" : "0001_colorful_dark_beast");
  const owner = randomUUID();
  await addUser(db, owner);
  await queryWithParameters(db, "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)",
    [owner, "support.read", time, owner]);
  for (let repeat = 0; repeat < 2; repeat++) {
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
  }
  const users = await queryWithParameters(db, 'SELECT name FROM "user" WHERE id = ?', [owner]);
  const grants = await queryWithParameters(db, "SELECT permission FROM maintenance_grant WHERE user_id = ?", [owner]);
  assert.deepEqual(users.map((row) => row.name), ["Synthetic brand owner"]);
  assert.deepEqual(grants.map((row) => row.permission), ["support.read"]);
  return owner;
}

async function archiveQueryEvidence(db, owner) {
  async function seed(count, offset) {
    const brands = Array.from({ length: count }, (_, index) => [
      randomUUID(), owner, new Date(Date.parse(time) + offset + index).toISOString(),
    ]);
    await db.transaction(async (tx) => {
      await queryWithParameters(tx, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at) VALUES
        ${brands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`, brands.flat());
      await queryWithParameters(tx, `INSERT INTO brand_version (brand_id, version, name, content, created_at) VALUES
        ${brands.map(() => "(?, 1, 'Synthetic archive', ?, ?)").join(", ")}`, brands.flatMap(([id, , date]) => [id, JSON.stringify(fields), date]));
    });
  }
  let captured;
  const observed = new BrandDao({ kind: db.kind, query: (sql, values) => {
    captured.push({ sql, values });
    return db.query(sql, values);
  } });
  for (const [count, offset] of [[10, 0], [490, 10]]) {
    await seed(count, offset);
    if (db.kind === "postgresql") await db.query("ANALYZE brand, brand_version");
    captured = [];
    const before = performance.now();
    const page = await observed.archived(owner);
    const elapsed = performance.now() - before;
    assert.equal(captured.length, 1);
    assert.equal(page.items.length, count === 10 ? 10 : 20);
    console.log(`${db.kind} archive ${offset + count} synthetic rows, ${captured.length} SQL, ${elapsed.toFixed(2)} ms`);
    if (!page.next) continue;
    const { sql, values } = captured[0];
    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const plan = await db.query(explain + sql, values);
    assert.match(JSON.stringify(plan), /brand_owner_status_created_idx/);
    assert.match(JSON.stringify(plan), /brand_version_brand_id_version_pk|sqlite_autoindex_brand_version_1/);
    console.log(`${db.kind} archive plan ${JSON.stringify(plan)}`);
    const next = await observed.archived(owner, page.next);
    assert.equal(next.items.length, 20);
    assert.ok(next.items.every((item) => !page.items.some(({ id }) => id === item.id)));
  }
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: brand isolation, history, transactions, migrations and query plans`, async () => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    try {
      const db = fixture.connection;
      const owner = await checkUpgrade(kind, fixture);
      const dao = new BrandDao(db);
      const other = randomUUID(), rollbackOwner = randomUUID(), queryOwner = randomUUID();
      for (const account of [other, rollbackOwner, queryOwner]) await addUser(db, account);
      const input = (properties, actorId = owner) => brandCommandSchema.parse({ operationId: randomUUID(), actorId, ...properties });
      const run = (command, account = owner) => executeBrandCommand(db, account, command);
      const expectError = async (command, code, account = owner) => assert.deepEqual(await run(command, account), { error: code });
      const submit = { action: "submit", target: null, expectedDraft: null, fields };
      const draft = input({ action: "saveDraft", target: null, expectedDraft: null, fields: { ...fields, name: "北" }, step: 1 });
      const saved = (await run(draft)).mutation;
      assert.equal((await dao.draft(owner, "new")).fields.name, "北");
      assert.equal(await dao.draft(other, "new"), null);
      await expectError(input({ ...submit, expectedDraft: null }), "VERSION_CONFLICT");
      const creations = Array.from({ length: 2 }, () => input({ ...submit, expectedDraft: saved.version }));
      const races = await Promise.all(creations.map((command) => run(command)));
      const winner = races.findIndex((result) => "mutation" in result);
      assert.notEqual(winner, -1);
      assert.deepEqual(races[1 - winner], { error: "LIMIT_REACHED" });
      const create = creations[winner];
      assert.deepEqual(await run(create), races[winner]);
      const { id } = races[winner].mutation;
      assert.equal(await dao.draft(owner, "new"), null);
      assert.equal((await dao.active(owner)).id, id);
      assert.equal(await dao.version(other, id), null);
      await expectError(input({ ...create, fields: { ...fields, name: "同键变更" } }), "OPERATION_CONFLICT");
      await expectError(input({ ...submit, target: { brandId: id, expectedBrandRevision: 1 } }, other), "NOT_FOUND", other);
      await expectError(create, "SESSION_CHANGED", other);
      const edit = input({ ...submit, target: { brandId: id, expectedBrandRevision: 1 }, fields: { ...fields, aliases: ["旧档不变"] } });
      const edits = await Promise.all([run(edit), run(input({ ...edit, operationId: randomUUID() }))]);
      assert.equal(edits.find((result) => "mutation" in result).mutation.entityVersion, 2);
      assert.deepEqual(edits.find((result) => "error" in result), { error: "VERSION_CONFLICT" });
      assert.deepEqual((await dao.version(owner, id, 1)).fields, fields);
      assert.deepEqual((await dao.version(owner, id)).fields.aliases, ["旧档不变"]);
      assert.equal((await run(input({ action: "archive", brandId: id, expectedBrandRevision: 2 }))).mutation.status, "archived");
      const restore = input({ action: "restore", brandId: id, expectedBrandRevision: 3 });
      const contenders = await Promise.all([run(restore), run(input(submit))]);
      assert.equal(contenders.filter((result) => "mutation" in result).length, 1);
      assert.equal(contenders.filter((result) => result.error === "LIMIT_REACHED").length, 1);
      assert.equal((await dao.version(owner, id, 1)).fields.name, fields.name);
      await assert.rejects(queryWithParameters(db, "INSERT INTO brand VALUES (?, ?, 'active', 1, 1, ?)", [randomUUID(), owner, time]));
      await assert.rejects(queryWithParameters(db, "INSERT INTO brand VALUES (?, ?, 'active', 1, 1, ?)", [randomUUID(), randomUUID(), time]));

      const rollbackDraft = input({ action: "saveDraft", target: null, expectedDraft: null, fields, step: 2 }, rollbackOwner);
      await run(rollbackDraft, rollbackOwner);
      const rollbackCreate = input({ ...submit, expectedDraft: rollbackDraft.operationId }, rollbackOwner);
      assert.match(rollbackOwner, /^[a-f0-9-]+$/);
      await db.query(`CREATE UNIQUE INDEX brand_test_failure ON brand_operation(owner_id) WHERE owner_id = '${rollbackOwner}'`);
      await assert.rejects(run(rollbackCreate, rollbackOwner));
      assert.equal(await dao.active(rollbackOwner), null);
      assert.equal((await dao.draft(rollbackOwner, "new")).version, rollbackDraft.operationId);
      await db.query("DROP INDEX brand_test_failure");
      assert.equal((await run(rollbackCreate, rollbackOwner)).mutation.status, "active");
      const operation = await dao.operation(rollbackOwner, rollbackCreate.operationId);
      assert.doesNotMatch(JSON.stringify(operation), /合成品牌|业务|example\.invalid/);

      await archiveQueryEvidence(db, queryOwner);
    } finally {
      await fixture.cleanup();
    }
  });
}
