import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import nextEnv from "@next/env";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { getConnection, queryWithParameters } from "../src/lib/db/connection.ts";
import { ensureRetentionPolicy, retentionDisclosure } from "../tests/brands/retention-setup.mjs";

nextEnv.loadEnvConfig(process.cwd(), true);

const baseURL = "http://127.0.0.1:3121";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const database = parseDatabaseConfig(process.env);
assert.equal(database.success, true, "Development database config must parse");
if (database.data.DATABASE_PROVIDER === "postgresql") {
  const host = new URL(database.data.DATABASE_URL).hostname;
  assert.equal(loopbackHosts.has(host), true, "Refusing a non-loopback development database");
}
const databaseName = database.data.DATABASE_PROVIDER === "sqlite"
  ? database.data.SQLITE_PATH.split(/[/\\]/).pop()
  : decodeURIComponent(new URL(database.data.DATABASE_URL).pathname.replace(/^\//, ""));

const stamp = randomBytes(4).toString("hex");
const ownerEmail = `dev-intake-owner-${stamp}@example.invalid`;
const peerEmail = `dev-intake-peer-${stamp}@example.invalid`;
const outsiderEmail = `dev-intake-outsider-${stamp}@example.invalid`;
const description = "面向中国大陆品牌经营者，帮助负责人从 AI 回答中查找品牌提及、推荐与引用，追溯原始证据，并用同口径复测。";
const fields = {
  name: "GeoPro", description, website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
};
const revised = { ...fields, aliases: ["Geo Pro"] };
const sourceExcerpt = "GeoPro 面向中国大陆品牌经营者，帮助负责人从 AI 回答中查找品牌提及、推荐与引用。";

function request(path, { actor, data, origin = baseURL, locale = "zh-CN", cookie } = {}) {
  return fetch(new URL(path, baseURL), {
    method: data !== undefined ? "POST" : "GET",
    redirect: "manual",
    headers: {
      Origin: origin,
      Cookie: [actor?.cookie, cookie, "geo-locale=" + locale].filter(Boolean).join("; "),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

async function register(email) {
  const credentials = { email, password: randomBytes(24).toString("base64url"), name: "Dev intake" };
  const response = await request("/api/auth/sign-up/email", { data: { name: credentials.name, email, password: credentials.password } });
  assert.equal(response.status, 200, `Registration failed for ${email}`);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.includes("session_token="));
  return { email, credentials, cookie, id: (await response.json()).user.id };
}

async function signIn(actor) {
  const response = await request("/api/auth/sign-in/email", {
    data: { email: actor.credentials.email, password: actor.credentials.password },
  });
  assert.equal(response.status, 200, "Sign-in after session loss must succeed");
  return { ...actor, cookie: response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ") };
}

function mutation(actor, command) {
  return { actorId: actor.id, operationId: randomUUID(), ...command };
}

async function bodyOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}

async function jsonOk(response) {
  const body = await bodyOf(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

const env = {
  ...process.env,
  BETTER_AUTH_URL: baseURL,
  GEO_BRANDS_FIXTURE: "",
  GEO_FUNCTIONAL_MOCK: "",
  GEO_BRAND_REAL_INTAKE: "",
  GEO_BRAND_DEV_INTAKE: "true",
  GEO_BRAND_DEV_INTAKE_DATABASE: databaseName,
  GEO_BRAND_DEV_INTAKE_ACTORS: `${ownerEmail},${peerEmail}`,
  GEO_AUTH_MAIL_MOCK: "true",
  GEO_AUTH_EMAIL_VERIFIED_MOCK: "true",
};

const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3121"], {
  env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let exited = false;
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-24_000); });
const stopped = new Promise((done) => child.once("exit", () => { exited = true; done(); }));

try {
  for (let attempt = 0; attempt < 200 && !output.includes("Ready"); attempt += 1) {
    assert.equal(exited, false, "Development intake server exited before ready");
    await setTimeout(100);
  }
  assert.ok(output.includes("Ready"), "Development intake server did not become ready");

  const owner = await register(ownerEmail);
  const peer = await register(peerEmail);
  const outsider = await register(outsiderEmail);

  const draftId = randomUUID();
  const draft = mutation(owner, {
    action: "saveDraft", operationId: draftId, target: null, expectedDraft: null, step: 0, fields,
  });
  const saved = await jsonOk(await request("/api/brands", { actor: owner, data: draft }));
  assert.deepEqual(saved, { kind: "draft", version: draftId });

  const anonymous = await request("/api/brands", { data: draft });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "SESSION_REQUIRED");
  const expiredPage = await request("/dashboard/brands/new", { locale: "en" });
  assert.equal(expiredPage.status, 307);

  const resumed = await signIn(owner);
  for (const [locale, label] of [["zh-CN", "开发环境联调 · 获准资料"], ["en", "Development intake · authorized records"]]) {
    const page = await request("/dashboard/brands/new", { actor: resumed, locale });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(label));
    assert.match(html, /value="GeoPro"/);
  }

  const acceptedPolicyVersion = await ensureRetentionPolicy(getConnection(), () => new Date(), retentionDisclosure);
  const brand = await jsonOk(await request("/api/brands", {
    actor: resumed,
    data: mutation(resumed, { action: "submit", target: null, expectedDraft: draftId, fields, acceptedPolicyVersion }),
  }));
  assert.equal(brand.entityVersion, 1);
  assert.equal(brand.kind, "brand");

  for (const [locale, notice] of [["zh-CN", "官网引用不适用"], ["en", "Website citations do not apply"]]) {
    const page = await request("/dashboard/brands/" + brand.id, { actor: resumed, locale });
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp(notice));
  }

  const foreign = await request("/api/brands?id=" + brand.id, { actor: peer });
  const foreignBody = await foreign.json();
  assert.equal(foreign.status, 404);
  assert.equal(foreignBody.error.code, "NOT_FOUND");
  assert.doesNotMatch(JSON.stringify(foreignBody), /追溯原始证据/);
  const peerPage = await request("/dashboard/brands", { actor: peer, locale: "en" });
  const peerHtml = await peerPage.text();
  assert.match(peerHtml, /Development intake/);
  assert.match(peerHtml, /Set up a brand or resume a draft/);
  assert.doesNotMatch(peerHtml, /追溯原始证据/);

  const outsiderBrands = await request("/dashboard/brands", { actor: outsider, locale: "en" });
  assert.equal(outsiderBrands.status, 200);
  const outsiderHtml = await outsiderBrands.text();
  assert.match(outsiderHtml, /Development intake/);
  assert.match(outsiderHtml, /Set up a brand or resume a draft/);
  assert.doesNotMatch(outsiderHtml, /追溯原始证据/);
  const outsiderForeignBrand = await request("/api/brands?id=" + brand.id, { actor: outsider });
  assert.equal(outsiderForeignBrand.status, 404);
  assert.equal((await outsiderForeignBrand.json()).error.code, "NOT_FOUND");

  const factId = randomUUID();
  const factFields = {
    category: "positioning",
    title: "产品定位",
    claim: sourceExcerpt,
    sourceType: "url",
    sourceReference: "https://github.com/Godyu97/geo-pro",
    sourceLocator: "README.md",
    sourceExcerpt,
    sourceDate: "2026-11-23",
    permission: "public",
    validity: "longTerm",
    validThrough: "",
    pasteId: null,
    pasteSpan: null,
  };
  const factPath = "/api/brands/" + brand.id + "/facts";
  assert.equal((await request(factPath, { actor: peer, data: { action: "create", id: factId, previousId: null, fields: factFields } })).status, 404);
  await jsonOk(await request(factPath, {
    actor: resumed, data: { action: "create", id: factId, previousId: null, fields: factFields },
  }));
  await jsonOk(await request(factPath, { actor: resumed, data: { action: "submit", id: factId, revision: 1 } }));
  await jsonOk(await request(factPath, {
    actor: resumed,
    data: { action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false },
  }));

  const clusterId = randomUUID();
  const questionIds = [randomUUID(), randomUUID(), randomUUID()];
  const texts = [
    "选择品牌可见度工具时通常要先确认哪些监测范围",
    "日常复盘 AI 回答时怎样核对引用是否来自公开页面",
    "预算有限时怎样判断一轮品牌监测是否足够",
  ];
  const questions = texts.map((text, index) => ({
    id: questionIds[index], clusterId, text, source: "manual", sourceNote: "获准公开资料",
    type: "discovery", stage: "consider", region: "CN", language: "zh-CN",
    status: "confirmed", acceptSimilar: false, primary: false,
  }));
  const content = {
    clusters: [{ id: clusterId, audience: "品牌负责人", intent: "了解监测范围", primaryPage: "", conversionAction: "" }],
    questions,
  };
  const promptPath = "/api/brands/" + brand.id + "/questions";
  const drafted = await jsonOk(await request(promptPath, {
    actor: resumed, data: { action: "saveDraft", revision: null, baseSetId: null, content },
  }));
  assert.equal(drafted.revision, 1);
  const setId = randomUUID();
  const frozenId = randomUUID();
  const frozen = await jsonOk(await request(promptPath, {
    actor: resumed,
    data: { action: "freeze", id: frozenId, revision: 1, setId, baseSetId: null, content },
  }));
  assert.equal(frozen.version, 1);
  assert.equal(frozen.preview.primary, 3);

  const edited = await jsonOk(await request("/api/brands", {
    actor: resumed,
    data: mutation(resumed, {
      action: "submit",
      target: { brandId: brand.id, expectedBrandRevision: brand.revision },
      expectedDraft: null,
      fields: revised,
    }),
  }));
  assert.equal(edited.entityVersion, 2);
  const previous = await request("/api/brands?id=" + brand.id + "&version=1", { actor: resumed });
  assert.equal(previous.status, 200);
  const previousBody = await previous.json();
  assert.deepEqual(previousBody.fields.aliases, []);
  assert.equal(previousBody.fields.website, "");
  const current = await request("/api/brands?id=" + brand.id, { actor: resumed });
  assert.deepEqual((await current.json()).fields.aliases, ["Geo Pro"]);

  const changed = texts.map((text, index) => index === 0 ? { ...questions[index], text: "公开资料不足时怎样判断一轮品牌监测是否还能开始" } : questions[index]);
  const secondId = randomUUID();
  await jsonOk(await request(promptPath, {
    actor: resumed,
    data: {
      action: "freeze", id: secondId, revision: frozen.revision, setId, baseSetId: frozenId,
      content: { ...content, questions: changed },
    },
  }));
  const firstSet = await request(promptPath + "?version=" + frozenId, { actor: resumed });
  assert.equal(firstSet.status, 200);
  const firstBody = await firstSet.json();
  assert.equal(firstBody.selected.content.questions[0].text, texts[0]);
  assert.equal((await request(promptPath + "?version=" + frozenId, { actor: peer })).status, 404);
  assert.equal((await request(factPath, { actor: outsider })).status, 404);
  const confirmPath = "/dashboard/monitoring/new?brandId=" + brand.id;
  for (const [locale, readiness, count, quota, confirmation, foreignMessage] of [
    ["zh-CN", "监测准备", "已确认自然发现题 3 / 3，确认题共 3", "没有可用于官方 API 的有效采样额度", "登记监测运行", "找不到该品牌或运行"],
    ["en", "Monitoring readiness", "3 / 3 confirmed natural-discovery questions, 3 confirmed in total", "No active sampling quota is available", "Register a monitoring run", "That brand or run was not found"],
  ]) {
    const ownerBrandPage = await request("/dashboard/brands/" + brand.id, { actor: resumed, locale });
    assert.equal(ownerBrandPage.status, 200);
    const readinessHtml = await ownerBrandPage.text();
    for (const message of [readiness, count, quota]) assert.ok(readinessHtml.includes(message), message);

    const ownerConfirmPage = await request(confirmPath, { actor: resumed, locale });
    assert.equal(ownerConfirmPage.status, 200);
    const confirmationHtml = await ownerConfirmPage.text();
    assert.ok(confirmationHtml.includes(confirmation));
    assert.match(confirmationHtml, new RegExp(`<option\\b(?=[^>]*value="${secondId}")(?=[^>]*selected="")`),
      "The requested brand must default to its latest frozen question set");

    const peerConfirmPage = await request(confirmPath, { actor: peer, locale });
    assert.equal(peerConfirmPage.status, 200);
    const peerHtml = await peerConfirmPage.text();
    assert.ok(peerHtml.includes(foreignMessage));
    assert.ok(!peerHtml.includes(secondId), "Another account cannot see the frozen question set");
  }

  const db = getConnection();
  const [stored] = await queryWithParameters(
    db,
    `SELECT owner_id AS "ownerId", entity_version AS "entityVersion" FROM brand WHERE id = ?`,
    [brand.id],
  );
  assert.equal(stored.ownerId, resumed.id);
  assert.equal(Number(stored.entityVersion), 2);
  const versions = await queryWithParameters(
    db,
    `SELECT version, name FROM brand_version WHERE brand_id = ? ORDER BY version`,
    [brand.id],
  );
  assert.deepEqual(versions.map((row) => [Number(row.version), row.name]), [[1, "GeoPro"], [2, "GeoPro"]]);
  const [fact] = await queryWithParameters(
    db,
    `SELECT state, entity_version AS "entityVersion", confirmed_by AS "confirmedBy" FROM brand_fact_version WHERE brand_id = ? AND id = ?`,
    [brand.id, factId],
  );
  assert.equal(fact.state, "approved");
  assert.equal(Number(fact.entityVersion), 1);
  assert.equal(fact.confirmedBy, resumed.id);
  const sets = await queryWithParameters(
    db,
    `SELECT version, entity_version AS "entityVersion" FROM prompt_set WHERE brand_id = ? ORDER BY version`,
    [brand.id],
  );
  assert.deepEqual(sets.map((row) => [Number(row.version), Number(row.entityVersion)]), [[1, 1], [2, 2]]);

  console.log(JSON.stringify({
    result: "pass",
    database: databaseName,
    brandId: brand.id,
    ownerId: resumed.id,
    peerId: peer.id,
    outsiderId: outsider.id,
    factId,
    promptSetId: setId,
    frozenVersionId: frozenId,
    revisedPromptVersionId: secondId,
    entityVersions: [1, 2],
  }));
} finally {
  child.kill("SIGTERM");
  await Promise.race([stopped, setTimeout(5_000)]);
  if (!exited) child.kill("SIGKILL");
}
