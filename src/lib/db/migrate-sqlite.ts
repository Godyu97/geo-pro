import "server-only";

import { readMigrationFiles } from "drizzle-orm/migrator";
import type { DatabaseConnection } from "./connection.ts";

// Drizzle's journal/parser and checksums, executed atomically with node:sqlite.
// A separate driver dependency is unnecessary for this local database backend.
export async function migrateSqlite(connection: DatabaseConnection, folder = "drizzle/sqlite") {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  await connection.transaction(async (transaction) => {
    await transaction.query('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id integer PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric NOT NULL)');
    const applied = await transaction.query('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at');
    for (const entry of applied) {
      if (!migrations.some((migration) => migration.folderMillis === Number(entry.created_at) && migration.hash === entry.hash)) {
        throw new Error("SQLite migration history differs from the reviewed migrations");
      }
    }
    const latest = Number(applied.at(-1)?.created_at ?? 0);
    for (const migration of migrations) {
      if (migration.folderMillis <= latest) continue;
      for (const sql of migration.sql) await transaction.query(sql);
      await transaction.query('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)', [migration.hash, migration.folderMillis]);
    }
  });
}
