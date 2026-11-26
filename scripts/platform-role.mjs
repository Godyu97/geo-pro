import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { openConnection } from "../src/lib/db/connection.ts";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { changePlatformRole } from "../src/features/team-access/platform-role.ts";

nextEnv.loadEnvConfig(process.cwd());

try {
  const [action, operatorId, userId, reason, ...extra] = process.argv.slice(2);
  const config = parseDatabaseConfig(process.env);
  if (!config.success) throw new Error("Database not configured");
  const connection = openConnection(config.data);
  try {
    const result = await changePlatformRole(connection, {
      action,
      operatorId,
      userId,
      reason,
      ...(extra.length ? { unexpectedArguments: true } : {}),
    });
    console.log(JSON.stringify({
      status: result.status,
      traceId: result.traceId,
      ...(result.status === "allowed" ? result.data : {}),
      ...(result.status === "denied" ? { reason: result.reason } : {}),
    }));
    if (result.status !== "allowed") process.exitCode = 1;
  } finally {
    await connection.close();
  }
} catch {
  console.error(JSON.stringify({ event: "platform-role-command-failed", traceId: randomUUID(), result: "failed" }));
  console.error("Platform role command failed. Usage: pnpm platform:role <grant|revoke> <operator-id> <user-id> <initial-setup|scope-change|access-review|offboarding|incident-response>.");
  process.exitCode = 1;
}
