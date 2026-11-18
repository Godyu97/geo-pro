import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";
import type { DatabaseConnection, QueryValue, TransactionConnection } from "./connection.ts";

export function openSqlite(filename: string, create = false) {
  const path = filename === ":memory:" ? filename : resolve(filename);
  if (!create && !existsSync(path)) throw new Error("SQLite database must be migrated before use");
  const native = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  native.exec("PRAGMA busy_timeout = 3000");
  // A transaction owns this connection until commit/rollback, including across
  // awaits. Auth statements cannot accidentally execute inside a maintenance tx.
  let pending = Promise.resolve();
  function exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const result = pending.then(work);
    pending = result.then(() => {}, () => {});
    return result;
  }
  const transaction: TransactionConnection = {
    kind: "sqlite",
    async query(sql, values: QueryValue[] = []) {
      return native.prepare(sql).all(...values);
    },
    async savepoint(work) {
      native.exec("SAVEPOINT geo_savepoint");
      try {
        const result = await work(transaction);
        native.exec("RELEASE SAVEPOINT geo_savepoint");
        return result;
      } catch (error) {
        native.exec("ROLLBACK TO SAVEPOINT geo_savepoint");
        native.exec("RELEASE SAVEPOINT geo_savepoint");
        throw error;
      }
    },
  };
  const connection: DatabaseConnection = {
    kind: "sqlite",
    query: (sql, values) => exclusive(() => transaction.query(sql, values)),
    transaction: (work) => exclusive(async () => {
      native.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(transaction);
        native.exec("COMMIT");
        return result;
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    }),
    close: () => exclusive(() => native.close()),
  };
  const proxy: AsyncRemoteCallback = (sql, params: unknown[], method) => exclusive(() => {
    const values: SQLInputValue[] = params.map((value) => {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
      throw new Error("Unsupported SQLite parameter");
    });
    const statement = native.prepare(sql);
    if (method === "run") {
      const result = statement.run(...values);
      return { rows: [], changes: Number(result.changes) };
    }
    statement.setReturnArrays(true);
    const rows = statement.all(...values).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });
  return { ...connection, proxy };
}
