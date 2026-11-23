import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { pruneMailRate, reserveMailRequest } from "../src/features/account/email/dao.ts";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { queryWithParameters as query } from "../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../tests/maintenance/helpers.mjs";
import { ensureRetentionPolicy } from "../tests/brands/retention-setup.mjs";

const base = "http://localhost:3117";
const sourceHeader = "x-geo-mail-ip";
const mailPath = "/api/account-email";
const mailSecret = randomBytes(48).toString("base64url");
const inbox = new Map();
const rejectedMail = new Set();
let phase = "setup";
let sourceNumber = 0;
const source = () => `198.51.100.${++sourceNumber}`;
const emailAddress = () => `b17-${randomUUID()}@example.invalid`;
const password = () => randomBytes(24).toString("base64url");

const gateway = createServer(async (request, response) => {
  if (request.method !== "POST" || request.headers.authorization !== `Bearer ${mailSecret}`) {
    response.writeHead(403).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const mail = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  inbox.set(mail.traceId, mail);
  response.writeHead(rejectedMail.has(mail.to) ? 503 : 202).end();
});

function request(path, { data, actor, ip, locale = "en", origin = base } = {}) {
  return fetch(new URL(path, base), {
    method: data === undefined ? "GET" : "POST", redirect: "manual",
    headers: {
      Origin: origin, Cookie: [actor?.cookie, "geo-locale=" + locale].filter(Boolean).join("; "),
      ...(ip ? { [sourceHeader]: ip } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

function cookie(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function waitForAuthWindow(retryAfter) {
  const seconds = Number(retryAfter);
  assert.ok(seconds > 0 && seconds <= 10, "Known login rate-limit window");
  await setTimeout((seconds + 1) * 1000);
}

async function account(email = emailAddress()) {
  const original = password();
  const register = () => request("/api/auth/sign-up/email", { data: { name: "Synthetic B17 owner", email, password: original } });
  let response = await register();
  if (response.status === 429) {
    await waitForAuthWindow(response.headers.get("x-retry-after"));
    response = await register();
  }
  assert.equal(response.status, 200, "Disposable account registration");
  return { id: (await response.json()).user.id, email, original, cookie: cookie(response) };
}

async function login(actor, value = actor.original, status = 200) {
  const signIn = () => request("/api/auth/sign-in/email", { data: { email: actor.email, password: value } });
  let response = await signIn();
  if (response.status === 429) {
    await waitForAuthWindow(response.headers.get("x-retry-after"));
    response = await signIn();
  }
  assert.equal(response.status, status, "Credential result");
  return { ...actor, cookie: cookie(response) };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = check();
    if (value) return value;
    await setTimeout(50);
  }
  throw new Error("Timed out waiting for the expected fixture event");
}

async function outcome(response, status, expected) {
  assert.equal(response.status, status, "Account mail HTTP status");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.outcome, expected);
  return body;
}

function ask(kind, email, options = {}) {
  return request(mailPath, { ip: source(), ...options, data: { action: "request", kind, email, returnTo: options.returnTo } });
}

async function link(kind, actor, options) {
  const { traceId } = await outcome(await ask(kind, actor.email, options), 202, "accepted");
  const mail = await waitFor(() => inbox.get(traceId));
  assert.equal(mail.to === actor.email, true, "Link recipient is the intended account");
  const landing = new URL(mail.text.split("\n").at(-1));
  assert.equal(landing.origin, base);
  assert.equal(landing.searchParams.has("token"), false);
  assert.match(mail.text, kind === "verify" ? /24/ : /one hour|一小时/);
  return { landing, token: new URLSearchParams(landing.hash.slice(1)).get("token") };
}

function confirm(action, token, actor, newPassword = password()) {
  return request(mailPath, { actor, data: { action, token, ...(action === "reset" ? { password: newPassword } : {}) } });
}

function altered(token) {
  return (token.startsWith("a") ? "b" : "a") + token.slice(1);
}

async function expire(fixture, action, token) {
  const prefix = action === "verify" ? "geo-email-verification:" : "reset-password:";
  const id = createHash("sha256").update(prefix + token).digest("base64url");
  const schema = fixture.connection.kind;
  const [row] = await query(fixture.connection, "SELECT created_at, expires_at FROM verification WHERE identifier = ?", [id]);
  assert.ok(row, "The token is indexed by its digest");
  const time = (value) => schema === "sqlite" ? Number(value) : new Date(value).getTime();
  const actual = time(row.expires_at) - time(row.created_at);
  assert.ok(Math.abs(actual - (action === "verify" ? 86400 : 3600) * 1000) < 2000, "Configured link lifetime");
  const expired = schema === "sqlite" ? 1 : "2000-01-01T00:00:00.000Z";
  await query(fixture.connection, "UPDATE verification SET expires_at = ? WHERE identifier = ?", [expired, id]);
}

async function rejectPasswordWrite(connection) {
  if (connection.kind === "sqlite") {
    await connection.query(`CREATE TRIGGER fixture_reject_password BEFORE UPDATE OF password ON account
      BEGIN SELECT RAISE(ABORT, 'Fixture rejects password update'); END`);
  } else {
    await connection.query(`CREATE FUNCTION fixture_reject_password() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'Fixture rejects password update'; END; $$`);
    await connection.query(`CREATE TRIGGER fixture_reject_password BEFORE UPDATE OF password ON account
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_password()`);
  }
  return () => connection.query(connection.kind === "sqlite"
    ? "DROP TRIGGER fixture_reject_password"
    : "DROP TRIGGER fixture_reject_password ON account");
}

async function quotas(kind) {
  const allowed = kind === "verify" ? 3 : 5;
  const missing = emailAddress();
  const multipleIPs = await Promise.all(Array.from({ length: allowed + 1 }, (_, index) =>
    ask(kind, index % 2 ? missing.toUpperCase() : missing)));
  assert.equal(multipleIPs.filter((result) => result.status === 202).length, allowed);
  const limited = multipleIPs.find((result) => result.status === 429);
  await outcome(limited, 429, "rateLimited");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  const ip = source();
  const fromIP = await Promise.all(Array.from({ length: allowed + 1 }, () => ask(kind, emailAddress(), { ip })));
  assert.equal(fromIP.filter((result) => result.status === 202).length, allowed);
  await outcome(fromIP.find((result) => result.status === 429), 429, "rateLimited");
  await outcome(await ask(kind === "verify" ? "reset" : "verify", missing, { ip }), 202, "accepted");
}

async function verifyRateStorage(connection) {
  const start = Date.now() - 4_000_000;
  const params = ["verify", emailAddress(), source(), mailSecret];
  for (const offset of [0, 15 * 60_000, 30 * 60_000]) {
    assert.equal(await reserveMailRequest(connection, ...params, start + offset), 0);
  }
  assert.equal(await reserveMailRequest(connection, ...params, start + 3_599_999), 1);
  assert.equal(await reserveMailRequest(connection, ...params, start + 3_600_000), 0);
  assert.equal(await reserveMailRequest(connection, ...params, start + 3_600_001), 900);
  await query(connection, `WITH RECURSIVE sample(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM sample WHERE n < 1000
  ) INSERT INTO auth_mail_rate (key, attempts, expires_at)
    SELECT 'sample-' || CAST(n AS text), '[]', CASE WHEN n < 100 THEN 1 ELSE 9999999999999 END FROM sample`);
  await connection.query("ANALYZE auth_mail_rate");
  const explain = connection.kind === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN (COSTS OFF)";
  const cleanup = await query(connection, `${explain} SELECT key FROM auth_mail_rate
    WHERE expires_at <= ? ORDER BY expires_at LIMIT 32
    ${connection.kind === "postgresql" ? "FOR UPDATE SKIP LOCKED" : ""}`, [1]);
  assert.match(JSON.stringify(cleanup), /auth_mail_rate_expiry_idx/);
  const lookup = await query(connection, `${explain} SELECT attempts FROM auth_mail_rate WHERE key IN (?, ?)`, ["sample-1", "sample-2"]);
  assert.match(JSON.stringify(lookup), /auth_mail_rate_pkey|sqlite_autoindex_auth_mail_rate/);
  await pruneMailRate(connection, 1);
  const [{ remaining }] = await connection.query("SELECT count(*) AS remaining FROM auth_mail_rate WHERE expires_at <= 1");
  assert.equal(Number(remaining), 67, "Cleanup is limited to one batch");
  console.log(`PASS: ${connection.kind} rolling window, primary key and expiry index with 1,000 synthetic rows`);
}

async function verifyHTTP(fixture, logs) {
  const owner = await account();
  const stranger = await account();
  const secondSession = await login(owner);
  assert.notEqual(secondSession.cookie, owner.cookie);
  const brandAPI = (actor, data) => request("/api/brands", { actor, data: { actorId: actor?.id ?? owner.id, operationId: randomUUID(), ...data } });
  const brandError = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  };

  phase = "create and freeze a brand under an unverified owner";
  const created = await brandAPI(owner, {
    action: "submit", target: null, expectedDraft: null,
    acceptedPolicyVersion: await ensureRetentionPolicy(fixture.connection),
    fields: { ...initialBrandFields, name: "Synthetic B17 brand", description: "Isolated email recovery fixture" },
  });
  assert.equal(created.status, 200);
  const brand = await created.json();
  const freeze = await brandAPI(owner, { action: "freeze", brandId: brand.id, expectedBrandRevision: brand.revision, confirmed: true });
  assert.equal(freeze.status, 200);
  const recover = { action: "recover", brandId: brand.id, expectedBrandRevision: (await freeze.json()).revision };
  await brandError(await brandAPI(owner, recover), 403, "IDENTITY_UNVERIFIED");

  phase = "uniform acceptance, gateway failure and unavailable configuration";
  rejectedMail.add(owner.email);
  for (const kind of ["verify", "reset"]) {
    const missing = await outcome(await ask(kind, emailAddress()), 202, "accepted");
    const rejected = await outcome(await ask(kind, owner.email), 202, "accepted");
    assert.deepEqual(Object.keys(rejected), Object.keys(missing));
    await waitFor(() => logs().includes(rejected.traceId) && logs().includes("account-mail-failed"));
    assert.equal(inbox.has(missing.traceId), false);
    const failed = inbox.get(rejected.traceId);
    assert.equal(Boolean(failed), true);
    const failedLink = new URL(failed.text.split("\n").at(-1));
    const failedToken = new URLSearchParams(failedLink.hash.slice(1)).get("token");
    assert.ok(failedToken);
    assert.equal(logs().includes(failedToken), false);
    assert.equal(logs().includes(owner.email), false);
  }
  rejectedMail.delete(owner.email);
  await outcome(await ask("reset", owner.email, { ip: null }), 503, "unavailable");
  await outcome(await ask("reset", owner.email, { ip: "198.51.100.50, 127.0.0.1" }), 503, "unavailable");
  await outcome(await ask("reset", owner.email, { origin: "https://external.invalid" }), 403, "invalidInput");
  for (const path of ["send-verification-email", "request-password-reset", "reset-password", "verify-email"]) {
    assert.equal((await request("/api/auth/" + path, { data: path === "verify-email" ? undefined : { email: owner.email } })).status, 404);
  }

  phase = "expiring, rejecting and consuming verification links";
  const expired = await link("verify", owner);
  await expire(fixture, "verify", expired.token);
  await outcome(await confirm("verify", expired.token), 400, "invalidLink");
  const verification = await link("verify", owner, { returnTo: "https://external.invalid" });
  assert.equal(verification.landing.searchParams.get("returnTo"), "/dashboard");
  await outcome(await confirm("verify", altered(verification.token)), 400, "invalidLink");
  await outcome(await confirm("verify", verification.token, stranger), 400, "invalidLink");
  const consumers = await Promise.all([confirm("verify", verification.token, owner), confirm("verify", verification.token)]);
  assert.deepEqual(consumers.map(({ status }) => status).sort(), [200, 400]);
  await outcome(consumers.find(({ status }) => status === 200), 200, "verified");
  assert.equal(consumers.every((response) => !response.headers.has("set-cookie")), true);
  await outcome(await confirm("verify", verification.token), 400, "invalidLink");
  const session = await request("/api/auth/get-session", { actor: owner });
  assert.equal((await session.json()).user.emailVerified, true);
  await brandError(await brandAPI(owner, recover), 403, "REAUTH_REQUIRED");

  phase = "reset expiration, account binding and old session revocation";
  const expiredReset = await link("reset", owner);
  await expire(fixture, "reset", expiredReset.token);
  await outcome(await confirm("reset", expiredReset.token), 400, "invalidLink");
  const reset = await link("reset", owner);
  await outcome(await confirm("reset", altered(reset.token)), 400, "invalidLink");
  await outcome(await confirm("reset", reset.token, stranger), 400, "invalidLink");
  const newPassword = password();
  const unblock = await rejectPasswordWrite(fixture.connection);
  try {
    await outcome(await confirm("reset", reset.token, owner, newPassword), 503, "unavailable");
    assert.equal((await (await request("/api/auth/get-session", { actor: secondSession })).json()).user.id, owner.id);
  } finally {
    await unblock();
  }
  const [overlappingLogin, ...resetConsumers] = await Promise.all([
    request("/api/auth/sign-in/email", { data: { email: owner.email, password: owner.original } }),
    confirm("reset", reset.token, owner, newPassword),
    confirm("reset", reset.token, undefined, newPassword),
  ]);
  assert.deepEqual(resetConsumers.map(({ status }) => status).sort(), [200, 400]);
  await outcome(resetConsumers.find(({ status }) => status === 200), 200, "passwordUpdated");
  await outcome(await confirm("reset", reset.token), 400, "invalidLink");
  await login(owner, owner.original, 401);
  assert.ok([200, 401].includes(overlappingLogin.status), "Old login races with the reset");
  if (overlappingLogin.ok) {
    const actor = { cookie: cookie(overlappingLogin) };
    assert.equal(await (await request("/api/auth/get-session", { actor })).json(), null);
  }
  for (const actor of [owner, secondSession]) {
    assert.equal(await (await request("/api/auth/get-session", { actor })).json(), null);
    await brandError(await brandAPI(actor, recover), 401, "SESSION_REQUIRED");
  }
  assert.equal((await (await request("/api/auth/get-session", { actor: stranger })).json()).user.emailVerified, false);
  const restoredIdentity = await login(owner, newPassword);
  await brandError(await request("/api/brands?id=" + brand.id, { actor: restoredIdentity }), 404, "NOT_FOUND");
  const restored = await brandAPI(restoredIdentity, recover);
  assert.equal(restored.status, 200, "B06 explicitly restores after verified owner reauthentication");
  assert.equal((await restored.json()).restoreUntil, null);

  phase = "deleted account links cannot affect a new account for the same email";
  const oldVerification = await link("verify", stranger);
  const oldReset = await link("reset", stranger);
  await query(fixture.connection, 'DELETE FROM "user" WHERE id = ?', [stranger.id]);
  const replacement = await account(stranger.email);
  assert.notEqual(replacement.id, stranger.id);
  await outcome(await confirm("verify", oldVerification.token), 400, "invalidLink");
  await outcome(await confirm("reset", oldReset.token), 400, "invalidLink");
  assert.equal((await (await request("/api/auth/get-session", { actor: replacement })).json()).user.emailVerified, false);

  phase = "concurrent independent account and IP quotas";
  await quotas("verify");
  await quotas("reset");
}

async function verifyBrowser() {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    for (const locale of ["zh-CN", "en"]) {
      const en = locale === "en";
      const actor = await account();
      const context = await browser.newContext({ baseURL: base, extraHTTPHeaders: { [sourceHeader]: source() } });
      try {
        await context.addCookies([{ name: "geo-locale", value: locale, url: base }]);
        const page = await context.newPage();
        const target = "/dashboard/settings?tab=security#security";
        phase = `${locale}: bilingual email forms at 375, 768 and 1440 pixels`;
        const verification = await link("verify", actor, { locale, returnTo: target });
        const reset = await link("reset", actor, { locale, returnTo: target });
        for (const width of [1440, 768, 375]) {
          phase = `${locale}: password request at ${width}px`;
          await page.setViewportSize({ width, height: 900 });
          await page.goto("/login?" + new URLSearchParams({ returnTo: target }));
          await page.getByRole("link", { name: en ? "Forgot your password?" : "忘记密码？" }).press("Enter");
          await expect(page.getByRole("heading", { name: en ? "Forgot your password?" : "忘记密码？" })).toBeVisible();
          await page.getByRole("button", { name: en ? "Request email link" : "申请邮件链接" }).press("Enter");
          await expect(page.getByText(en ? "Enter a valid email address" : "请输入有效的邮箱地址", { exact: true })).toBeVisible();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
          phase = `${locale}: verification link at ${width}px`;
          await page.goto(verification.landing.href);
          await expect(page.getByRole("button", { name: en ? "Confirm email" : "确认邮箱" })).toBeVisible();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
          phase = `${locale}: password reset link at ${width}px`;
          await page.goto(reset.landing.href);
          await expect(page.getByLabel(en ? "New password" : "新密码")).toBeVisible();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        }
        phase = `${locale}: email request, language change, confirmation and safe return`;
        const requestMail = async (mode, address) => {
          await page.goto("/account-access?" + new URLSearchParams({ mode, returnTo: target }));
          await page.getByLabel(en ? "Email" : "邮箱", { exact: true }).fill(address);
          await page.getByRole("button", { name: en ? "Request email link" : "申请邮件链接" }).press("Enter");
          await expect(page.getByRole("status")).toContainText(en ? "Request received" : "请求已受理");
        };
        await requestMail("verify", actor.email);
        await requestMail("forgot", actor.email);
        await page.goto(verification.landing.href);
        const switcher = page.getByRole("combobox");
        await switcher.selectOption(en ? "zh-CN" : "en");
        await expect(page.locator("html")).toHaveAttribute("lang", en ? "zh-CN" : "en");
        await switcher.selectOption(locale);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.getByRole("button", { name: en ? "Confirm email" : "确认邮箱" }).press("Enter");
        await expect(page.getByRole("status")).toHaveText(en ? "Your email is verified." : "邮箱验证成功。");
        assert.equal(new URL(page.url()).hash, "");
        await page.goto(verification.landing.href);
        await page.getByRole("button", { name: en ? "Confirm email" : "确认邮箱" }).press("Enter");
        await expect(page.getByRole("status")).toContainText(en ? "This link is invalid" : "此链接无效");
        await page.goto(reset.landing.href);
        const resetButton = page.getByRole("button", { name: en ? "Update password" : "更新密码" });
        await resetButton.press("Enter");
        await expect(page.getByText(en ? "Use at least 8 characters for your password" : "密码至少需要 8 个字符", { exact: true })).toBeVisible();
        const newPassword = password();
        await page.getByLabel(en ? "New password" : "新密码").fill(newPassword);
        await resetButton.press("Enter");
        await expect(page.getByRole("status")).toContainText(en ? "Your password was updated" : "密码已更新");
        assert.equal(new URL(page.url()).hash, "");
        await page.getByRole("link", { name: en ? "Continue to sign in" : "继续登录" }).press("Enter");
        await page.waitForURL(url => url.pathname === "/login");
        assert.equal(new URL(page.url()).searchParams.get("returnTo"), target);
        await page.getByLabel(en ? "Email" : "邮箱", { exact: true }).fill(actor.email);
        await page.getByLabel(en ? "Password" : "密码", { exact: true }).fill(newPassword);
        const button = page.getByRole("button", { name: en ? "Sign in and open workspace" : "登录并进入工作台" });
        const submitLogin = async () => {
          const result = page.waitForResponse((response) =>
            response.url().endsWith("/api/auth/sign-in/email") && response.request().method() === "POST"
          );
          await button.press("Enter");
          return result;
        };
        let signedIn = await submitLogin();
        if (signedIn.status() === 429) {
          await waitForAuthWindow(signedIn.headers()["x-retry-after"]);
          signedIn = await submitLogin();
        }
        assert.equal(signedIn.status(), 200, "Browser login with the new password");
        await expect(page.getByRole("heading", { name: en ? "Account settings" : "账户设置", exact: true })).toBeVisible();
        assert.equal(new URL(page.url()).search + new URL(page.url()).hash, "?tab=security#security");
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function withApplication(fixture, configured, work) {
  const { port } = gateway.address();
  const env = {
    ...process.env, ...fixture.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    GEO_BRANDS_FIXTURE: "1", GEO_AUTH_MAIL_MOCK: "false", GEO_AUTH_EMAIL_VERIFIED_MOCK: "false",
    GEO_AUTH_MAIL_URL: configured ? `http://127.0.0.1:${port}/send` : "",
    GEO_AUTH_MAIL_SECRET: mailSecret, GEO_AUTH_MAIL_IP_HEADER: sourceHeader,
  };
  const app = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", "3117"], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [app.stdout, app.stderr]) stream.on("data", (chunk) => { log = (log + chunk).slice(-32_000); });
  const stopped = once(app, "exit");
  try {
    await waitFor(() => log.includes("Ready"));
    await work(() => log, env);
  } finally {
    app.kill("SIGTERM");
    await stopped;
  }
}

try {
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  for (const kind of ["sqlite", "postgresql"]) {
    phase = kind + " incremental migration";
    const fixture = await testDatabase(kind, { migrateNow: false });
    try {
      await migrateThrough(fixture.connection, kind === "sqlite" ? "0005_windy_silhouette" : "0006_slippery_senator_kelly");
      const migrated = spawn("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "ignore" });
      assert.equal((await once(migrated, "exit"))[0], 0, "Isolated database migration");
      phase = kind + " quota storage and query plans";
      await verifyRateStorage(fixture.connection);
      await withApplication(fixture, true, async (logs) => {
        await verifyHTTP(fixture, logs);
        console.log(`PASS: ${kind} mail delivery, one-time links, dual limits, session revocation and B06 recovery`);
        if (kind === "postgresql") {
          await verifyBrowser();
          console.log("PASS: Chrome zh-CN/en email request, verification, reset and re-login at 375/768/1440 px");
        }
      });
      phase = kind + " disabled mail environment";
      await withApplication(fixture, false, async () => {
        await outcome(await ask("verify", emailAddress()), 503, "unavailable");
        await outcome(await ask("reset", emailAddress()), 503, "unavailable");
      });
      console.log(`PASS: ${kind} unconfigured delivery returns a safe error`);
    } finally {
      await fixture.cleanup();
    }
  }
} catch (error) {
  // Assertion output may otherwise include a login secret or an unconsumed link.
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[\w-]{24,}/g, "[redacted]").split("\n").slice(0, 10).join("\n");
  console.error(`FAIL: ${phase} (${message})`);
  process.exitCode = 1;
} finally {
  gateway.close();
}
