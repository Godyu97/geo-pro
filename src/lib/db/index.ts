import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as sqliteDrizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import { getConnection } from "./connection.ts";
import * as schema from "./auth-schema";
import * as sqliteSchema from "./auth-schema.sqlite";

type AuthDatabase =
  | { database: PostgresJsDatabase<typeof schema>; provider: "pg"; schema: typeof schema }
  | { database: SqliteRemoteDatabase<typeof sqliteSchema>; provider: "sqlite"; schema: typeof sqliteSchema };

// Connect only when a server request needs the database. Builds and public
// pages work without database credentials or a running PostgreSQL instance.
export function getDatabase(): AuthDatabase {
  const connection = getConnection();
  return "proxy" in connection
    ? { database: sqliteDrizzle(connection.proxy, { schema: sqliteSchema }), provider: "sqlite" as const, schema: sqliteSchema }
    : { database: drizzle(connection.client, { schema }), provider: "pg" as const, schema };
}

export function withAuthDatabaseTransaction<T>(work: (database: AuthDatabase) => Promise<T>) {
  const connection = getConnection();
  if ("proxy" in connection) {
    return connection.proxyTransaction((proxy) => work({
      database: sqliteDrizzle(proxy, { schema: sqliteSchema }), provider: "sqlite", schema: sqliteSchema,
    }));
  }
  return drizzle(connection.client, { schema }).transaction((database) =>
    work({ database, provider: "pg", schema })
  );
}
