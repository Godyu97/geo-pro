import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/crawler-visits";
const api = "/api/reports/crawler-visits";
const headers = { Origin: origin };
const shots = ".cache/issue-135/crawler-visits";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const probeCookie = "geo-crawler-visits-read";
const copy = {
  "zh-CN": {
    title: "爬虫访问", open: "打开爬虫访问", start: "开始登记", brands: "前往品牌资料",
    empty: "还没有爬虫访问。", noBrands: "当前没有可登记访问的品牌。",
    brand: "品牌", list: "访问记录", verified: "已核验访问", unverified: "未核验访问",
    citations: "回答引用数", reload: "重新载入", loading: "正在加载爬虫访问…",
    unavailable: "爬虫访问暂时不可用，请稍后重试。",
  },
  en: {
    title: "Crawler visits", open: "Open crawler visits", start: "Start recording", brands: "Go to brands",
    empty: "There are no crawler visits yet.", noBrands: "There is no brand available for a visit record.",
    brand: "Brand", list: "Visit observations", verified: "Verified visit", unverified: "Unverified visit",
    citations: "Answer citations", reload: "Reload", loading: "Loading crawler visits…",
    unavailable: "Crawler visits are temporarily unavailable. Try again shortly.",
  },
} as const;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];

async function register(context: BrowserContext) {
  const email = `crawler-visits-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Crawler visits visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: keyof typeof copy, width: number, viaReports = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaReports ? "/dashboard/reports" : path);
  if (viaReports) await activate(page, page.getByRole("link", { name: copy[locale].open, exact: true }));
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="reports"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(copy[locale].title));
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375 || width === 1440) await page.screenshot({ path: `${shots}/${shot}-${width}.png` });
}

test("crawler observations have a keyboard entry and keep visit identity separate from citations", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local PostgreSQL database");
  }
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Array<{ userId: string; email: string }> = [];
  let brandId: string | undefined;
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    const brand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "Synthetic brand for crawler visit acceptance.",
          website: "https://crawler.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    const list = async () => {
      const response = await context.request.get(api, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width, locale === "zh-CN" && width === 375);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start }), width, `empty-${locale}`);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeInViewport();
        await expect(main.getByRole("combobox", { name: copy[locale].brand, exact: true })).toHaveValue(brandId);
      }
    }

    const main = await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].start }));
    const brandField = main.getByRole("combobox", { name: "品牌", exact: true });
    await expect(brandField).toBeFocused();
    expect(await brandField.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.screenshot({ path: `${shots}/focus-zh-CN.png` });

    const citations = main.getByRole("spinbutton", { name: copy["zh-CN"].citations, exact: true });
    const verification = main.getByRole("combobox", { name: "核验标记", exact: true });
    const claim = main.getByRole("combobox", { name: "声称", exact: true });
    const save = main.getByRole("button", { name: "保存访问", exact: true });
    await expect(claim).toHaveValue("true");
    await expect(verification).toHaveValue("false");
    await citations.fill("-1");
    await activate(page, save);
    await expect(citations).toBeFocused();
    expect(await citations.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
    expect((await list()).observations).toEqual([]);

    await citations.fill("0");
    await activate(page, save);
    await expect(main.getByRole("status").filter({ hasText: "已保存这条访问" })).toBeVisible();
    await expect(save).toBeFocused();
    const unverified = (await list()).observations[0];
    expect(unverified).toMatchObject({ brandId, identity: "unverified", citations: 0, calledIncluded: false });

    await verification.selectOption("true");
    await citations.fill("1234");
    await page.route(`**${api}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Private crawler save fixture failure" } },
    }), { times: 1 });
    await activate(page, save);
    await expect(main.getByRole("alert")).toHaveText(copy["zh-CN"].unavailable);
    await expect(main).not.toContainText("Private crawler save fixture failure");
    await expect(citations).toHaveValue("1234");
    await expect(verification).toHaveValue("true");
    await expect(save).toBeFocused();
    expect((await list()).observations).toEqual([unverified]);

    const language = page.getByRole("combobox", { name: "界面语言", exact: true });
    await language.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(main.getByRole("alert")).toHaveText(copy.en.unavailable);
    await expect(main.getByRole("spinbutton", { name: copy.en.citations, exact: true })).toHaveValue("1234");
    await expect(main.getByRole("combobox", { name: "Verification mark", exact: true })).toHaveValue("true");
    expect((await list()).observations).toEqual([unverified]);
    await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    await activate(page, save);
    await expect(main.getByRole("status").filter({ hasText: "已保存这条访问" })).toBeVisible();
    await expect(save).toBeFocused();
    await expect(citations).toHaveValue("0");
    const stored = await list();
    expect(stored.observations).toHaveLength(2);
    const verified = stored.observations.find((item: { identity: string }) => item.identity === "verified");
    expect(verified).toMatchObject({ brandId, identity: "verified", citations: 1234, calledIncluded: false });
    const exact = await context.request.get(`${api}?id=${unverified.id}`, { headers });
    expect(exact.status()).toBe(200);
    expect(await exact.json()).toEqual({ observation: unverified });

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width);
        const entries = main.getByRole("region", { name: copy[locale].list });
        await expect(entries.getByRole("listitem")).toHaveCount(2);
        for (const [identity, count] of [[copy[locale].unverified, "0"], [copy[locale].verified, "1,234"]]) {
          const row = entries.getByRole("listitem").filter({ has: page.getByText(identity, { exact: true }) });
          await expect(row.getByText(brandName, { exact: true })).toBeVisible();
          await expect(row.getByText(`${copy[locale].citations} ${count}`, { exact: true })).toBeVisible();
        }
        await expect(entries).not.toContainText(/收录|推荐|inclusion|recommended/i);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start }), width, `saved-${locale}`);
        if (width === 375) await entries.screenshot({ path: `${shots}/observations-${locale}.png` });
      }
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy[locale].loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(main.getByRole("region", { name: copy[locale].list })).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      const failed = await visit(page, locale, 375);
      await expect(failed.getByRole("alert")).toHaveText(copy[locale].unavailable);
      await expect(failed.getByRole("combobox")).toHaveCount(0);
      await expect(failed.getByRole("region", { name: copy[locale].list })).toHaveCount(0);
      await expect(failed).not.toContainText(brandName);
      await expect(failed).not.toContainText("Private crawler visits fixture failure");
      const reload = failed.getByRole("link", { name: copy[locale].reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(main.getByRole("listitem").filter({ hasText: brandName })).toHaveCount(2);
      expect(await list()).toEqual(stored);
    }

    const stranger = await outsider.newPage();
    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(stranger, locale, width);
        await expect(main.getByText(copy[locale].noBrands, { exact: true })).toBeVisible();
        await expect(main.getByRole("combobox")).toHaveCount(0);
        await expect(main).not.toContainText(brandName);
        await checkLayout(stranger, main.getByRole("link", { name: copy[locale].brands }), width, `no-brand-${locale}`);
      }
    }
    const refusedRead = await outsider.request.get(`${api}?id=${unverified.id}`, { headers });
    expect(refusedRead.status()).toBe(404);
    const refusedWrite = await outsider.request.post(api, {
      headers, data: { brandId, userAgentClaimsAi: true, identityVerified: false, answerCitations: 0 },
    });
    expect(refusedWrite.status()).toBe(404);
    const outsiderList = await outsider.request.get(api, { headers });
    expect(outsiderList.status()).toBe(200);
    expect(await outsiderList.json()).toEqual({ brands: [], observations: [] });
    expect(await list()).toEqual(stored);
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
    const sql = postgres(databaseURL, { max: 1 });
    try {
      for (const { userId, email } of accounts) {
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from crawler_observation where owner_id = ${userId}) as observation`;
        expect(remaining).toEqual({ account: false, brand: false, observation: false });
      }
      if (brandId) {
        const versions = await sql`select 1 from brand_version where brand_id = ${brandId}`;
        expect(versions).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
