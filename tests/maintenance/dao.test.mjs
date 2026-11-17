import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { parseDatabaseConfig } from "../../src/lib/db/config.ts";
import { openSqlite } from "../../src/lib/db/sqlite.ts";
import { migrateSqlite } from "../../src/lib/db/migrate-sqlite.ts";
import { MaintenanceDao } from "../../src/features/maintenance/dao.ts";
import { changeMaintenanceGrant, readMaintenanceAccess, runMaintenanceAction } from "../../src/features/maintenance/core.ts";
import { maintenancePermissions } from "../../src/features/maintenance/contracts.ts";
import { structure, testDatabase } from "./helpers.mjs";

test("database selection is explicit and never falls back or recreates a missing SQLite file", () => {
  assert.equal(parseDatabaseConfig({ DATABASE_PROVIDER: "other" }).success, false);
  assert.equal(parseDatabaseConfig({ DATABASE_PROVIDER: "sqlite" }).success, false);
  assert.equal(parseDatabaseConfig({ DATABASE_URL: "postgresql://example.invalid/placeholder" }).data.DATABASE_PROVIDER, "postgresql");
  assert.throws(() => openSqlite(`/tmp/geo-b08-missing-${randomUUID()}.sqlite`), /must be migrated/);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: maintenance contracts, transactions, constraints and query evidence`, async (t) => {
    const fixture = await testDatabase(kind);
    const db = fixture.connection;
    const dao = new MaintenanceDao(db);
    const operatorId = randomUUID(), userId = randomUUID(), otherId = randomUUID();
    const command = (permission = "capabilities.manage", action = "grant") => ({ action, operatorId, userId, permission, reason: action === "grant" ? "initial-setup" : "offboarding" });
    try {
      for (const id of [operatorId, userId, otherId]) {
        await dao.query('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic B08 account 🚀", `${id}@example.invalid`]);
      }
      await t.test("ordinary, anonymous, missing identities and invalid CLI input are denied and audited", async () => {
        assert.equal((await readMaintenanceAccess(db, null)).reason, "session-required");
        assert.equal((await readMaintenanceAccess(db, userId)).reason, "not-granted");
        assert.equal((await readMaintenanceAccess(db, randomUUID())).reason, "session-required");
        const malformed = await changeMaintenanceGrant(db, { ...command(), role: "SUPERUSER_PRIVATE_SENTINEL" });
        assert.equal(malformed.reason, "invalid-input");
        assert.equal((await dao.query("SELECT actor_id FROM maintenance_audit WHERE id = ?", [malformed.traceId]))[0].actor_id, operatorId);
        assert.equal((await changeMaintenanceGrant(db, { ...command(), userId: randomUUID() })).reason, "account-missing");
        const fakeOperator = await changeMaintenanceGrant(db, { ...command(), operatorId: "PRIVATEALPHANUMERICTOKENSENTINEL" });
        assert.equal(fakeOperator.reason, "account-missing");
        assert.equal((await dao.query("SELECT actor_id FROM maintenance_audit WHERE id = ?", [fakeOperator.traceId]))[0].actor_id, null);
        assert.equal((await dao.query("SELECT id FROM maintenance_audit WHERE result = 'denied'")).length, 6);
      });
      await t.test("three scopes grant independently, repeat idempotently and revoke immediately", async () => {
        for (const permission of maintenancePermissions) {
          assert.equal((await changeMaintenanceGrant(db, command(permission))).status, "allowed");
          assert.equal((await readMaintenanceAccess(db, userId, permission)).status, "allowed");
          for (const ungranted of maintenancePermissions.filter((item) => item !== permission)) {
            assert.equal((await readMaintenanceAccess(db, userId, ungranted)).reason, "not-granted");
          }
          const before = await dao.query("SELECT granted_at FROM maintenance_grant WHERE user_id = ? AND permission = ?", [userId, permission]);
          assert.equal((await changeMaintenanceGrant(db, command(permission))).status, "allowed");
          assert.deepEqual(await dao.query("SELECT granted_at FROM maintenance_grant WHERE user_id = ? AND permission = ?", [userId, permission]), before);
          assert.equal((await readMaintenanceAccess(db, otherId, permission)).reason, "not-granted");
          for (let index = 0; index < 2; index++) assert.equal((await changeMaintenanceGrant(db, command(permission, "revoke"))).status, "allowed");
          assert.equal((await readMaintenanceAccess(db, userId, permission)).reason, "not-granted");
        }
        for (const permission of maintenancePermissions) await changeMaintenanceGrant(db, command(permission));
        await changeMaintenanceGrant(db, command("quotas.manage", "revoke"));
        assert.deepEqual((await readMaintenanceAccess(db, userId)).data.permissions, ["capabilities.manage", "support.read"]);
      });
      await t.test("failed protected action rolls back and persists a redacted failure", async () => {
        const result = await runMaintenanceAction(db, userId, "capability.write", async (transaction) => {
          await new MaintenanceDao(transaction).query('UPDATE "user" SET name = ? WHERE id = ?', ["MUST_ROLL_BACK", userId]);
          throw new Error("PASSWORD_TOKEN_CUSTOMER_TEXT_SENTINEL");
        });
        assert.equal(result.status, "unavailable");
        assert.equal((await dao.query('SELECT name FROM "user" WHERE id = ?', [userId]))[0].name, "Synthetic B08 account 🚀");
        assert.equal((await dao.query("SELECT result FROM maintenance_audit WHERE id = ?", [result.traceId]))[0].result, "failed");
        const all = JSON.stringify(await dao.query("SELECT * FROM maintenance_audit"));
        assert.doesNotMatch(all, /PASSWORD_TOKEN|CUSTOMER_TEXT|SUPERUSER_PRIVATE|PRIVATEALPHANUMERIC|@example/);
      });
      await t.test("audit failure rolls back a grant and a protected write", async () => {
        const failing = { ...db, transaction: (work) => db.transaction((transaction) => work({ ...transaction, query: (sql, values) => {
          if (sql.startsWith("INSERT INTO maintenance_audit") && values[5] === "allowed") throw new Error("Synthetic audit failure");
          return transaction.query(sql, values);
        } })) };
        const result = await changeMaintenanceGrant(failing, command("quotas.manage"));
        assert.equal(result.status, "unavailable");
        assert.equal((await readMaintenanceAccess(db, userId, "quotas.manage")).reason, "not-granted");
        assert.equal((await dao.query("SELECT result FROM maintenance_audit WHERE id = ?", [result.traceId]))[0].result, "failed");
        assert.equal((await runMaintenanceAction(failing, userId, "capability.write", async (transaction) => {
          await new MaintenanceDao(transaction).query('UPDATE "user" SET name = ? WHERE id = ?', ["AUDIT_MUST_ROLL_BACK", userId]);
        })).status, "unavailable");
        assert.equal((await dao.query('SELECT name FROM "user" WHERE id = ?', [userId]))[0].name, "Synthetic B08 account 🚀");
      });
      await t.test("database outage denies operations and only emits a safe trace", async (context) => {
        const log = context.mock.method(console, "error", () => {});
        const down = { ...db, query: async () => { throw new Error("PRIVATE_DATABASE_URL_SENTINEL"); }, transaction: async () => { throw new Error("PRIVATE_DATABASE_URL_SENTINEL"); } };
        let called = false;
        const result = await runMaintenanceAction(down, userId, "capability.write", async () => { called = true; });
        assert.equal(result.status, "unavailable");
        assert.equal(called, false);
        assert.equal(log.mock.callCount(), 1);
        assert.match(log.mock.calls[0].arguments[0], new RegExp(result.traceId));
        assert.doesNotMatch(JSON.stringify(log.mock.calls), /PRIVATE_DATABASE_URL/);
      });
      await t.test("concurrent grants remain unique and revocation serializes with an in-flight action", async () => {
        const grants = await Promise.all([1, 2, 3].map(() => changeMaintenanceGrant(db, command())));
        assert.ok(grants.every((result) => result.status === "allowed"));
        assert.equal((await dao.query("SELECT user_id FROM maintenance_grant WHERE user_id = ? AND permission = ?", [userId, "capabilities.manage"])).length, 1);
        let start, finish;
        const started = new Promise((resolve) => { start = resolve; });
        const released = new Promise((resolve) => { finish = resolve; });
        const action = runMaintenanceAction(db, userId, "capability.write", async () => { start(); await released; return "completed"; });
        await started;
        let revoked = false;
        const revoke = changeMaintenanceGrant(db, command("capabilities.manage", "revoke")).then((result) => { revoked = true; return result; });
        await setTimeout(20);
        assert.equal(revoked, false);
        finish();
        assert.equal((await action).status, "allowed");
        assert.equal((await revoke).status, "allowed");
        assert.equal((await runMaintenanceAction(db, userId, "capability.write", async () => assert.fail("Revoked operation must not execute"))).reason, "not-granted");
      });
      await t.test("database foreign key, permission and uniqueness constraints reject invalid rows", async () => {
        assert.equal(kind !== "sqlite" || (await db.query("PRAGMA foreign_keys"))[0].foreign_keys === 1, true);
        for (const [id, permission] of [[randomUUID(), "support.read"], [userId, "superuser"], [userId, "support.read"]]) {
          await assert.rejects(() => dao.query("INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)", [id, permission, new Date().toISOString(), operatorId]));
        }
        if (kind === "sqlite") {
          const other = openSqlite(fixture.path);
          try {
            await other.query("PRAGMA busy_timeout = 50");
            await db.transaction(async () => { await assert.rejects(() => other.transaction(async () => {}), /locked/); });
            await other.transaction(async () => {});
          } finally { await other.close(); }
          await migrateSqlite(db); // The reviewed migration history is idempotent.
        }
      });
      await t.test("fixed query count and indexed lookups at representative synthetic sizes", async () => {
        await changeMaintenanceGrant(db, command());
        const counts = [];
        for (const size of [10, 500]) {
          // Synthetic performance fixtures only, never customer/monitoring data.
          const ids = Array.from({ length: size }, () => randomUUID());
          for (let offset = 0; offset < ids.length; offset += 50) {
            const chunk = ids.slice(offset, offset + 50);
            await dao.query(`INSERT INTO "user" (id, name, email) VALUES ${chunk.map(() => "(?, ?, ?)").join(",")}`, chunk.flatMap((id) => [id, "Synthetic performance fixture", `${id}@example.invalid`]));
            await dao.query(`INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(",")}`, chunk.flatMap((id) => [id, "capabilities.manage", new Date().toISOString(), operatorId]));
            await dao.query(`INSERT INTO maintenance_audit (id, actor_id, action, result, reason, occurred_at) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(",")}`, chunk.flatMap((id) => [randomUUID(), id, "access.view", "denied", "not-granted", new Date().toISOString()]));
          }
          let count = 0;
          const observed = { ...db, transaction: (work) => db.transaction((transaction) => work({ ...transaction, query: (sql, values) => { count++; return transaction.query(sql, values); } })) };
          const began = performance.now();
          assert.equal((await readMaintenanceAccess(observed, userId)).status, "allowed");
          counts.push(count);
          console.log(JSON.stringify({ backend: kind, syntheticAddedUsers: size, statements: count, milliseconds: Number((performance.now() - began).toFixed(2)) }));
        }
        assert.deepEqual(counts, [3, 3]);
        if (kind === "postgresql") await db.query("ANALYZE maintenance_grant");
        const plan = await dao.query(`${kind === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN"} SELECT permission FROM maintenance_grant WHERE user_id = ? AND revoked_at IS NULL ORDER BY permission LIMIT 3`, [userId]);
        assert.match(JSON.stringify(plan), /INDEX|Index/);
        console.log(JSON.stringify({ backend: kind, permissionPlan: plan }));
        if (kind === "postgresql") await db.query("ANALYZE maintenance_audit");
        const auditPlan = await dao.query(`${kind === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN"} SELECT id FROM maintenance_audit WHERE actor_id = ? ORDER BY occurred_at, id LIMIT 20`, [userId]);
        assert.match(JSON.stringify(auditPlan), /maintenance_audit_actor_time_idx/);
        console.log(JSON.stringify({ backend: kind, auditPlan }));
      });
      await t.test("deleting an account removes grants and preserves minimal audit history", async () => {
        const before = (await dao.query("SELECT id FROM maintenance_audit WHERE actor_id = ?", [userId])).length;
        assert.ok(before > 0);
        await dao.query('DELETE FROM "user" WHERE id = ?', [userId]);
        assert.equal((await dao.query("SELECT user_id FROM maintenance_grant WHERE user_id = ?", [userId])).length, 0);
        assert.equal((await dao.query("SELECT id FROM maintenance_audit WHERE actor_id = ?", [userId])).length, before);
      });
    } finally { await fixture.cleanup(); }
  });

  test(`${kind}: full DDL and empty-database migrations create the same schema`, async () => {
    const migrated = await testDatabase(kind);
    const imported = await testDatabase(kind, { ddl: true });
    try {
      const a = await structure(migrated.connection), b = await structure(imported.connection);
      // SQLite stores source formatting, not just structure, in sqlite_master.
      const normalize = (value) => JSON.stringify(value).replace(/\\[nt]|\s+/g, "").replace(/`/g, '"');
      assert.equal(normalize(a), normalize(b));
    } finally { await migrated.cleanup(); await imported.cleanup(); }
  });
}

test("postgresql: existing authentication rows survive the reviewed incremental upgrade", async () => {
  const fixture = await testDatabase("postgresql", { migrateNow: false });
  const folder = await mkdtemp(join(tmpdir(), "geo-b08-baseline-"));
  try {
    await mkdir(join(folder, "meta"));
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await cp(`drizzle/${journal.entries[0].tag}.sql`, join(folder, `${journal.entries[0].tag}.sql`));
    const db = drizzle(fixture.connection.client);
    await migrate(db, { migrationsFolder: folder });
    const dao = new MaintenanceDao(fixture.connection);
    const id = randomUUID();
    await dao.query('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Existing synthetic account 🚀", `${id}@example.invalid`]);
    const before = await dao.query('SELECT * FROM "user" WHERE id = ?', [id]);
    await migrate(db, { migrationsFolder: "drizzle" });
    assert.deepEqual(await dao.query('SELECT * FROM "user" WHERE id = ?', [id]), before);
    assert.equal((await readMaintenanceAccess(fixture.connection, id)).reason, "not-granted");
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally { await fixture.cleanup(); await rm(folder, { recursive: true, force: true }); }
});

test("sqlite: the documented migration command creates and upgrades only the explicit file", async () => {
  const fixture = await testDatabase("sqlite", { migrateNow: false });
  try {
    for (let run = 0; run < 2; run++) {
      const output = execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.match(output, /SQLite migrations applied/);
    }
    assert.equal((await fixture.connection.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'maintenance_grant'")).length, 1);
    const history = await fixture.connection.query("SELECT id, hash, created_at FROM __drizzle_migrations");
    assert.equal(history.length, 1);
    await fixture.connection.query("UPDATE __drizzle_migrations SET hash = 'synthetic-invalid-checksum'");
    await assert.rejects(() => migrateSqlite(fixture.connection), /history differs/);
  } finally { await fixture.cleanup(); }
});
