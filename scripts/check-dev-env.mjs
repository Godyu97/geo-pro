#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import postgres from "postgres";
import { parseOfficialSamplingConfig } from "../src/lib/ai/official-sampling.ts";
import { createAiResponse, parseAiEnvironment } from "../src/lib/ai/responses.ts";
import { isEmailVerificationMocked, isMailMockEnabled } from "../src/lib/auth/verified-email.ts";
import { isRedisCacheConfigured, openCache } from "../src/lib/cache/store.ts";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { createObjectStorage, parseStorageEnvironment } from "../src/lib/storage/index.ts";

const args = new Set(process.argv.slice(2));
nextEnv.loadEnvConfig(process.cwd(), !args.has("--production"));

const env = process.env;
const database = parseDatabaseConfig(env);
const redisConfigured = isRedisCacheConfigured(env);
const storage = parseStorageEnvironment(env);
const authUrl = URL.parse(env.BETTER_AUTH_URL ?? "");
const authConfigured = authUrl && ["http:", "https:"].includes(authUrl.protocol)
  && (env.BETTER_AUTH_SECRET ?? "").trim().length >= 32;

function check(name, status, detail) {
  return { name, status, detail };
}

function configuration(name, valid, detail, missing) {
  return check(name, valid ? "ok" : "fail", valid ? detail : missing);
}

function commandOutput(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

const checks = [
  configuration("auth-config", authConfigured, "configured", "Set BETTER_AUTH_URL and BETTER_AUTH_SECRET"),
  configuration("database-config", database.success,
    database.success ? database.data.DATABASE_PROVIDER : "",
    "Set DATABASE_URL for PostgreSQL or DATABASE_PROVIDER=sqlite and SQLITE_PATH"),
  configuration("redis-config", redisConfigured, "configured", "Use Redis and set a valid redis:// REDIS_URL"),
  configuration("storage-config", storage.success, "configured",
    "Set valid S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY"),
];
if (storage.success && storage.data.browserEndpointInvalid) {
  checks.push(check("storage-browser-config", "fail", "S3_ENDPOINT_BROWSER must be a valid HTTP(S) endpoint when set"));
}

async function checkDatabase(config) {
  // Preparing a query against these tables verifies access without reading account or brand data.
  try {
    if (config.DATABASE_PROVIDER === "sqlite") {
      const db = new DatabaseSync(config.SQLITE_PATH, { readOnly: true });
      try {
        db.prepare('SELECT 1 FROM "user" LIMIT 0').all();
        db.prepare("SELECT 1 FROM brand LIMIT 0").all();
      } finally {
        db.close();
      }
    } else {
      const sql = postgres(config.DATABASE_URL, {
        max: 1, connect_timeout: 5, connection: { statement_timeout: 5000 },
      });
      try {
        await sql`SELECT 1 FROM "user" LIMIT 0`;
        await sql`SELECT 1 FROM brand LIMIT 0`;
      } finally {
        await sql.end({ timeout: 2 });
      }
    }
    return check("database-dev", "ok", `${config.DATABASE_PROVIDER}: auth and brand tables are accessible`);
  } catch {
    return check("database-dev", "fail", "Cannot read the configured database or its auth/brand tables");
  }
}

async function checkRedis() {
  const cache = openCache(env);
  const key = `geo:env-check:${randomUUID()}`;
  const stored = await cache.set(key, "ok", 10);
  const result = await cache.get(key);
  await cache.delete(key);
  const deleted = await cache.get(key);
  const valid = stored === "stored" && result.state === "hit" && result.value === "ok" && deleted.state === "miss";
  return configuration("redis-cache", valid, "write, read and delete succeeded", "Redis probe failed");
}

async function checkStorage() {
  const key = `_geo/env-check/${randomUUID()}`;
  const client = createObjectStorage({ env });
  try {
    const stored = await client.putAndReadBack({ key, body: Buffer.from("ok"), contentType: "text/plain" });
    if (stored.ok) {
      const deleted = await client.deleteObject({ key });
      if (deleted.ok) return check("object-storage", "ok", "write, read-back and delete succeeded");
    } else if (stored.cleanup !== "pending") {
      return check("object-storage", "fail", `Storage probe failed (${stored.code})`);
    }
  } catch {
    // A timeout can occur after a write, so retain the probe key for cleanup.
  }
  return check("object-storage", "fail", `Storage probe failed; check cleanup of ${key}`);
}

async function checkAi() {
  try {
    await createAiResponse({ input: "Reply with OK only.", maxOutputTokens: 16, timeoutMs: 20_000 });
    return check("ai-responses-live-probe", "ok", "Responses API responded");
  } catch {
    return check("ai-responses-live-probe", "fail", "Responses API probe failed");
  }
}

if (!args.has("--config-only")) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const pnpmVersion = commandOutput("pnpm", ["-v"]);
  const ghStatus = commandOutput("gh", ["auth", "status"]);
  const chromePath = commandOutput("which", ["google-chrome"]) || commandOutput("which", ["google-chrome-stable"]);
  const mailMock = isMailMockEnabled(env) && isEmailVerificationMocked(env);
  const ai = parseAiEnvironment(env);
  const aiReady = ai.success && Boolean(ai.data.OPENAI_MODEL);
  const official = parseOfficialSamplingConfig(env);

  checks.push(
    configuration("node", nodeMajor === 24, `v${process.versions.node}`, "Node 24 required"),
    configuration("pnpm", pnpmVersion?.startsWith("12."), `v${pnpmVersion}`, "pnpm 12 required"),
    check("email-long-term-mock", mailMock ? "ok" : "warn", mailMock ? "both mocks enabled" : "Check GEO_AUTH_MAIL_MOCK and GEO_AUTH_EMAIL_VERIFIED_MOCK"),
    configuration("ai-responses-config", aiReady, "configured", "Check OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL"),
    check("official-sampling-config", official.success ? "ok" : "warn", official.success ? "configured" : "GEO_OFFICIAL_SAMPLING_* incomplete"),
    check("chrome-e2e", chromePath ? "ok" : "warn", chromePath ? "available" : "Chrome not found"),
    configuration("gh-cli", ghStatus !== null, "authenticated", "gh not authenticated"),
  );
  const probes = [];
  if (database.success) probes.push(checkDatabase(database.data));
  if (redisConfigured) probes.push(checkRedis());
  if (storage.success) probes.push(checkStorage());
  if (args.has("--probe-ai") && aiReady) probes.push(checkAi());
  checks.push(...await Promise.all(probes));
}

const failed = checks.filter((item) => item.status === "fail").length;
const warned = checks.filter((item) => item.status === "warn").length;
if (args.has("--json")) {
  console.log(JSON.stringify({ ok: failed === 0, failed, warned, checks }, null, 2));
} else {
  const labels = { ok: "PASS", warn: "WARN", fail: "FAIL" };
  for (const item of checks) console.log(`[${labels[item.status]}] ${item.name.padEnd(26)} ${item.detail}`);
  console.log(`\nSummary: ${checks.length - failed - warned} pass, ${warned} warn, ${failed} fail`);
}
if (failed > 0) process.exitCode = 1;
