import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import { drizzle as sqliteDrizzle } from "drizzle-orm/sqlite-proxy";

import { getConnection } from "./connection.ts";
import * as schema from "./auth-schema";
import * as sqliteSchema from "./auth-schema.sqlite";

// Connect only when a server request needs the database. Builds and public
// pages work without database credentials or a running PostgreSQL instance.
export function getDatabase() {
  const connection = getConnection();
  return "proxy" in connection
    ? { database: sqliteDrizzle(connection.proxy, { schema: sqliteSchema }), provider: "sqlite" as const, schema: sqliteSchema }
    : { database: drizzle(connection.client, { schema }), provider: "pg" as const, schema };
}
