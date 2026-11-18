import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nextEnv from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { openPostgres } from "../../src/lib/db/connection.ts";
import { openSqlite } from "../../src/lib/db/sqlite.ts";
import { migrateSqlite } from "../../src/lib/db/migrate-sqlite.ts";

nextEnv.loadEnvConfig(process.cwd());

export async function testDatabase(kind, { ddl = false, migrateNow = true } = {}) {
  if (kind === "sqlite") {
    const directory = await mkdtemp(join(tmpdir(), "geo-b08-"));
    const path = join(directory, "test.sqlite");
    const connection = openSqlite(path, true);
    const fixture = { connection, path, env: { DATABASE_PROVIDER: "sqlite", SQLITE_PATH: path }, cleanup: async () => {
      await connection.close();
      await rm(directory, { recursive: true, force: true });
    } };
    try {
      if (ddl) await importDdl(connection);
      else if (migrateNow) await migrateSqlite(connection);
      return fixture;
    } catch (error) { await fixture.cleanup(); throw error; }
  }
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Maintenance tests only use local PostgreSQL");
  const admin = postgres(url.href, { max: 1, connect_timeout: 5 });
  const database = `geo_b08_${randomBytes(8).toString("hex")}`;
  // The only dropped database is the random database this fixture just created.
  assert.match(database, /^geo_b08_[a-f0-9]{16}$/);
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const connection = openPostgres(url.href);
  const fixture = { connection, env: { DATABASE_PROVIDER: "postgresql", DATABASE_URL: url.href }, cleanup: async () => {
    try {
      await connection.close();
      await admin.unsafe(`DROP DATABASE "${database}"`);
    } finally { await admin.end(); }
  } };
  try {
    if (ddl) await importDdl(connection);
    else if (migrateNow) await migrate(drizzle(connection.client), { migrationsFolder: "drizzle" });
    return fixture;
  } catch (error) { await fixture.cleanup(); throw error; }
}

async function importDdl(connection) {
  const source = await readFile(`drizzle/ddl/${connection.kind}.sql`, "utf8");
  const statements = source.replace(/^--.*$/gm, "").split(";").map((sql) => sql.trim()).filter(Boolean);
  await connection.transaction(async (transaction) => {
    for (const statement of statements) await transaction.query(statement);
  });
}

export async function migrateThrough(connection, lastTag) {
  const source = connection.kind === "sqlite" ? "drizzle/sqlite" : "drizzle";
  const directory = await mkdtemp(join(tmpdir(), "geo-migration-baseline-"));
  try {
    const journal = JSON.parse(await readFile(join(source, "meta/_journal.json"), "utf8"));
    const last = journal.entries.findIndex(({ tag }) => tag === lastTag);
    assert.notEqual(last, -1, `Unknown migration ${lastTag}`);
    journal.entries = journal.entries.slice(0, last + 1);
    await mkdir(join(directory, "meta"));
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries) await cp(join(source, tag + ".sql"), join(directory, tag + ".sql"));
    if (connection.kind === "sqlite") await migrateSqlite(connection, directory);
    else await migrate(drizzle(connection.client), { migrationsFolder: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function structure(connection) {
  if (connection.kind === "postgresql") {
    return {
      columns: await connection.query("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"),
      constraints: await connection.query("SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname"),
      indexes: await connection.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname"),
    };
  }
  return connection.query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY type, name");
}
