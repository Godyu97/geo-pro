#!/usr/bin/env node
/**
 * 本地开发环境一键预检脚本（绝不输出任何密钥或密码）。
 *
 * 用法：
 *   pnpm env:check
 *   node --conditions=react-server scripts/check-dev-env.mjs --probe-ai
 *   node --conditions=react-server scripts/check-dev-env.mjs --json
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import nextEnv from "@next/env";
import postgres from "postgres";
import { parseOfficialSamplingConfig } from "../src/lib/ai/official-sampling.ts";
import { createAiResponse, isAiConfigured, parseAiEnvironment } from "../src/lib/ai/responses.ts";
import { isEmailVerificationMocked, isMailMockEnabled } from "../src/lib/auth/verified-email.ts";
import { openCache } from "../src/lib/cache/store.ts";

nextEnv.loadEnvConfig(process.cwd());

const args = new Set(process.argv.slice(2));
const probeAi = args.has("--probe-ai");
const jsonOutput = args.has("--json");

const checks = [];

function record(name, status, detail) {
  checks.push({ name, status, detail });
}

function commandOutput(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

function safeTarget(rawUrl, defaultPort) {
  if (!rawUrl) return "<unset>";
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.hostname}:${u.port || defaultPort}${u.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

// 1. Node & pnpm
const nodeMajor = Number(process.versions.node.split(".")[0]);
record(
  "node",
  nodeMajor === 24 ? "ok" : "warn",
  `v${process.versions.node} (expected >=24 <25)`,
);

const pnpmVersion = commandOutput("pnpm", ["-v"]);
record("pnpm", pnpmVersion ? "ok" : "fail", pnpmVersion ? `v${pnpmVersion}` : "pnpm not found");

// 2. .env.local presence & core auth env
const hasEnvLocal = existsSync(".env.local");
record("env-local", hasEnvLocal ? "ok" : "fail", hasEnvLocal ? ".env.local present" : ".env.local missing");

const authSecretLen = (process.env.BETTER_AUTH_SECRET || "").trim().length;
record(
  "auth-config",
  process.env.BETTER_AUTH_URL && authSecretLen >= 32 ? "ok" : "fail",
  `BETTER_AUTH_URL=${process.env.BETTER_AUTH_URL || "<unset>"}, secretLen=${authSecretLen}`,
);

// 3. Long-term email mock convention
const mailMock = isMailMockEnabled(process.env);
const emailVerifiedMock = isEmailVerificationMocked(process.env);
record(
  "email-long-term-mock",
  mailMock && emailVerifiedMock ? "ok" : "warn",
  `GEO_AUTH_MAIL_MOCK=${mailMock}, GEO_AUTH_EMAIL_VERIFIED_MOCK=${emailVerifiedMock} (长期 Mock 永远成功，暂不接入真实网关)`,
);

// 4. Functional mock & public fetch switches
record(
  "dev-feature-switches",
  process.env.GEO_FUNCTIONAL_MOCK === "1" ? "ok" : "warn",
  `GEO_FUNCTIONAL_MOCK=${process.env.GEO_FUNCTIONAL_MOCK || "<unset>"}, GEO_PUBLIC_PAGE_FETCH=${process.env.GEO_PUBLIC_PAGE_FETCH || "<unset>"}`,
);

// 5. AI Responses API & Official Sampling config
const aiParsed = parseAiEnvironment(process.env);
record(
  "ai-responses-config",
  isAiConfigured(process.env) ? "ok" : "fail",
  aiParsed.success
    ? `baseUrl=${aiParsed.data.OPENAI_BASE_URL}, model=${aiParsed.data.OPENAI_MODEL || "<unset>"}, apiKey=<set>`
    : "OPENAI_BASE_URL / OPENAI_API_KEY incomplete",
);

const officialParsed = parseOfficialSamplingConfig(process.env);
record(
  "official-sampling-config",
  officialParsed.success ? "ok" : "warn",
  officialParsed.success
    ? `baseUrl=${officialParsed.data.baseUrl}, entry=${officialParsed.data.productEntry}, models=${Object.keys(officialParsed.data.priceTable.models).join(",")}`
    : "GEO_OFFICIAL_SAMPLING_* unset or invalid (adapter stays fail-closed)",
);

if (probeAi && isAiConfigured(process.env)) {
  try {
    const res = await createAiResponse({
      input: "Reply with OK only.",
      maxOutputTokens: 16,
      timeoutMs: 20_000,
    });
    record(
      "ai-responses-live-probe",
      "ok",
      `model=${res.model}, status=${res.status || "ok"}, tokens=${res.usage?.totalTokens ?? "n/a"}`,
    );
  } catch (err) {
    record("ai-responses-live-probe", "fail", err instanceof Error ? err.message : "probe failed");
  }
}

// 6. PostgreSQL dev database
if (process.env.DATABASE_URL) {
  let sql;
  try {
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    const [{ tables }] = await sql`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`;
    const migs = await sql`SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`.catch(() => [{ c: 0 }]);
    record(
      "postgres-dev",
      tables > 0 ? "ok" : "warn",
      `${safeTarget(process.env.DATABASE_URL, 5432)} (tables=${tables}, migrations=${migs[0].c})`,
    );
  } catch (err) {
    record("postgres-dev", "fail", `${safeTarget(process.env.DATABASE_URL, 5432)}: ${err instanceof Error ? err.message : "unreachable"}`);
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  }
} else {
  record("postgres-dev", "fail", "DATABASE_URL unset");
}

// 7. Compose isolated PostgreSQL (55432) for verify:dual-db
{
  const dualUrl = process.env.GEO_DUAL_DB_URL || "postgresql://geo:geo@127.0.0.1:55432/geo";
  let sql;
  try {
    sql = postgres(dualUrl, { max: 1, connect_timeout: 3 });
    await sql`SELECT 1`;
    record("postgres-dual-db", "ok", `${safeTarget(dualUrl, 55432)} ready for verify:dual-db`);
  } catch (err) {
    record("postgres-dual-db", "warn", `${safeTarget(dualUrl, 55432)} unreachable (${err instanceof Error ? err.message : "error"})`);
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  }
}

// 8. SQLite built-in runtime
try {
  const db = new DatabaseSync(":memory:");
  db.exec("SELECT 1");
  db.close();
  record("sqlite-runtime", "ok", "node:sqlite available");
} catch (err) {
  record("sqlite-runtime", "fail", err instanceof Error ? err.message : "node:sqlite unavailable");
}

// 9. Redis cache
{
  const cache = openCache(process.env);
  const probeKey = `geo:env-check:${Date.now()}`;
  const setStatus = await cache.set(probeKey, "ok", 10);
  const getResult = await cache.get(probeKey);
  await cache.delete(probeKey);
  const ok = setStatus === "stored" && getResult.state === "hit";
  record(
    "redis-cache",
    ok ? "ok" : "warn",
    `driver=${cache.driver}, target=${safeTarget(process.env.REDIS_URL, 6379)}, probe=${ok ? "read/write ok" : getResult.state}`,
  );
}

// 10. Browser (Chrome for Playwright) & GitHub CLI
const chromePath = commandOutput("which", ["google-chrome"]) || commandOutput("which", ["google-chrome-stable"]);
record("chrome-e2e", chromePath ? "ok" : "warn", chromePath || "google-chrome not found");

const ghStatus = commandOutput("gh", ["auth", "status"]);
record("gh-cli", ghStatus !== null ? "ok" : "fail", ghStatus !== null ? "authenticated" : "gh not authenticated");

const failed = checks.filter((c) => c.status === "fail");
const warned = checks.filter((c) => c.status === "warn");

if (jsonOutput) {
  console.log(JSON.stringify({ ok: failed.length === 0, failed: failed.length, warned: warned.length, checks }, null, 2));
} else {
  const icon = { ok: "PASS", warn: "WARN", fail: "FAIL" };
  for (const item of checks) {
    console.log(`[${icon[item.status]}] ${item.name.padEnd(26)} ${item.detail}`);
  }
  console.log(`\nSummary: ${checks.length - failed.length - warned.length} pass, ${warned.length} warn, ${failed.length} fail`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
