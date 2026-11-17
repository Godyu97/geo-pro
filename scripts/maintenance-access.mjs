import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { openConnection } from "../src/lib/db/connection.ts";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { changeMaintenanceGrant } from "../src/features/maintenance/core.ts";

nextEnv.loadEnvConfig(process.cwd());

try {
  const [action, operatorId, userId, permission, reason, ...extra] = process.argv.slice(2);
  const config = parseDatabaseConfig(process.env);
  if (!config.success) throw new Error("Database not configured");
  const connection = openConnection(config.data);
  try {
    const result = await changeMaintenanceGrant(connection, { action, operatorId, userId, permission, reason, ...(extra.length ? { unexpectedArguments: true } : {}) });
    console.log(JSON.stringify({ status: result.status, traceId: result.traceId, ...(result.status === "denied" ? { reason: result.reason } : {}) }));
    if (result.status !== "allowed") process.exitCode = 1;
  } finally { await connection.close(); }
} catch {
  console.error(JSON.stringify({ event: "maintenance-command-failed", traceId: randomUUID(), result: "failed" }));
  console.error("Maintenance access command failed. Usage: pnpm maintenance:access <grant|revoke> <operator-id> <user-id> <capabilities.manage|quotas.manage|support.read> <initial-setup|scope-change|access-review|offboarding|incident-response>. Check the controlled server configuration; no operation is replayed.");
  process.exitCode = 1;
}
