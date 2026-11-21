import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { exportFileName } from "../src/features/data-exports/contracts.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const baseURL = "http://localhost:3106";
const exportsPath = "/api/data-exports";
const name = "合成负责人 É 🚀";
const fields = { ...initialBrandFields, name: "合成品牌 É 🚀", description: "导出验收使用的合成资料" };
let phase = "production build required";

function request(path, { actor, data, origin = baseURL, locale = "en", cookie } = {}) {
  return fetch(new URL(path, baseURL), {
    method: data === undefined ? "GET" : "POST", redirect: "manual",
    headers: {
      Origin: origin,
      Cookie: [actor?.cookie, cookie, "geo-locale=" + locale].filter(Boolean).join("; "),
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

async function actor() {
  const email = `b05-${randomUUID()}@example.invalid`;
  const response = await request("/api/auth/sign-up/email", {
    data: { name, email, password: randomBytes(24).toString("base64url") },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.includes("session_token="));
  return { cookie, email, id: (await response.json()).user.id };
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-disposition"), null);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /合成负责人|合成品牌|brand_test_unavailable|SELECT/);
  return body;
}

function input(owner, scopes, previousId = null, locale = "zh-CN") {
  return { actorId: owner.id, previousId, locale, scopes };
}

async function prepare(owner, scopes, previousId, locale) {
  const response = await request(exportsPath, { actor: owner, data: input(owner, scopes, previousId, locale) });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}

function download(id, options) {
  return request(`${exportsPath}/${id}`, options);
}

async function readFile(owner, result) {
  const response = await download(result.id, { actor: owner, locale: result.locale === "en" ? "zh-CN" : "en" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("content-language"), result.locale);
  const disposition = response.headers.get("content-disposition");
  assert.match(disposition, /^attachment; filename="GeoPro-personal-data-\d{4}-\d{2}-\d{2}\.json"; /);
  const filename = decodeURIComponent(disposition.split("filename*=UTF-8''")[1]);
  assert.equal(filename, exportFileName(result));
  if (result.locale === "zh-CN") assert.match(filename, /个人数据/);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
  const { schemaVersion, unavailable, data, ...summary } = JSON.parse(text);
  assert.equal(schemaVersion, 1);
  assert.deepEqual(summary, result);
  assert.deepEqual(unavailable, []);
  assert.doesNotMatch(text, /session_token|accessToken|refreshToken|password/);
  return data;
}

async function verifyEnabled(db, owner) {
  phase = `${db.kind}: validation and account isolation`;
  const firstInput = input(owner, ["profile", "brands"]);
  await assertError(await request(exportsPath, { data: firstInput }), 401, "SESSION_REQUIRED");
  await assertError(await request(exportsPath, { actor: owner, origin: "https://example.invalid", data: firstInput }), 403, "FORBIDDEN");
  await assertError(await request(exportsPath, { actor: owner, data: { ...firstInput, scopes: ["credentials"] } }), 400, "INVALID_INPUT");
  await assertError(await request(exportsPath, { actor: owner, data: { ...firstInput, actorId: "x".repeat(3000) } }), 400, "INVALID_INPUT");

  const brandResponse = await request("/api/brands", { actor: owner, data: {
    action: "submit", target: null, expectedDraft: null, actorId: owner.id, operationId: randomUUID(), fields,
  } });
  assert.equal(brandResponse.status, 200);
  const brand = await brandResponse.json();
  const ready = await prepare(owner, ["profile", "brands"]);
  assert.equal(ready.status, "ready");
  const data = await readFile(owner, ready);
  assert.deepEqual(data.profile, { name, email: owner.email });
  assert.deepEqual(data.brands.versions.map(({ fields }) => fields), [fields]);
  await assertError(await request(exportsPath, { actor: owner, data: firstInput }), 409, "CONFLICT");
  await assertError(await download(ready.id), 401, "SESSION_REQUIRED");
  await assertError(await download(ready.id, { cookie: "better-auth.session_token=invalid-fixture" }), 401, "SESSION_REQUIRED");

  const other = await actor();
  await assertError(await request(exportsPath, { actor: other, data: firstInput }), 409, "SESSION_CHANGED");
  const foreign = await assertError(await download(ready.id, { actor: other }), 404, "NOT_FOUND");
  assert.deepEqual(foreign, await assertError(await download(randomUUID(), { actor: other }), 404, "NOT_FOUND"));
  await queryWithParameters(db, "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)",
    [other.id, "support.read", new Date().toISOString(), other.id]);
  assert.deepEqual(foreign, await assertError(await download(ready.id, { actor: other }), 404, "NOT_FOUND"));
  const otherPage = await (await request("/dashboard/settings", { actor: other })).text();
  assert.doesNotMatch(otherPage, new RegExp(ready.id));

  phase = `${db.kind}: loss of ownership, deletion and partial failure`;
  await queryWithParameters(db, "UPDATE brand SET owner_id = ? WHERE id = ?", [other.id, brand.id]);
  await assertError(await download(ready.id, { actor: owner }), 404, "NOT_FOUND");
  await assertError(await download(ready.id, { actor: other }), 404, "NOT_FOUND");
  const otherExport = await prepare(other, ["brands"], null, "en");
  assert.equal((await readFile(other, otherExport)).brands.versions.length, 1);
  await queryWithParameters(db, "DELETE FROM brand WHERE id = ?", [brand.id]);
  await assertError(await download(otherExport.id, { actor: other }), 404, "NOT_FOUND");
  const empty = await prepare(owner, ["brands"], ready.id);
  assert.deepEqual(await readFile(owner, empty), { brands: { versions: [], drafts: [] } });

  await db.query("ALTER TABLE brand_version RENAME TO brand_test_unavailable");
  let partial;
  try {
    await assertError(await download(empty.id, { actor: owner }), 503, "SERVICE_UNAVAILABLE");
    partial = await prepare(owner, ["profile", "brands"], empty.id);
    assert.equal(partial.status, "partial");
    assert.deepEqual(partial.missing, ["brands"]);
    assert.deepEqual(await readFile(owner, partial), { profile: { name, email: owner.email } });
  } finally { await db.query("ALTER TABLE brand_test_unavailable RENAME TO brand_version"); }

  phase = `${db.kind}: expired and revoked session`;
  const expires = db.kind === "sqlite" ? Date.now() - 60_000 : new Date(Date.now() - 60_000).toISOString();
  await queryWithParameters(db, "UPDATE session SET expires_at = ? WHERE user_id = ?", [expires, owner.id]);
  await assertError(await download(partial.id, { actor: owner }), 401, "SESSION_REQUIRED");
  const revocable = await prepare(other, ["profile"], otherExport.id, "en");
  assert.equal((await request("/api/auth/sign-out", { actor: other, data: {} })).status, 200);
  await assertError(await download(revocable.id, { actor: other }), 401, "SESSION_REQUIRED");
}

async function verify(kind, enabled) {
  const fixture = await testDatabase(kind);
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", "3106"], {
    env: {
      ...process.env, ...fixture.env, BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), GEO_BRANDS_FIXTURE: enabled ? "1" : "",
      GEO_FUNCTIONAL_MOCK: "", GEO_BRAND_REAL_INTAKE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes) => { output = (output + bytes).slice(-32_000); });
  const stopped = new Promise((done) => child.once("exit", done));
  try {
    phase = `${kind}: local Next.js startup`;
    for (let attempt = 0; attempt < 200 && !output.includes("Ready"); attempt++) {
      assert.equal(child.exitCode, null);
      await setTimeout(100);
    }
    assert.ok(output.includes("Ready"));
    assert.equal((await request("/api/health")).status, 200);
    const owner = await actor();
    if (enabled) {
      await verifyEnabled(fixture.connection, owner);
      console.log(`PASS: ${kind} production HTTP export, authorization, UTF-8, revocation and partial result checks`);
      return;
    }
    phase = `${kind}: standard runtime scope`;
    await assertError(await request(exportsPath, { actor: owner, data: input(owner, ["brands"]) }), 403, "BRAND_SCOPE_CLOSED");
    await assertError(await request(exportsPath, { actor: owner, data: input(owner, ["factsAndMaterials"]) }), 403, "BRAND_SCOPE_CLOSED");
    for (const [locale, notice] of [["zh-CN", "品牌数据导出目前仅在本地验收环境开放"], ["en", "Brand data export is currently limited to local testing"]]) {
      const page = await request("/dashboard/settings", { actor: owner, locale });
      assert.match(await page.text(), new RegExp(notice));
    }
    const personal = await prepare(owner, ["profile"], null, "en");
    assert.deepEqual(await readFile(owner, personal), { profile: { name, email: owner.email } });
    console.log("PASS: standard runtime permits personal profile and keeps brand export closed");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([stopped, setTimeout(5000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) {
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
