import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const sourcePath = "/dashboard/content/sources";
const time = "2026-11-24T08:00:00.000Z";
const excerpt = "北岸保修两年";
const shots = ".cache/issue-135/source-originals";
const fileName = `two-${"p".repeat(102)}.txt`;
const longFragment = "material".repeat(65);
const copy = {
  "zh-CN": {
    title: "资料原件", start: "开始导入", empty: "还没有导入记录。", submit: "导入原件", pending: "正在导入原件…",
    results: "查看导入结果", batch: "本次导入", go: "前往品牌",
    summary: "本次导入的可见文件 · 已保存 1 · 部分保留 1 · 失败 1", loading: "正在加载资料原件…",
    unavailable: "资料原件暂时无法读取，请重新载入。", reload: "重新载入",
    encrypted: "这个文件已加密，不能导入。", page: "页码",
    partial: "可识别部分已保留。缺失页面需要人工处理，系统没有补写页码。",
    missing: "这一段缺失。没有补写页码或正文。",
    conflict: (id: string) => `与已批准事实版本 1（${id}）冲突，候选仍未批准。`,
    noConflict: "与已批准事实没有冲突，候选仍未批准。",
    notApproved: "这些原件还不是已批准事实。",
  },
  en: {
    title: "Source originals", start: "Start import", empty: "No imports yet.", submit: "Import originals", pending: "Importing originals…",
    results: "View import results", batch: "This import", go: "Go to brands",
    summary: "Files shown for this import · Saved 1 · Partial 1 · Failed 1", loading: "Loading source originals…",
    unavailable: "Source originals are temporarily unavailable. Try reloading the page.", reload: "Reload",
    encrypted: "This file is encrypted and cannot be imported.", page: "Page",
    partial: "The readable part was kept. Missing pages need a person; no page number was invented.",
    missing: "This part is missing. No page number or text was added.",
    conflict: (id: string) => `Conflicts with approved fact version 1 (${id}). The candidate is not approved.`,
    noConflict: "No conflict with an approved fact. The candidate is not approved.",
    notApproved: "These originals are not approved facts.",
  },
} as const;
const locales = ["zh-CN", "en"] as const;

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [] }),
  ], { stdio: "inherit" });
}

async function expectLayout(page: Page, action: Locator) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

