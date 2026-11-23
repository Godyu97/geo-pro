import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { withEligibleFacts } from "../src/features/brand-facts/service.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";
import { ensureRetentionPolicy } from "../tests/brands/retention-setup.mjs";

const baseURL = "http://localhost:3118";
const original = "合成资料第一行 🚀\nSynthetic source's second line";

async function signUp(browser, locale) {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 800 } });
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: { Origin: baseURL },
    data: { name: "Synthetic fact owner", email: randomUUID() + "@example.invalid", password: randomBytes(24).toString("base64url") },
  });
  assert.equal(response.status(), 200);
  await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
  return { context, id: (await response.json()).user.id };
}

async function brandFor({ context, id }, db) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: baseURL },
    data: {
      action: "submit", target: null, expectedDraft: null, actorId: id, operationId: randomUUID(),
      acceptedPolicyVersion: await ensureRetentionPolicy(db),
      fields: { ...initialBrandFields, name: "Synthetic facts fixture", description: "Synthetic materials used for local acceptance" },
    },
  });
  assert.equal(response.status(), 200);
  return (await response.json()).id;
}

async function denied(response, status, code) {
  assert.equal(response.status(), status);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  const body = await response.json();
  assert.equal(body.error, code);
  assert.doesNotMatch(JSON.stringify(body), /Synthetic source|SELECT|session_token/);
}

async function checkLayout(page) {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 375, height: 850 });
}

