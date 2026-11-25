import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount, submitTestAccountForm } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成删除品牌${"LongSegment".repeat(5)}`;

const copy = {
  "zh-CN": {
    review: "预览品牌删除",
    impact: "预览删除影响",
    task: "下一步是确认删除并冻结访问。取消则返回当前品牌，不会冻结访问。",
    confirm: "确认删除并冻结访问",
    cancel: "取消删除",
    saving: "正在保存…",
    recovery: "品牌恢复",
    reauth: "请重新登录，并在登录后五分钟内确认恢复。",
    reauthenticate: "退出以重新登录",
    restore: "恢复品牌访问",
    deadline: "恢复截止时间（上海时间）",
    reference: "品牌标识",
    deletionLoading: "正在加载删除影响…",
    recoveryLoading: "正在加载品牌恢复…",
    unavailable: "暂时无法处理品牌资料。请稍后重试。",
    reload: "重新载入",
    related: "相关入口",
    missing: "找不到这个页面",
    email: "邮箱",
    password: "密码",
    signIn: "登录并进入工作台",
  },
  en: {
    review: "Review brand deletion",
    impact: "Review deletion impact",
    task: "The next step is to confirm deletion and freeze access. Cancel returns to this brand without freezing it.",
    confirm: "Confirm deletion and freeze access",
    cancel: "Cancel deletion",
    saving: "Saving…",
    recovery: "Brand recovery",
    reauth: "Sign in again and confirm recovery within five minutes of signing in.",
    reauthenticate: "Sign out to sign in again",
    restore: "Restore brand access",
    deadline: "Recovery deadline (Shanghai time)",
    reference: "Brand reference",
    deletionLoading: "Loading deletion impact…",
    recoveryLoading: "Loading brand recovery…",
    unavailable: "We couldn’t process the brand details. Try again shortly.",
    reload: "Reload",
    related: "Related entries",
    missing: "Page not found",
    email: "Email",
    password: "Password",
    signIn: "Sign in and open workspace",
  },
} as const;

async function register(context: BrowserContext, email: string, password: string) {
  const response = await registerTestAccount(context, {
    name: "Brand deletion visual test",
    email,
    password,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function verifyEmail(userId: string) {
  const url = process.env.DATABASE_URL ?? "";
  const parsed = URL.parse(url);
  if (!parsed || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Brand deletion visual test requires local PostgreSQL");
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql`update "user" set email_verified = true where id = ${userId}`;
  } finally {
    await sql.end();
  }
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

test("brand deletion and recovery keep the next action, opaque reference, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_BRAND_DELETION_SCREENSHOTS || ".cache/issue-135/brand-deletion";
  const ownerEmail = `brand-deletion-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-deletion-other-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];

  try {
    const ownerId = await register(context, ownerEmail, password);
    accounts.push({ userId: ownerId, email: ownerEmail });
    await verifyEmail(ownerId);
    accounts.push({ userId: await register(outsider, outsiderEmail, randomBytes(24).toString("base64url")), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    const created = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: ownerId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "合成品牌删除与恢复的视觉验收资料。",
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
    const brandHref = `/dashboard/brands/${brandId}`;
    const deleteHref = `${brandHref}/delete`;
    const recoveryHref = `${brandHref}/recovery`;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        if (width === 375) {
          await page.goto(brandHref);
          await activateFromKeyboard(page, page.getByRole("link", { name: t.review, exact: true }));
          await expect(page).toHaveURL(deleteHref);
        } else {
          await page.goto(deleteHref);
        }
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.impact, exact: true })).toBeVisible();
        await expect(main.getByText(t.task, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true }).first()).toBeVisible();
        const confirm = main.getByRole("button", { name: t.confirm, exact: true });
        await expect(confirm).toHaveCount(1);
        await expect(confirm).toBeInViewport();
        await expect(main.getByRole("link", { name: t.cancel, exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) await capture(page, screenshotDir, `delete-ready-${locale}-375.png`);
      }
    }

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(deleteHref);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-deletion-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(deleteHref, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.deletionLoading })).toBeVisible();
      await capture(page, screenshotDir, `delete-loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { name: t.impact, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(brandId)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `delete-unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-deletion-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true }).first()).toBeVisible();
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-brand-deletion-write", value: "slow", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(deleteHref);
    const confirm = page.getByRole("main").getByRole("button", { name: tZh.confirm, exact: true });
    let posts = 0;
    const countPosts = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && request.url().endsWith("/api/brands")) posts += 1;
    };
    page.on("request", countPosts);
    await confirm.focus();
    await page.keyboard.press("Enter");
    const saving = page.getByRole("main").getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(recoveryHref);
    expect(posts).toBe(1);
    page.off("request", countPosts);
    await context.clearCookies({ name: "geo-brand-deletion-write" });

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(recoveryHref);
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.recovery, exact: true })).toBeVisible();
        await expect(main.getByText(t.reauth, { exact: true }).first()).toBeVisible();
        const region = main.getByRole("region", { name: t.recovery, exact: true });
        await expect(region).not.toContainText(brandName);
        await expect(region.getByText(t.reference, { exact: true })).toBeVisible();
        await expect(region.getByText(brandId, { exact: true })).toBeVisible();
        await expect(region.getByText(t.deadline, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
        const reauthenticate = main.getByRole("button", { name: t.reauthenticate, exact: true });
        await expect(reauthenticate).toBeInViewport();
        await expect(main.getByRole("button", { name: t.restore, exact: true })).toHaveCount(0);
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) await capture(page, screenshotDir, `recovery-ready-${locale}-375.png`);
      }
    }

    await stranger.goto(recoveryHref);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(brandId)).toHaveCount(0);
    await expectNoOverflow(stranger);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-recovery-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(recoveryHref, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.recoveryLoading })).toBeVisible();
      await capture(page, screenshotDir, `recovery-loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { name: t.recovery, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(brandId)).toHaveCount(0);
      await expect(failed.getByText(t.deadline, { exact: true })).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `recovery-unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-recovery-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(t.deadline, { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toHaveCount(0);
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(recoveryHref);
    await page.getByRole("button", { name: tZh.reauthenticate, exact: true }).click();
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await page.getByLabel(tZh.email, { exact: true }).fill(ownerEmail);
    await page.getByLabel(tZh.password, { exact: true }).fill(password);
    const login = await submitTestAccountForm(page, page.getByRole("button", { name: tZh.signIn, exact: true }), "/api/auth/sign-in/email");
    expect(login.status()).toBe(200);
    await expect(page).toHaveURL(recoveryHref);
    const restore = page.getByRole("main").getByRole("button", { name: tZh.restore, exact: true });
    await expect(restore).toBeInViewport();
    await expect(page.getByRole("main").getByText(brandName, { exact: true })).toHaveCount(0);
    await restore.click();
    await expect(page).toHaveURL(brandHref);
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
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
