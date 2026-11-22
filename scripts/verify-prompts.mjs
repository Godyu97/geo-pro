import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const baseURL = "http://localhost:3119";

async function signUp(browser, locale) {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 800 } });
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: { Origin: baseURL },
    data: { name: "Synthetic prompt owner", email: randomUUID() + "@example.invalid", password: randomBytes(24).toString("base64url") },
  });
  assert.equal(response.status(), 200);
  await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
  return { context, id: (await response.json()).user.id };
}

async function brandFor({ context, id }) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: baseURL },
    data: {
      action: "submit", target: null, expectedDraft: null, actorId: id, operationId: randomUUID(),
      fields: { ...initialBrandFields, name: "Synthetic prompt brand", description: "Synthetic questions used for local acceptance" },
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
  assert.doesNotMatch(JSON.stringify(body), /Synthetic prompt brand|SELECT|session_token/);
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
    const brandId = await brandFor(owner);
    const root = `/dashboard/brands/${brandId}`;
    const url = root + "/questions";
    const api = `/api/brands/${brandId}/questions`;
    const draft = { action: "saveDraft", revision: null, baseSetId: null, content: { clusters: [], questions: [] } };
    const post = (context, data, origin = baseURL) => context.request.post(api, { data, headers: { Origin: origin } });
    await denied(await anonymous.request.get(api), 401, "signIn");
    await denied(await post(anonymous, draft), 401, "signIn");
    assert.match((await anonymous.request.get(url, { maxRedirects: 0 })).headers().location, /returnTo=.*%2Fquestions/);
    await denied(await other.context.request.get(api), 404, "notFound");
    await denied(await post(other.context, draft), 404, "notFound");
    await queryWithParameters(db, "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, ?, ?, ?)",
      [other.id, "support.read", new Date().toISOString(), other.id]);
    await denied(await other.context.request.get(api), 404, "notFound");
    await denied(await post(owner.context, draft, "https://example.invalid"), 403, "forbidden");

    const page = await owner.context.newPage();
    await page.goto(root);
    await page.getByRole("link", { name: "监测问题" }).click();
    await expect(page.getByRole("heading", { name: "监测问题" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "生成购买问题候选" })).toBeVisible();
    await expect(page.getByText("还没有待处理的生成候选。", { exact: true })).toBeVisible();
    await expect(page.getByText("非品牌候选")).toBeVisible();
    await checkLayout(page);
    for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: "加入草稿" }).nth(index).click();
    await page.getByLabel("问题簇 1 受众", { exact: true }).fill("合成受众");
    await page.getByLabel("问题簇 1 意图", { exact: true }).fill("了解限制");
    for (const label of ["题目 1 状态", "题目 2 状态", "题目 3 状态"]) await page.getByLabel(label, { exact: true }).selectOption("confirmed");
    await page.getByRole("button", { name: "手工加题" }).click();
    const comparison = "Synthetic prompt brand 和另一方案相比有哪些限制";
    await page.getByLabel("题目 4 文本", { exact: true }).fill(comparison);
    await page.getByLabel("题型").nth(3).selectOption("comparison");
    await page.getByLabel("题目 4 状态", { exact: true }).selectOption("confirmed");
    await page.getByRole("button", { name: "保存草稿" }).press("Enter");
    await expect(page.getByText("已保存。")).toBeVisible();
    await expect(page.getByText("已保存 4 题，主指标 3 题，上限 10。")).toBeVisible();
    const firstQuestion = await page.getByLabel("题目 1 文本", { exact: true }).inputValue();
    await page.getByLabel("逐行粘贴题目", { exact: true }).fill(`  ${firstQuestion}  `);
    await page.getByRole("button", { name: "加入粘贴的题目" }).click();
    await expect(page.getByLabel("题目 5 文本", { exact: true })).toHaveValue(firstQuestion.trim());
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByText("完全相同")).toBeVisible();
    await page.getByRole("button", { name: "移除" }).last().click();
    await expect(page.getByLabel("题目 5 文本", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "冻结题集" }).press("Enter");
    await expect(page).toHaveURL(/version=/);
    const edited = "售后维护条件通常要确认哪些边界";
    await page.getByLabel("题目 1 文本", { exact: true }).fill(edited);
    await page.getByRole("button", { name: "冻结题集" }).click();
    await expect(page.getByRole("heading", { name: "复测需排除的变更题" })).toBeVisible();
    const exclusion = page.getByRole("heading", { name: "复测需排除的变更题" }).locator("xpath=following-sibling::ul[1]");
    await expect(exclusion.getByRole("listitem")).toHaveCount(1);
    await expect(exclusion.getByRole("listitem")).toHaveText(edited);
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.getByRole("heading", { name: "Monitoring questions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Generate buying-question candidates" })).toBeVisible();
    await expect(page.getByText("No generated candidates are waiting for review.", { exact: true })).toBeVisible();
    await expect(page.getByText(edited).first()).toBeVisible();
    await expect(page.getByText(comparison).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Monitoring questions" })).toBeVisible();
    await expect(page.getByText(edited).first()).toBeVisible();

    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?",
      [new Date().toISOString(), new Date().toISOString(), brandId]);
    await denied(await owner.context.request.get(api), 404, "notFound");
    await denied(await post(owner.context, draft), 404, "notFound");
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
    GEO_FUNCTIONAL_MOCK: "", GEO_BRAND_REAL_INTAKE: "", GEO_ACCOUNT_EMAIL_FIXTURE: "0" };
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "3119"], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = new Promise((done) => child.once("exit", done));
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12_000); });
  try {
    for (let tries = 0; tries < 100 && !output.includes("Ready"); tries += 1) {
      assert.equal(child.exitCode, null);
      await setTimeout(100);
    }
    assert.equal((await fetch(baseURL + "/api/health")).status, 200);
    if (enabled) {
      await acceptance(browser, fixture.connection);
      await verifyAuth(env);
      console.log(`PASS: ${kind} prompt HTTP, version exclusion, isolated authorization and zh-CN/en Chrome at 375/768/1440px`);
    } else {
      const owner = await signUp(browser, "en");
      const id = randomUUID();
      const api = `/api/brands/${id}/questions`;
      await denied(await owner.context.request.get(api), 403, "closed");
      await denied(await owner.context.request.post(api, { headers: { Origin: baseURL }, data: { action: "saveDraft" } }), 403, "closed");
      const page = await owner.context.newPage();
      await page.goto(`/dashboard/brands/${id}/questions`);
      await expect(page.getByText("Collection of real brand materials is still closed.").filter({ visible: true })).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await owner.context.close();
      console.log(`PASS: ${kind} real question collection remains closed`);
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