test("source originals show import progress, per-file outcomes and scoped recovery", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  const email = `sources-${randomUUID()}@example.invalid`;
  const otherEmail = `sources-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const factVersionId = randomUUID();
  let userId = "";
  let otherId = "";
  let brandId: string | undefined;
  const other = await browser.newContext();
  const db = postgres(localDatabaseURL(), { max: 1 });
  const main = page.locator("main");
  const picker = main.locator('input[name="files"]');
  try {
    const registered = await registerTestAccount(context, { name: "片段验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    const otherUser = await registerTestAccount(other, { name: "Sources access tester", email: otherEmail, password });
    expect(otherUser.status()).toBe(200);
    otherId = (await otherUser.json()).user.id as string;
    await db`update "user" set email_verified = true where id in (${userId}, ${otherId})`;

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(sourcePath);
        await expect(main.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
        await expectLayout(page, main.getByRole("link", { name: copy[locale].go, exact: true }));
        await expect(picker).toHaveCount(0);
      }
    }
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("片段验收品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于资料片段验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://source-fragments.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "片段验收品牌", exact: true })).toBeVisible();
    brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    if (!brandId) throw new Error("The synthetic brand was not created");

    const [brand] = await db`select entity_version from brand where id = ${brandId} and owner_id = ${userId}`;
    const content = {
      category: "specification", title: "保修", claim: "保修一年", sourceType: "internal", sourceReference: "fixture",
      sourceLocator: "第 1 页", sourceExcerpt: "fixture", sourceDate: "", permission: "unknown", validity: "unspecified",
      validThrough: "", pasteId: null, pasteSpan: null,
    };
    await db`
      insert into brand_fact_version (
        brand_id, id, fact_id, version, entity_version, revision, state, content, created_at, confirmed_by, confirmed_at
      ) values (
        ${brandId}, ${factVersionId}, ${factVersionId}, 1, ${brand.entity_version}, 1, 'approved',
        ${JSON.stringify(content)}, ${time}, ${userId}, ${time}
      )`;
    const target = `${sourcePath}?brandId=${brandId}`;
    for (const locale of ["en", "zh-CN"] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(target);
        const start = main.locator("header").getByRole("link", { name: copy[locale].start, exact: true });
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expectLayout(page, start);
        await activate(page, start);
        await expect(picker).toBeFocused();
        await expect(picker).toBeInViewport({ ratio: 1 });
        if (width === 375) await page.screenshot({ path: `${shots}/empty-${locale}-375.png` });
      }
    }

    await picker.setInputFiles([
      { name: fileName, mimeType: "text/plain", buffer: Buffer.from(`${excerpt}\f`) },
      { name: "ready.txt", mimeType: "text/plain", buffer: Buffer.from(`${longFragment}\fRead back this page`) },
      { name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n/Encrypt\n%%EOF") },
    ]);
    const postGate = Promise.withResolvers<void>();
    let posts = 0;
    const importURL = (url: URL) => url.pathname === sourcePath && url.searchParams.get("brandId") === brandId;
    await page.route(importURL, async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await postGate.promise;
      }
      await route.continue();
    });
    const zh = copy["zh-CN"];
    try {
      await activate(page, main.getByRole("button", { name: zh.submit, exact: true }));
      await expect(main.getByRole("button", { name: zh.pending, exact: true })).toBeDisabled();
      await expect(main.getByRole("status")).toHaveText(zh.pending);
      await page.keyboard.press("Enter");
      await page.screenshot({ path: `${shots}/pending-zh-CN-375.png` });
    } finally {
      postGate.resolve();
    }
    await expect(page).toHaveURL(/[?&]batch=[a-f0-9-]{36}/);
    expect(posts).toBe(1);
    await page.unroute(importURL);
    const result = sourcePath + new URL(page.url()).search;
    const partial = main.locator("li").filter({ has: page.getByText(fileName, { exact: true }) });
    const persisted = await db`select status, reason from source_original where brand_id = ${brandId} order by status`;
    expect(persisted).toEqual([{ status: "failed", reason: "encrypted" }, { status: "partial", reason: null }, { status: "ready", reason: null }]);
    expect(await db`select id from brand_fact_version where brand_id = ${brandId}`).toEqual([{ id: factVersionId }]);
    expect(await db`select id from stored_object where owner_id = ${userId} and visibility = 'internal' and status = 'ready'`).toHaveLength(2);
    const downloadHref = await partial.getByRole("link", { name: "下载原件", exact: true }).getAttribute("href");
    if (!downloadHref) throw new Error("The partial original has no download link");
    const downloaded = await context.request.get(downloadHref);
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(Buffer.from(`${excerpt}\f`));

    for (const locale of locales) {
      const words = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(result);
        const view = main.getByRole("link", { name: words.results, exact: true });
        const batch = main.getByRole("heading", { name: words.batch, exact: true });
        await expect(main.getByRole("status").filter({ hasText: words.summary })).toBeVisible();
        await expectLayout(page, view);
        await expect(main.getByText(longFragment, { exact: true })).toBeVisible();
        await expect(main.getByText(words.encrypted)).toBeVisible();
        if (width !== 768) await page.screenshot({ path: `${shots}/result-${locale}-${width}.png` });
        await activate(page, view);
        await expect(batch).toBeFocused();
        await expect(batch).toBeInViewport({ ratio: 1 });
      }
      for (const label of [excerpt, words.partial, words.missing, words.conflict(factVersionId), words.noConflict, `${words.page} 1`, `${words.page} 2`]) {
        await expect(partial.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(main.getByText(words.notApproved, { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 375, height: 900 });
      await context.addCookies([{ name: "geo-source-originals-read", value: "slow-unavailable", url: baseURL }]);
      await page.goto(result, { waitUntil: "commit" });
      await expect(main.getByRole("status")).toContainText(words.loading);
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(main.getByRole("alert")).toHaveText(words.unavailable);
      await expect(main.getByRole("heading", { name: words.title, exact: true })).toBeVisible();
      await expect(main.getByText(excerpt, { exact: true })).toHaveCount(0);
      await expect(main.getByText("Private source originals fixture failure")).toHaveCount(0);
      const retry = main.getByRole("link", { name: words.reload, exact: true });
      await expect(retry).toHaveAttribute("href", result);
      await expectLayout(page, retry);
      await page.screenshot({ path: `${shots}/unavailable-${locale}-375.png` });
      await context.clearCookies({ name: "geo-source-originals-read" });
      await activate(page, retry);
      await expect(main.getByRole("status").filter({ hasText: words.summary })).toBeVisible();
    }

    await other.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    const otherPage = await other.newPage();
    await otherPage.setViewportSize({ width: 375, height: 900 });
    await otherPage.goto(result);
    await expect(otherPage.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(otherPage.locator("main").getByRole("alert")).toHaveText("This brand could not be found or you do not have access to it.");
    await expectLayout(otherPage, otherPage.getByRole("link", { name: "Back to content", exact: true }));
    await expect(otherPage.getByText(fileName, { exact: true })).toHaveCount(0);
    await expect(otherPage.locator('input[name="files"]')).toHaveCount(0);
    expect((await other.request.get(downloadHref)).status()).toBe(404);

    await db`insert into brand_member_grant (id, brand_id, user_id, role, active, created_at)
      values (${randomUUID()}, ${brandId}, ${otherId}, 'member', 1, ${time})`;
    await otherPage.goto(target);
    await expect(otherPage.getByText("You can review the import history for this brand.", { exact: true })).toBeVisible();
    await expect(otherPage.getByText(excerpt, { exact: true })).toBeVisible();
    await expect(otherPage.locator('input[name="files"]')).toHaveCount(0);
    await expect(otherPage.getByRole("link", { name: "Download original", exact: true })).toHaveCount(0);
    await activate(otherPage, otherPage.getByRole("link", { name: "View import history", exact: true }));
    await expect(otherPage.getByRole("heading", { name: "Import history", exact: true })).toBeFocused();
    expect((await other.request.get(downloadHref)).status()).toBe(404);
  } finally {
    try {
      if (otherId) cleanupAccount(otherId, otherEmail);
      if (userId) cleanupAccount(userId, email);
      expect(await db`select id from "user" where id in (${userId}, ${otherId})`).toHaveLength(0);
      expect(await db`select id from stored_object where owner_id = ${userId}`).toHaveLength(0);
      if (brandId) {
        expect(await db`select id from brand where id = ${brandId}`).toHaveLength(0);
        expect(await db`select id from source_original where brand_id = ${brandId}`).toHaveLength(0);
        expect(await db`select id from source_original_fragment where brand_id = ${brandId}`).toHaveLength(0);
        expect(await db`select fragment_id from source_original_fragment_conflict where brand_id = ${brandId}`).toHaveLength(0);
      }
    } finally {
      await db.end();
      await other.close();
    }
  }
});
