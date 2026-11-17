import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { MaintenanceDao } from "../src/features/maintenance/dao.ts";
import { maintenancePermissions } from "../src/features/maintenance/contracts.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const execute = promisify(execFile);
const baseURL = "http://localhost:3103";
let phase = "production build prerequisite";

async function request(path, { cookie, method = "GET", body, headers = {} } = {}) {
  const send = () => fetch(new URL(path, baseURL), {
    method, redirect: "manual",
    headers: { Origin: baseURL, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let response = await send();
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
    assert.ok(retry > 0 && retry <= 10, "Authentication limiter must provide a bounded retry");
    await setTimeout((retry + 1) * 1000);
    response = await send();
  }
  return response;
}

async function account(name) {
  const email = `b08-${randomBytes(10).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const response = await request("/api/auth/sign-up/email", { method: "POST", body: { name, email, password } });
  assert.equal(response.status, 200, "Disposable account registration");
  const id = (await response.json()).user.id;
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.includes("session_token="), "Real authentication cookie is required");
  return { id, cookie, email, password };
}

async function verify(kind) {
  const fixture = await testDatabase(kind);
  const dao = new MaintenanceDao(fixture.connection);
  const env = { ...process.env, ...fixture.env, BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") };
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", "3103"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", exited = false;
  child.stdout.on("data", (data) => { output = (output + data).slice(-64_000); });
  child.stderr.on("data", (data) => { output = (output + data).slice(-64_000); });
  child.once("exit", () => { exited = true; });
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  try {
    phase = `${kind}: owned production server startup`;
    for (let attempt = 0; attempt < 200 && !output.includes("Ready"); attempt++) {
      assert.equal(exited, false, "Owned Next.js server must stay running");
      await setTimeout(100);
    }
    assert.ok(output.includes("Ready"), "Owned Next.js server must become ready");
    assert.equal((await request("/api/health")).status, 200);
    phase = `${kind}: direct API and role spoofing`;
    for (const cookie of [undefined, "better-auth.session_token=forged.invalid; role=superuser"]) {
      assert.equal((await request("/api/maintenance/access", { cookie })).status, 401);
    }
    const operator = await account("Synthetic project owner");
    const maintainer = await account("Synthetic separate maintainer 🚀");
    const customer = await account("PRIVATE_CUSTOMER_TEXT_SENTINEL");
    assert.equal((await request("/api/maintenance/access", { cookie: maintainer.cookie, headers: { "X-Role": "superuser", "X-User-Id": operator.id } })).status, 403);
    for (const query of [`role=superuser`, `userId=${customer.id}`, "permission=support.read&permission=capabilities.manage", "permission=superuser"]) {
      assert.equal((await request(`/api/maintenance/access?${query}`, { cookie: maintainer.cookie })).status, 400);
    }
    const change = async (action, permission) => {
      const { stdout } = await execute(process.execPath, ["--conditions=react-server", "scripts/maintenance-access.mjs", action, operator.id, maintainer.id, permission, action === "grant" ? "initial-setup" : "offboarding"], { env });
      assert.equal(JSON.parse(stdout.trim()).status, "allowed", "Controlled server CLI changes access");
    };
    phase = `${kind}: three independent scopes and immediate revocation`;
    for (const permission of maintenancePermissions) {
      await change("grant", permission);
      for (const checked of maintenancePermissions) {
        const response = await request(`/api/maintenance/access?permission=${checked}`, { cookie: maintainer.cookie });
        assert.equal(response.status, permission === checked ? 200 : 403);
        assert.match(response.headers.get("cache-control"), /no-store/);
      }
      await change("revoke", permission);
      assert.equal((await request(`/api/maintenance/access?permission=${permission}`, { cookie: maintainer.cookie })).status, 403);
    }
    for (const permission of maintenancePermissions) await change("grant", permission);
    await change("revoke", "quotas.manage");
    const response = await request("/api/maintenance/access", { cookie: maintainer.cookie });
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["permissions", "traceId"]);
    assert.deepEqual(body.permissions, ["capabilities.manage", "support.read"]);
    phase = `${kind}: maintenance identity does not widen personal data ownership`;
    const read = await request(`/api/auth/get-session?userId=${customer.id}`, { cookie: maintainer.cookie });
    assert.equal((await read.json()).user.id, maintainer.id);
    const write = await request("/api/auth/update-user", { method: "POST", cookie: maintainer.cookie, body: { userId: customer.id, id: customer.id, role: "superuser", name: "Updated own maintainer" } });
    assert.equal(write.status, 400);
    assert.equal((await write.json()).code, "INVALID_PROFILE_INPUT");
    assert.equal((await dao.query('SELECT name FROM "user" WHERE id = ?', [maintainer.id]))[0].name, "Synthetic separate maintainer 🚀");
    assert.equal((await dao.query('SELECT name FROM "user" WHERE id = ?', [customer.id]))[0].name, "PRIVATE_CUSTOMER_TEXT_SENTINEL");
    phase = `${kind}: failed profile write does not commit or report success`;
    // Only this isolated database gets the temporary constraint.
    await dao.query('CREATE UNIQUE INDEX geo_b15_profile_failure ON "user" (name)');
    try {
      const failedUpdate = await request("/api/auth/update-user", {
        method: "POST", cookie: maintainer.cookie, body: { name: "PRIVATE_CUSTOMER_TEXT_SENTINEL" },
      });
      assert.equal(failedUpdate.status, 503, "A database write failure must not return success");
      assert.equal((await failedUpdate.json()).code, "AUTH_UNAVAILABLE");
      assert.ok(output.includes("auth-api-unavailable"), "Authentication outage must produce a safe server trace");
      const unchanged = await (await request("/api/auth/get-session", { cookie: maintainer.cookie })).json();
      assert.equal(unchanged.user.name, "Synthetic separate maintainer 🚀");
    } finally {
      await dao.query("DROP INDEX geo_b15_profile_failure");
    }
    console.log(`PASS: ${kind} 资料写入发生真实数据库约束错误时拒绝提交并隐藏数据库细节`);

    const target = "/dashboard/maintenance?source=verification#current";
    const redirect = await request(`/login?returnTo=${encodeURIComponent(target)}`, { cookie: maintainer.cookie });
    assert.equal(new URL(redirect.headers.get("location"), baseURL).href, new URL(target, baseURL).href);
    phase = `${kind}: real missing maintenance table and audit outage`;
    await dao.query("ALTER TABLE maintenance_grant RENAME TO b08_unavailable_grant");
    try {
      for (const locale of ["zh-CN", "en"]) {
        const failure = await request("/api/maintenance/access", { cookie: `${maintainer.cookie}; geo-locale=${locale}` });
        assert.equal(failure.status, 503);
        const error = await failure.json();
        assert.equal(error.error.code, "SERVICE_UNAVAILABLE");
        assert.equal(error.error.externalCostPossible, false);
        assert.ok(error.traceId);
        assert.doesNotMatch(JSON.stringify(error), /b08_unavailable|maintenance_grant|SELECT|postgres|sqlite|stack/);
        const page = await request("/dashboard/maintenance", { cookie: `${maintainer.cookie}; geo-locale=${locale}` });
        assert.equal(page.status, 200);
        assert.ok((await page.text()).includes(locale === "en" ? "Maintenance access cannot be verified right now" : "暂时无法核验维护权限"));
      }
    } finally { await dao.query("ALTER TABLE b08_unavailable_grant RENAME TO maintenance_grant"); }
    await dao.query("ALTER TABLE maintenance_audit RENAME TO b08_unavailable_audit");
    try { assert.equal((await request("/api/maintenance/access", { cookie: maintainer.cookie })).status, 503); }
    finally { await dao.query("ALTER TABLE b08_unavailable_audit RENAME TO maintenance_audit"); }
    assert.ok(output.includes("maintenance-audit-unavailable"), "Audit outage must produce a safe server trace");
    phase = `${kind}: audit privacy and expired / revoked maintenance sessions`;
    const audit = JSON.stringify(await dao.query("SELECT * FROM maintenance_audit"));
    for (const forbidden of [maintainer.password, customer.password, maintainer.cookie, customer.email, "PRIVATE_CUSTOMER_TEXT_SENTINEL"]) {
      assert.ok(!audit.includes(forbidden), "Minimal audit must not store credentials or customer text");
      assert.ok(!output.includes(forbidden), "Server output must not disclose credentials or customer text");
    }
    await dao.query("UPDATE session SET expires_at = ? WHERE user_id = ?", [kind === "sqlite" ? Date.now() - 60_000 : new Date(Date.now() - 60_000).toISOString(), maintainer.id]);
    assert.equal((await request("/api/maintenance/access", { cookie: maintainer.cookie })).status, 401);
    assert.equal((await request("/api/auth/sign-out", { method: "POST", body: {}, cookie: operator.cookie })).status, 200);
    assert.equal((await request("/api/maintenance/access", { cookie: operator.cookie })).status, 401);
    phase = `${kind}: existing verify:auth regression`;
    const auth = await execute("pnpm", ["verify:auth"], { env, maxBuffer: 1_000_000 });
    process.stdout.write(auth.stdout);
    console.log(`PASS: ${kind} real HTTP, controlled CLI, independent permissions, ownership, immediate revocation, redacted audit and service failures`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([stopped, setTimeout(5000)]);
    if (!exited) { child.kill("SIGKILL"); await stopped; }
    await fixture.cleanup();
  }
}

try {
  await access(".next/BUILD_ID");
  for (const kind of ["sqlite", "postgresql"]) await verify(kind);
} catch (error) {
  console.error(`FAIL: ${phase}. ${error?.code === "ERR_ASSERTION" ? error.message : "Check local prerequisites; private error details are withheld."}`);
  process.exitCode = 1;
}
