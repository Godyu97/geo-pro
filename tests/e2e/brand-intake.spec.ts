import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成建档${"LongSegment".repeat(5)}`;
const description = "合成建档视觉验收，仅用于隔离浏览器。";

const copy = {
  "zh-CN": {
    list: "建立品牌或继续草稿",
    title: "建立品牌",
    task: "下一步是填写品牌名称。保存草稿后可以继续。",
    taskDraft: "已有草稿。下一步是继续填写并保存品牌。",
    taskActive: "这个账号已有活跃品牌。下一步是查看该品牌。归档后才能建立另一个。",
    start: "开始填写",
    resume: "继续草稿",
    view: "查看品牌",
    limit: "每个账号最多有一个活跃品牌。",
    stepBrand: "品牌",
    scope: "关注范围",
    region: "目标地区",
    name: "品牌名称",
    business: "一句话业务",
    next: "下一步",
    back: "上一步",
    saving: "正在保存…",
    saved: "草稿已保存。",
    loading: "正在载入品牌资料…",
    unavailable: "暂时无法处理品牌资料。请稍后重试。",
    reload: "重新载入",
    related: "相关入口",
    privateFailure: "Private brand intake fixture failure",
  },
  en: {
    list: "Set up a brand or resume a draft",
    title: "Set up a brand",
    task: "The next step is to enter the brand name. A saved draft can be continued later.",
    taskDraft: "A draft is already saved. The next step is to continue and save the brand.",
    taskActive: "This account already has an active brand. The next step is to view that brand. Archive it before setting up another.",
    start: "Start the form",
    resume: "Continue draft",
    view: "View brand",
    limit: "Each account can have one active brand.",
    stepBrand: "Brand",
    scope: "Focus area",
    region: "Target region",
    name: "Brand name",
    business: "One-sentence business description",
    next: "Next",
    back: "Back",
    saving: "Saving…",
    saved: "Draft saved.",
    loading: "Loading brand details…",
    unavailable: "We couldn’t process the brand details. Try again shortly.",
    reload: "Reload",
    related: "Related entries",
    privateFailure: "Private brand intake fixture failure",
  },
} as const;

async function register(context: BrowserContext, email: string, password: string) {
  const response = await registerTestAccount(context, {
    name: "Brand intake visual test",
    email,
    password,
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

test("brand intake keeps the next action, draft resume, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_BRAND_INTAKE_SCREENSHOTS || ".cache/issue-135/brand-intake";
  const ownerEmail = `brand-intake-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-intake-other-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];

  try {
    const ownerId = await register(context, ownerEmail, password);
    accounts.push({ userId: ownerId, email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail, randomBytes(24).toString("base64url")), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        if (locale === "zh-CN" && width === 375) {
          await page.goto("/dashboard/brands");
          await activateFromKeyboard(page, page.getByRole("link", { name: t.list, exact: true }));
          await expect(page).toHaveURL("/dashboard/brands/new");
        } else {
          await page.goto("/dashboard/brands/new");
        }
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.task, { exact: true })).toBeVisible();
        const start = main.getByRole("link", { name: t.start, exact: true });
        await expect(start).toBeInViewport();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByLabel(t.name, { exact: true })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await activateFromKeyboard(page, start);
          await expect(main.getByLabel(t.name, { exact: true })).toBeFocused();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
        }
      }
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-brand-intake-write", value: "slow", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/brands/new");
    const main = page.getByRole("main");
    await main.getByLabel(tZh.name, { exact: true }).fill(brandName);
    await main.getByLabel(tZh.business, { exact: true }).fill(description);
    const next = main.getByRole("button", { name: tZh.next, exact: true });
    let posts = 0;
    const countPosts = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && request.url().endsWith("/api/brands")) posts += 1;
    };
    page.on("request", countPosts);
    const posted = page.waitForResponse((response) => response.url().endsWith("/api/brands") && response.request().method() === "POST");
    await next.focus();
    await page.keyboard.press("Enter");
    const saving = main.getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    const draftBody = await (await posted).json() as { kind: string; version: string };
    await expect(main.getByRole("heading", { level: 2, name: tZh.scope, exact: true })).toBeVisible();
    await expect(main.getByText(tZh.saved, { exact: true })).toBeVisible();
    expect(draftBody.kind).toBe("draft");
    expect(posts).toBe(1);
    page.off("request", countPosts);
    await context.clearCookies({ name: "geo-brand-intake-write" });

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/brands/new");
        const draftMain = page.getByRole("main");
        await expect(draftMain).toHaveCount(1);
        await expect(draftMain.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(draftMain.getByText(t.taskDraft, { exact: true })).toBeVisible();
        await expect(draftMain.getByText(brandName, { exact: true })).toBeVisible();
        const resume = draftMain.getByRole("link", { name: t.resume, exact: true });
        await expect(resume).toBeInViewport();
        await expect(draftMain.getByRole("link", { name: t.start, exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await activateFromKeyboard(page, resume);
          await expect(draftMain.getByLabel(t.region, { exact: true })).toBeFocused();
          await draftMain.getByRole("button", { name: t.back, exact: true }).click();
          await expect(draftMain.getByLabel(t.name, { exact: true })).toHaveValue(brandName);
          await capture(page, screenshotDir, `draft-${locale}-375.png`);
        }
      }
    }

    const created = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: ownerId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: draftBody.version,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description,
          website: "",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(created.status()).toBe(200);
    const { id: brandId } = await created.json() as { id: string };

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/brands/new");
        const activeMain = page.getByRole("main");
        await expect(activeMain).toHaveCount(1);
        await expect(activeMain.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(activeMain.getByText(t.taskActive, { exact: true })).toBeVisible();
        await expect(activeMain.getByText(t.limit, { exact: true })).toBeVisible();
        await expect(activeMain.getByText(brandName, { exact: true })).toBeVisible();
        const view = activeMain.getByRole("link", { name: t.view, exact: true });
        await expect(view).toBeInViewport();
        await expect(view).toHaveAttribute("href", `/dashboard/brands/${brandId}`);
        await expect(activeMain.getByLabel(t.name, { exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) await capture(page, screenshotDir, `active-${locale}-375.png`);
      }
    }

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto("/dashboard/brands/new");
    const strangerMain = stranger.getByRole("main");
    await expect(strangerMain.getByRole("heading", { level: 1, name: copy.en.title, exact: true })).toBeVisible();
    await expect(strangerMain.getByRole("link", { name: copy.en.start, exact: true })).toBeVisible();
    await expect(strangerMain.getByText(brandName, { exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-intake-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto("/dashboard/brands/new", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByRole("textbox")).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-intake-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: t.view, exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    }
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
  }
});
