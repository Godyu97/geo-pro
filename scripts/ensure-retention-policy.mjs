import nextEnv from "@next/env";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { openConnection } from "../src/lib/db/connection.ts";
import { ensureRetentionPolicy, retentionDisclosure } from "../tests/brands/retention-setup.mjs";

nextEnv.loadEnvConfig(process.cwd());
const config = parseDatabaseConfig(process.env);
if (!config.success) throw new Error("Explicit database configuration required");
const connection = openConnection(config.data);
try {
  const version = await ensureRetentionPolicy(connection, () => new Date(), retentionDisclosure);
  console.log(String(version));
} finally {
  await connection.close();
}
