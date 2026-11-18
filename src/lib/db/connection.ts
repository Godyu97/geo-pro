import "server-only";

import postgres from "postgres";
import { parseDatabaseConfig, type DatabaseConfig } from "./config.ts";
import { openSqlite } from "./sqlite.ts";

export type QueryValue = string | number | null;
export type QueryRow = Record<string, unknown>;
export interface QueryConnection {
  kind: "postgresql" | "sqlite";
  query(sql: string, values?: QueryValue[]): Promise<QueryRow[]>;
}
export interface TransactionConnection extends QueryConnection {
  savepoint<T>(work: (connection: QueryConnection) => Promise<T>): Promise<T>;
}
export interface DatabaseConnection extends QueryConnection {
  transaction<T>(work: (transaction: TransactionConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function queryWithParameters(connection: QueryConnection, sql: string, values: QueryValue[] = []) {
  let parameter = 0;
  return connection.query(connection.kind === "postgresql" ? sql.replace(/\?/g, () => `$${++parameter}`) : sql, values);
}

export function openPostgres(url: string) {
  const client = postgres(url, { max: 10, connect_timeout: 5, idle_timeout: 20, connection: { statement_timeout: 5000, lock_timeout: 3000 } });
  function queries(sql: Pick<postgres.Sql, "unsafe">): QueryConnection {
    return {
      kind: "postgresql",
      async query(query, values = []) {
        return Array.from(await sql.unsafe<QueryRow[]>(query, values));
      },
    };
  }
  const connection: DatabaseConnection = {
    ...queries(client),
    async transaction(work) {
      // A wrapper keeps postgres-js's array-aware transaction return type local.
      const result = await client.begin(async (sql) => ({ value: await work({
        ...queries(sql),
        async savepoint(work) {
          const result = await sql.savepoint(async (nested) => ({ value: await work(queries(nested)) }));
          return result.value;
        },
      }) }));
      return result.value;
    },
    async close() { await client.end(); },
  };
  return { ...connection, client };
}

export function openConnection(config: DatabaseConfig, createSqlite = false) {
  return config.DATABASE_PROVIDER === "sqlite"
    ? openSqlite(config.SQLITE_PATH, createSqlite)
    : openPostgres(config.DATABASE_URL);
}

const globalForDatabase = globalThis as typeof globalThis & {
  geoDatabaseConnection?: ReturnType<typeof openConnection>;
};
let connection = globalForDatabase.geoDatabaseConnection;

export function getConnection() {
  if (connection) return connection;
  const config = parseDatabaseConfig(process.env);
  if (!config.success) throw new Error("Database configuration is incomplete");
  connection = openConnection(config.data);
  if (process.env.NODE_ENV !== "production") globalForDatabase.geoDatabaseConnection = connection;
  return connection;
}
