import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const entry = "/dashboard/content/media-reviews";
const brandName = `合成图文品牌-${"MediaReviewBrand".repeat(4)}`;
const approved = "合成价格 CNY 129";
const shown = `合成价格 CNY 99 ${"LongAssetText".repeat(16)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];

const copy = {
  "zh-CN": {
    title: "图文与口播核对",
    nav: "内容",
    noBrand: "当前没有可核对的品牌。",
    openBrands: "去建档",
    openFacts: "打开品牌事实",
    noFacts: "这个品牌还没有已批准事实。",
    empty: "还没有核对记录。",
    fill: "填写核对",
    view: "查看已保存核对",
    history: "已保存核对",
    brand: "品牌",
    entry: "图文核对",
    fact: "已批准事实",
    shown: "画面或脚本中的文字",
    save: "保存核对",
    saving: "正在保存…",
    invalid: "请检查品牌、种类、事实版本和画面文字。",
    blocked: "已阻断交付。",
    savedBlocked: "已阻断交付，并记下事实版本。",
    reason: "原因 与已批准事实不一致",
    factLine: "事实版本",
    approvedLine: "已批准值",
    shownLine: "画面或脚本文字",
    loading: "正在加载图文核对…",
    unavailable: "图文核对暂时不可用，请稍后重试。",
    reload: "重新载入",
    trace: "追踪编号",
  },
  en: {
    title: "Infographic and voiceover checks",
    nav: "Content",
    noBrand: "There is no brand available for a check.",
    openBrands: "Open brands",
    openFacts: "Open brand facts",
    noFacts: "This brand has no approved fact yet.",
    empty: "No checks yet.",
    fill: "Enter a check",
    view: "View saved checks",
    history: "Saved checks",
    brand: "Brand",
    entry: "Media checks",
    fact: "Approved fact",
    shown: "Text on the image or in the script",
    save: "Save check",
    saving: "Saving…",
    invalid: "Check the brand, kind, fact version, and shown text.",
    blocked: "Delivery is blocked.",
    savedBlocked: "Delivery is blocked, and the fact version is recorded.",
    reason: "Reason Differs from the approved fact",
    factLine: "Fact version",
    approvedLine: "Approved value",
    shownLine: "Shown text",
    loading: "Loading media checks…",
    unavailable: "Media checks are temporarily unavailable. Try again shortly.",
    reload: "Reload",
    trace: "Trace ID",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Media check fixture",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function checkLayout(page: Page, locale: (typeof locales)[number]) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("[data-workspace-section=content]")).toContainText(copy[locale].nav);
  await expect(page.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function capture(page: Page, name: string) {
  const directory = ".cache/issue-135/media-reviews";
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function approvePrice(page: Page) {
  await page.getByRole("combobox", { name: "事实类型", exact: true }).selectOption("price");
  await page.getByLabel("简称", { exact: true }).fill("合成价格");
  await page.getByLabel("主张", { exact: true }).fill(approved);
  await page.getByLabel("来源网址或材料说明", { exact: true }).fill("合成图文验收材料");
  await page.getByLabel("出处位置（页码、段落或章节）", { exact: true }).fill("合成材料第 1 段");
  await page.getByLabel("来源片段", { exact: true }).fill(approved);
  await page.getByLabel("来源日期", { exact: true }).fill("2026-11-01");
  await page.getByRole("combobox", { name: "主张公开许可", exact: true }).selectOption("public");
  await page.getByRole("combobox", { name: "有效期", exact: true }).selectOption("longTerm");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交待确认", exact: true }).click();
  await page.getByRole("checkbox", { name: "我已逐条核对主张、来源和公开许可。", exact: true }).check();
  await page.getByRole("button", { name: "确认此版本", exact: true }).click();
  await expect(page.getByText("已批准", { exact: true }).first()).toBeVisible();
}

test("media checks show the next action, persist a blocked price, and recover their read", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Media browser checks require local PostgreSQL");
  }
  const sql = postgres(url, { max: 1 });
  const accounts: { userId: string; email: string }[] = [];
  const outsider = await browser.newContext({ baseURL: origin });
  const main = page.getByRole("main");
  const action = (name: string) => main.locator("header").getByRole("link", { name, exact: true });
  const setLocale = (locale: string) => context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);

  try {
    const email = `media-check-${randomUUID()}@example.invalid`;
    const userId = await register(context, email);
    accounts.push({ userId, email });

    for (const locale of locales) {
      const t = copy[locale];
      await setLocale(locale);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entry);
        await checkLayout(page, locale);
        await expect(main.getByText(t.noBrand)).toBeVisible();
        await expect(main.getByLabel(t.shown, { exact: true })).toHaveCount(0);
        if (width === 375) {
          await expect(action(t.openBrands)).toBeInViewport();
          await capture(page, `no-brand-${locale}-375`);
          await activate(page, action(t.openBrands));
          await expect(page).toHaveURL("/dashboard/brands");
        } else {
          await expect(action(t.openBrands)).toBeVisible();
        }
      }
    }

    const brand = await context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit",
        actorId: userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "合成图文核对验收资料。",
          website: "https://media-check.example.com",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const brandId: string = (await brand.json()).id;
    const brandedEntry = `${entry}?brandId=${brandId}`;
    const factPath = `/dashboard/brands/${brandId}/facts`;

    const zh = copy["zh-CN"];
    await setLocale("zh-CN");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/content");
    await activate(page, main.getByRole("link", { name: zh.entry, exact: true }));
    await expect(page).toHaveURL(brandedEntry);

    for (const locale of locales) {
      const t = copy[locale];
      await setLocale(locale);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(brandedEntry);
        await checkLayout(page, locale);
        await expect(main.getByText(t.noFacts)).toBeVisible();
        await expect(main.getByRole("button", { name: t.save })).toBeDisabled();
        await expect(action(t.openFacts)).toHaveAttribute("href", factPath);
        if (width === 375) {
          await expect(action(t.openFacts)).toBeInViewport();
          await capture(page, `no-facts-${locale}-375`);
        }
      }
    }
    await setLocale("zh-CN");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(brandedEntry);
    await activate(page, action(zh.openFacts));
    await expect(page).toHaveURL(factPath);
    await approvePrice(page);

    const [version] = await sql`SELECT id FROM brand_fact_version WHERE brand_id = ${brandId} AND state = 'approved'`;
    const factId: string = version.id;

    for (const locale of locales) {
      const t = copy[locale];
      await setLocale(locale);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(brandedEntry);
        await checkLayout(page, locale);
        await expect(main.getByText(t.empty)).toBeVisible();
        await expect(main.getByText(brandName, { exact: true }).and(page.locator("p"))).toBeVisible();
        await expect(main.getByLabel(t.fact, { exact: true })).toHaveValue(factId);
        if (width === 375) {
          await expect(action(t.fill)).toBeInViewport();
          await activate(page, action(t.fill));
          await expect(main.getByLabel(t.brand, { exact: true })).toBeFocused();
          await capture(page, `fill-${locale}-375`);
        } else {
          await expect(action(t.fill)).toBeVisible();
        }
      }
    }

    await setLocale("zh-CN");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(brandedEntry);
    const input = main.getByLabel(zh.shown, { exact: true });
    const save = main.getByRole("button", { name: zh.save, exact: true });
    let posts = 0;
    let releaseSave = () => {};
    const holdSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route("**/api/content/media-reviews", async (route) => {
      posts += 1;
      await holdSave;
      await route.continue();
    });
    try {
      await input.fill("   ");
      await activate(page, save);
      await expect(main.getByRole("alert")).toHaveText(zh.invalid);
      await expect(input).toHaveValue("   ");
      expect(posts).toBe(0);

      await input.fill(shown);
      await page.getByLabel("界面语言", { exact: true }).selectOption("en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(main.getByLabel(copy.en.shown, { exact: true })).toHaveValue(shown);
      await expect(main.getByRole("alert")).toHaveText(copy.en.invalid);
      expect(posts).toBe(0);

      await activate(page, main.getByRole("button", { name: copy.en.save, exact: true }));
      const saving = main.getByRole("button", { name: copy.en.saving, exact: true });
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await expect.poll(() => posts).toBe(1);
      await expect(saving).toBeFocused();
      await page.keyboard.press("Enter");
      releaseSave();
      await expect(main.getByRole("status")).toHaveText(copy.en.savedBlocked);
      expect(posts).toBe(1);
    } finally {
      releaseSave();
      await page.unrouteAll({ behavior: "wait" });
    }

    for (const locale of locales) {
      const t = copy[locale];
      await setLocale(locale);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(brandedEntry);
        await checkLayout(page, locale);
        const history = main.getByRole("region", { name: t.history, exact: true });
        if (width === 375) {
          await expect(action(t.view)).toBeInViewport();
          await activate(page, action(t.view));
          await expect(history).toBeFocused();
        }
        await expect(history.getByText(t.blocked, { exact: true })).toBeVisible();
        await expect(history.getByText(`${t.factLine} ${factId}`, { exact: true })).toBeVisible();
        await expect(history.getByText(`${t.approvedLine} ${approved}`, { exact: true })).toBeVisible();
        await expect(history.getByText(`${t.shownLine} ${shown}`, { exact: true })).toBeVisible();
        await expect(history.getByText(t.reason, { exact: true })).toBeVisible();
        if (width === 375) await capture(page, `blocked-${locale}-375`);
      }
    }
    expect(await sql`
      SELECT shown_value, approved_value, fact_version_id, reason, deliver
      FROM media_review WHERE owner_id = ${userId} AND brand_id = ${brandId}
    `).toEqual([{
      shown_value: shown, approved_value: approved, fact_version_id: factId, reason: "fact_mismatch", deliver: 0,
    }]);
    expect(await sql`SELECT id FROM content_delivery_package WHERE brand_id = ${brandId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM content_publication WHERE brand_id = ${brandId}`).toHaveLength(0);

    const otherEmail = `media-check-other-${randomUUID()}@example.invalid`;
    accounts.push({ userId: await register(outsider, otherEmail), email: otherEmail });
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const stranger = await outsider.newPage();
    await stranger.goto(brandedEntry);
    await expect(stranger.getByText(copy.en.noBrand)).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(shown, { exact: false })).toHaveCount(0);
    await expect(stranger.getByText(factId, { exact: false })).toHaveCount(0);

    for (const locale of locales) {
      const t = copy[locale];
      await setLocale(locale);
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([{ name: "geo-media-reviews-read", value: "slow-unavailable", url: origin }]);
      const navigation = page.goto(brandedEntry, { waitUntil: "domcontentloaded" });
      await expect(main.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, `loading-${locale}-375`);
      await navigation;
      await expect(main.getByRole("alert")).toHaveText(t.unavailable);
      await expect(main.getByText(new RegExp(`^${t.trace} [0-9a-f-]{36}$`))).toBeVisible();
      await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(main.getByText(shown, { exact: false })).toHaveCount(0);
      await expect(main.getByText(factId, { exact: false })).toHaveCount(0);
      await expect(main.getByText("Private media review fixture failure")).toHaveCount(0);
      const reload = action(t.reload);
      await expect(reload).toBeInViewport();
      await checkLayout(page, locale);
      await capture(page, `read-error-${locale}-375`);

      await context.clearCookies({ name: "geo-media-reviews-read" });
      await activate(page, reload);
      await expect(page).toHaveURL(brandedEntry);
      await expect(main.getByLabel(t.fact, { exact: true })).toHaveValue(factId);
      await expect(main.getByText(`${t.shownLine} ${shown}`, { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
      ], { stdio: "inherit" });
      expect(await sql`SELECT id FROM "user" WHERE id = ${account.userId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM media_review WHERE owner_id = ${account.userId}`).toHaveLength(0);
    }
    await sql.end();
  }
});
