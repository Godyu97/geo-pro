import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const baseURL = "http://localhost:3105";
const fields = { ...initialBrandFields, name: "Synthetic B04 测试 🚀", description: "Synthetic brand verification only" };
let phase = "production build required";

function request(path, { actor, data, origin = baseURL, locale = "en", cookie } = {}) {
  return fetch(new URL(path, baseURL), {
    method: data !== undefined ? "POST" : "GET", redirect: "manual",
    headers: {
      Origin: origin,
      Cookie: [actor?.cookie, cookie, "geo-locale=" + locale].filter(Boolean).join("; "),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

async function actor() {
  const response = await request("/api/auth/sign-up/email", {
    data: { name: "Synthetic owner", email: `b04-${randomUUID()}@example.invalid`, password: randomBytes(24).toString("base64url") },
  });
  assert.equal(response.status, 200, "Disposable account registration must succeed");
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.includes("session_token="), "Real authentication cookie is required");
  return { cookie, id: (await response.json()).user.id };
}

function mutation(you, command) {
  return { actorId: you.id, operationId: randomUUID(), ...command };
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(body.error.externalCostPossible, false);
  return body;
}

async function verify(kind, enabled) {
  const fixture = await testDatabase(kind);
  const env = {
    ...process.env, ...fixture.env, BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), GEO_BRANDS_FIXTURE: enabled ? "1" : "",
  };
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", "3105"], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", exited = false;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-32_000); });
  const stopped = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  try {
    phase = `${kind}: local Next.js startup`;
    for (let attempt = 0; attempt < 200 && !output.includes("Ready"); attempt++) {
      assert.equal(exited, false, "Owned Next.js server must stay running");
      await setTimeout(100);
    }
    assert.ok(output.includes("Ready"), "Owned Next.js server must be ready");
    assert.equal((await request("/api/health")).status, 200);
    const owner = await actor();
    const create = mutation(owner, { action: "submit", target: null, expectedDraft: null, fields });
    if (!enabled) {
      phase = `${kind}: real intake stays closed`;
      await assertError(await request("/api/brands", { actor: owner, data: create }), 403, "INTAKE_CLOSED");
      for (const [locale, notice] of [["zh-CN", "真实品牌建档尚未开放"], ["en", "Brand setup is closed to real data"]]) {
        const page = await request("/dashboard/brands/new", { actor: owner, locale });
        assert.match(await page.text(), new RegExp(notice));
      }
      assert.equal((await fixture.connection.query("SELECT id FROM brand")).length, 0);
      console.log(`PASS: ${kind} default intake rejects writes and explains the closure in both languages`);
      return;
    }

    phase = `${kind}: auth, body validation and same-origin requirement`;
    const ownerPage = await request("/dashboard/brands/new", { actor: owner });
    assert.match(await ownerPage.text(), /Local testing · Synthetic data/);
    await assertError(await request("/api/brands", { data: create }), 401, "SESSION_REQUIRED");
    await assertError(await request("/api/brands", { cookie: "better-auth.session_token=invalid-test-cookie", data: create }), 401, "SESSION_REQUIRED");
    await assertError(await request("/api/brands", { actor: owner, origin: "https://example.invalid", data: create }), 403, "FORBIDDEN");
    const rejected = await assertError(await request("/api/brands", {
      actor: owner, data: { ...create, fields: { ...fields, website: "http://localhost/private" } },
    }), 400, "INVALID_INPUT");
    assert.deepEqual(rejected.error.fields, ["website"]);
    await assertError(await request("/api/brands", { actor: owner, data: { ...create, fields: { ...fields, name: "a".repeat(50_000) } } }), 400, "INVALID_INPUT");

    phase = `${kind}: idempotency, scoped reads and non-owner writes`;
    const response = await request("/api/brands", { actor: owner, data: create });
    assert.equal(response.status, 200);
    const brand = await response.json();
    assert.deepEqual(await (await request("/api/brands", { actor: owner, data: create })).json(), brand);
    const resource = "/api/brands?id=" + brand.id;
    assert.deepEqual((await (await request(resource, { actor: owner })).json()).fields, fields);
    const other = await actor();
    await queryWithParameters(fixture.connection, "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)",
      [other.id, "support.read", new Date().toISOString(), other.id]);
    const foreign = await assertError(await request(resource, { actor: other }), 404, "NOT_FOUND");
    assert.deepEqual(foreign, await assertError(await request("/api/brands?id=" + randomUUID(), { actor: other }), 404, "NOT_FOUND"));
    await assertError(await request("/api/brands", {
      actor: other, data: mutation(other, { action: "archive", brandId: brand.id, expectedBrandRevision: 1 }),
    }), 404, "NOT_FOUND");
    await assertError(await request("/api/brands", { actor: other, data: create }), 409, "SESSION_CHANGED");

    phase = `${kind}: real storage failure and revoked sessions`;
    await fixture.connection.query("ALTER TABLE brand_version RENAME TO brand_test_unavailable");
    try {
      const failure = await assertError(await request(resource, { actor: owner, locale: "zh-CN" }), 503, "SERVICE_UNAVAILABLE");
      assert.ok(failure.traceId);
      assert.equal(failure.error.retryable, true);
      assert.match(failure.error.message, /暂时无法/);
      assert.doesNotMatch(JSON.stringify(failure), /brand_test_unavailable|Synthetic B04|SELECT/);
    } finally {
      await fixture.connection.query("ALTER TABLE brand_test_unavailable RENAME TO brand_version");
    }
    assert.ok(output.includes("brand-store-unavailable"));
    const expires = kind === "sqlite" ? Date.now() - 60_000 : new Date(Date.now() - 60_000).toISOString();
    await queryWithParameters(fixture.connection, "UPDATE session SET expires_at = ? WHERE user_id = ?", [expires, owner.id]);
    await assertError(await request(resource, { actor: owner }), 401, "SESSION_REQUIRED");
    assert.equal((await request("/api/auth/sign-out", { actor: other, data: {} })).status, 200);
    await assertError(await request(resource, { actor: other }), 401, "SESSION_REQUIRED");
    console.log(`PASS: ${kind} real HTTP session, ownership, origin, validation, idempotency and storage failure checks`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([stopped, setTimeout(5000, undefined, { ref: false })]);
    if (!exited) {
      child.kill("SIGKILL");
      await stopped;
    }
    await fixture.cleanup();
  }
}

try {
  await access(".next/BUILD_ID");
  await verify("sqlite", false);
  for (const kind of ["sqlite", "postgresql"]) await verify(kind, true);
} catch (error) {
  console.error(`FAIL: ${phase}. ${error?.code === "ERR_ASSERTION" ? error.message : "Private error details are withheld."}`);
  process.exitCode = 1;
}
