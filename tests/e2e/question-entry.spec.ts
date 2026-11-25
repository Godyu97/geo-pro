import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const entryPath = "/dashboard/brands/questions";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成入口品牌-${"LongName_".repeat(4)}end`;

const copy = {
  "zh-CN": {
    toggle: "切换侧边导航",
    promptsNav: "提示词问题库",
    title: "监测问题",
    noBrand: "还没有活跃品牌。下一步是先建立品牌，再整理监测问题。",
    openBrand: "去建档",
    related: "相关入口",
    overview: "返回工作台",
    closed: "真实品牌资料收集尚未开放。",
    denied: "当前账号不在开发环境品牌联调名单中，不能查看或冻结题集。",
    allBrands: "查看全部品牌",
    browseCandidates: "浏览默认候选",
    emptyQuestions: "还没有题目。可使用候选、逐行粘贴或手工输入。",
    loading: "正在加载监测问题…",
    unavailable: "暂时无法读取或保存。请刷新核对结果后重试。",
    reload: "重新载入",
    privateFailure: "Private question entry fixture failure",
  },
  en: {
    toggle: "Toggle sidebar navigation",
    promptsNav: "Question library",
    title: "Monitoring questions",
    noBrand: "No active brand yet. The next step is to set up a brand before organizing monitoring questions.",
    openBrand: "Open brands",
    related: "Related entries",
    overview: "Back to overview",
    closed: "Collection of real brand materials is still closed.",
    denied: "This account is not on the development brand-intake allowlist and cannot view or freeze question sets.",
    allBrands: "View all brands",
    browseCandidates: "Browse default candidates",
    emptyQuestions: "No questions yet. Use a candidate, paste lines, or type one.",
    loading: "Loading monitoring questions…",
    unavailable: "The questions could not be read or saved. Refresh and check the result before trying again.",
    reload: "Reload",
    privateFailure: "Private question entry fixture failure",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Question entry visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function capture(page: Page, dir: string | undefined, name: string) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false });
}

test("question entry shows the next action, then opens the active brand questions", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_QUESTION_ENTRY_SCREENSHOTS || ".cache/issue-135/question-entry";
  const ownerEmail = `question-entry-${randomUUID()}@example.invalid`;
  const outsiderEmail = `question-entry-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  let brandId = "";

  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: copy["zh-CN"].toggle, exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await activateFromKeyboard(page, dialog.getByRole("link", { name: copy["zh-CN"].promptsNav, exact: true }));
    await expect(page).toHaveURL(entryPath);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=prompts]")).toContainText(t.promptsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toBeVisible();
        const openBrand = main.getByRole("link", { name: t.openBrand, exact: true });
        await expect(openBrand).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByRole("link", { name: t.overview, exact: true })).toBeVisible();
        await expect(main.getByText(brandName)).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(openBrand).toBeInViewport();
          await capture(page, screenshotDir, `nobrand-${locale}-375.png`);
        }
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].openBrand, exact: true }));
    await expect(page).toHaveURL("/dashboard/brands");

    const createdBrand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: accounts[0].userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "合成监测问题入口视觉验收资料。",
          website: "https://question-entry.example.com/guide",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(createdBrand.status()).toBe(200);
    brandId = (await createdBrand.json()).id as string;
    const questionsHref = `/dashboard/brands/${brandId}/questions`;

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: copy["zh-CN"].toggle, exact: true }).focus();
    await page.keyboard.press("Enter");
    await activateFromKeyboard(page, page.getByRole("dialog").getByRole("link", { name: copy["zh-CN"].promptsNav, exact: true }));
    await expect(page).toHaveURL(questionsHref);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page).toHaveURL(questionsHref);
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=prompts]")).toContainText(t.promptsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyQuestions, { exact: true })).toBeVisible();
        const browse = main.getByRole("link", { name: t.browseCandidates, exact: true });
        await expect(browse).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(browse).toBeInViewport();
          await capture(page, screenshotDir, `active-${locale}-375.png`);
        }
      }
    }

    for (const access of ["closed", "denied"] as const) {
      for (const locale of locales) {
        const t = copy[locale];
        await context.addCookies([
          { name: "geo-locale", value: locale, url: origin },
          { name: "geo-question-entry-access", value: access, url: origin },
        ]);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(entryPath);
          await page.evaluate(() => window.scrollTo(0, 0));
          await expect(page).toHaveURL(entryPath);
          const main = page.getByRole("main");
          await expect(main).toHaveCount(1);
          await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
          await expect(main.getByRole("status")).toContainText(access === "closed" ? t.closed : t.denied);
          const allBrands = main.getByRole("link", { name: t.allBrands, exact: true });
          await expect(allBrands).toBeVisible();
          await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
          await expect(main.getByText(t.noBrand, { exact: true })).toHaveCount(0);
          await expectNoOverflow(page);
          if (width === 375) {
            await expect(allBrands).toBeInViewport();
            await capture(page, screenshotDir, `${access}-${locale}-375.png`);
          }
        }
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-question-entry-access", value: "closed", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    await expect(page).toHaveURL(entryPath);
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].allBrands, exact: true }));
    await expect(page).toHaveURL("/dashboard/brands");
    await context.clearCookies({ name: "geo-question-entry-access" });

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(entryPath);
    await expect(stranger).toHaveURL(entryPath);
    await expect(stranger.getByRole("main").getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-question-entry-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(entryPath, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(page).toHaveURL(entryPath);
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-question-entry-read" });
      await activateFromKeyboard(page, reload);
      await expect(page).toHaveURL(questionsHref);
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify(account),
      ], { stdio: "inherit" });
    }
  }
});
