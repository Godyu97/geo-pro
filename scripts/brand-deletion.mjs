import nextEnv from "@next/env";
import { shortenBrandRecoveryDeadline } from "../src/features/brands/commands.ts";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { openConnection } from "../src/lib/db/connection.ts";

nextEnv.loadEnvConfig(process.cwd());

try {
  const [ownerId, brandId, operatorId, requestId, revision, restoreUntil, ...extra] = process.argv.slice(2);
  const config = parseDatabaseConfig(process.env);
  if (!config.success || extra.length || !/^[1-9]\d*$/.test(revision)) throw new Error("Invalid CLI input");
  const connection = openConnection(config.data);
  try {
    const result = await shortenBrandRecoveryDeadline(connection, {
      ownerId, brandId, operatorId, requestId, expectedBrandRevision: Number(revision), restoreUntil,
    });
    if ("error" in result) {
      console.error(JSON.stringify({ error: result.error }));
      process.exitCode = 1;
    } else {
      const { id, revision, restoreUntil } = result.mutation;
      console.log(JSON.stringify({ id, revision, restoreUntil }));
    }
  } finally {
    await connection.close();
  }
} catch {
  console.error("Controlled server use only. Usage: pnpm brands:shorten-recovery <owner-id> <brand-id> <operator-id> <approved-request-uuid> <expected-revision> <utc-iso-deadline-with-milliseconds>");
  process.exitCode = 1;
}