async function acceptance(browser, db) {
  const owner = await signUp(browser, "zh-CN");
  const other = await signUp(browser, "en");
  const anonymous = await browser.newContext({ baseURL });
  try {
    const brandId = await brandFor(owner, db);
    const root = `/dashboard/brands/${brandId}`;
    const url = root + "/facts";
    const api = `/api/brands/${brandId}/facts`;
    const save = { action: "savePaste", id: randomUUID(), previousId: null, original };
    const post = (context, data, origin = baseURL) => context.request.post(api, { data, headers: { Origin: origin } });
    await denied(await anonymous.request.get(api), 401, "signIn");
    await denied(await post(anonymous, save), 401, "signIn");
    assert.match((await anonymous.request.get(url, { maxRedirects: 0 })).headers().location, /returnTo=.*%2Ffacts/);
    await denied(await other.context.request.get(api), 404, "notFound");
    await denied(await post(other.context, save), 404, "notFound");
    await queryWithParameters(db, "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)",
      [other.id, "support.read", new Date().toISOString(), other.id]);
    await denied(await other.context.request.get(api), 404, "notFound");
    await denied(await post(other.context, save), 404, "notFound");
    await denied(await post(owner.context, save, "https://example.invalid"), 403, "forbidden");

    const page = await owner.context.newPage();
    const field = (name) => page.getByLabel(name).filter({ visible: true });
    await page.goto(root);
    await page.getByRole("link", { name: "事实与材料" }).click();
    await expect(page.getByRole("heading", { name: "事实与材料" })).toBeVisible();
    await expect(page.getByText(/还没有事实记录/)).toBeVisible();
    await checkLayout(page);
    await field("粘贴或编辑材料原文").fill(original);
    await page.getByRole("button", { name: "按行预览候选" }).press("Enter");
    await expect(page.getByText("合成资料第一行 🚀", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存原文" }).press("Enter");
    await expect(page).toHaveURL(/paste=/);
    await page.getByRole("button", { name: "用此片段建卡" }).first().press("Enter");
    await expect(page.getByRole("textbox", { name: "主张", exact: true })).toHaveValue("合成资料第一行 🚀");
    await field("简称").fill("合成规格");
    await page.getByRole("button", { name: "保存草稿" }).press("Enter");
    await expect(page).toHaveURL(/fact=/);
    const factId = new URL(page.url()).searchParams.get("fact");
    await page.getByRole("button", { name: "提交待确认" }).press("Enter");
    await expect(page.getByRole("heading", { name: "需要补齐的证据" })).toBeVisible();
    await expect(page.getByText("待确认", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "确认此版本" })).toBeDisabled();

    const originalPageUrl = page.url();
    await page.reload();
    await expect(field("粘贴或编辑材料原文")).toHaveValue(original);
    await expect(field("简称")).toHaveValue("合成规格");
    await field("来源网址或材料说明").fill("Private synthetic attachment fixture");
    await page.getByRole("combobox", { name: "界面语言" }).selectOption("en");
    await expect(page.getByRole("heading", { name: "Facts and materials" })).toBeVisible();
    assert.equal(page.url(), originalPageUrl);
    await expect(field("Source URL or material description")).toHaveValue("Private synthetic attachment fixture");
    await expect(field("Paste or edit source text")).toHaveValue(original);
    await expect(page.getByRole("heading", { name: "Evidence to complete" })).toBeVisible();
    await checkLayout(page);

    await field("Source type").selectOption("internal");
    await field("Location (page, paragraph, or section)").fill("Part 1");
    await field("Source date").fill("2026-01-01");
    await field("Permission to publish the claim").selectOption("public");
    await page.getByRole("combobox", { name: "Validity", exact: true }).selectOption("longTerm");
    await page.getByRole("button", { name: "Save candidate changes" }).press("Enter");
    await expect(page.getByRole("heading", { name: "Evidence to complete" })).toHaveCount(0);
    await field("I reviewed this claim, its evidence, and its publication permission.").press("Space");
    await page.getByRole("button", { name: "Approve this version" }).press("Enter");
    await expect(page.getByText(/Approved by/)).toBeVisible();

    const contentVersionId = randomUUID();
    const projection = await withEligibleFacts(db, { ownerId: owner.id, brandId },
      { factVersionIds: [factId], contentVersionId, stage: "review" }, async (_tx, facts) => facts);
    assert.doesNotMatch(JSON.stringify(projection), /Private synthetic attachment|Synthetic source's second line/);
    assert.equal(projection.data[0].claim, "合成资料第一行 🚀");
    await page.reload();
    await expect(page.getByText("Fact eligible", { exact: true })).toBeVisible();
    await field("I reviewed the impact and confirm revocation of this version.").press("Space");
    await page.getByRole("button", { name: "Revoke this version" }).press("Enter");
    await expect(page.getByText("Fact invalid. Review or delivery is blocked.")).toBeVisible();

    await page.goto(root + "/delete");
    await expect(page.getByText("Fact versions: 1. Source revisions: 1.", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.goto(originalPageUrl);
    const foreign = await other.context.request.get(originalPageUrl);
    assert.doesNotMatch(await foreign.text(), /合成资料第一行|Private synthetic attachment/);
    await db.query("ALTER TABLE brand_fact_paste RENAME TO brand_fact_paste_unavailable");
    try {
      await denied(await owner.context.request.get(api), 503, "unavailable");
      await page.reload();
      await expect(page.getByRole("alert").getByText(/temporarily unavailable/)).toBeVisible();
      await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh-CN");
      await expect(page.getByRole("alert").getByText(/暂时无法读取或保存/)).toBeVisible();
    } finally {
      await db.query("ALTER TABLE brand_fact_paste_unavailable RENAME TO brand_fact_paste");
    }

    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?",
      [new Date().toISOString(), new Date().toISOString(), brandId]);
    await denied(await owner.context.request.get(api), 404, "notFound");
    await denied(await post(owner.context, save), 404, "notFound");
  } finally {
    await Promise.all([owner.context.close(), other.context.close(), anonymous.close()]);
  }
}

async function verifyAuth(env) {
  const child = spawn("pnpm", ["verify:auth"], { env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  assert.equal(code, 0);
}

async function verify(kind, browser, enabled) {
  const fixture = await testDatabase(kind);
  const env = { ...process.env, ...fixture.env, BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), GEO_BRANDS_FIXTURE: enabled ? "1" : "0",
    GEO_FUNCTIONAL_MOCK: "", GEO_BRAND_REAL_INTAKE: "",
    GEO_BRAND_DEV_INTAKE: "", GEO_BRAND_DEV_INTAKE_DATABASE: "", GEO_BRAND_DEV_INTAKE_ACTORS: "",
    GEO_ACCOUNT_EMAIL_FIXTURE: "0" };
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "3118"], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = new Promise((done) => child.once("exit", done));
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12_000); });
  try {
    for (let tries = 0; tries < 100 && !output.includes("Ready"); tries++) {
      assert.equal(child.exitCode, null);
      await setTimeout(100);
    }
    assert.equal((await fetch(baseURL + "/api/health")).status, 200);
    if (enabled) {
      await acceptance(browser, fixture.connection);
      await verifyAuth(env);
      console.log(`PASS: ${kind} fact HTTP, private evidence, isolated authorization and zh-CN/en Chrome at 375/768/1440px`);
    } else {
      const owner = await signUp(browser, "en");
      const id = randomUUID();
      const api = `/api/brands/${id}/facts`;
      await denied(await owner.context.request.get(api), 403, "closed");
      await denied(await owner.context.request.post(api, { headers: { Origin: baseURL },
        data: { action: "savePaste", id: randomUUID(), previousId: null, original } }), 403, "closed");
      const page = await owner.context.newPage();
      await page.goto(`/dashboard/brands/${id}/facts`);
      await expect(page.getByText("Collection of real brand materials is still closed.").filter({ visible: true })).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await owner.context.close();
      console.log(`PASS: ${kind} real material collection remains closed`);
    }
  } catch (error) {
    console.error(kind, output);
    throw error;
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await stopped;
    await fixture.cleanup();
  }
}

await access(".next/BUILD_ID");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const kind of ["sqlite", "postgresql"]) await verify(kind, browser, true);
  await verify("sqlite", browser, false);
} finally {
  await browser.close();
}
