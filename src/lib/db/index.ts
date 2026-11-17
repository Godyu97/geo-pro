import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getAuthEnvironment } from "@/lib/auth/env";
import * as schema from "@/lib/db/auth-schema";

const globalForDatabase = globalThis as typeof globalThis & {
  geoPostgres?: ReturnType<typeof postgres>;
};

// Connect only when a server request needs the database. Builds and public
// pages work without database credentials or a running PostgreSQL instance.
export function getDatabase() {
  const { DATABASE_URL } = getAuthEnvironment();
  const client =
    globalForDatabase.geoPostgres ??
    postgres(DATABASE_URL, {
      max: 10,
      connect_timeout: 5,
      idle_timeout: 20,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.geoPostgres = client;
  }

  return drizzle(client, { schema });
}
