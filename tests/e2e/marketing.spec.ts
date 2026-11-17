import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";

const baseURL = "http://localhost:3100";
const accountName = "官网🚀 Visitor É";

function localDatabaseURL() {
  const value = process.env.DATABASE_URL;
  if (!value || !URL.canParse(value) || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Marketing tests require a local development database");
  }
  return value;
}

async function disposableAccount(context: BrowserContext) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const email = `b03-${randomBytes(10).toString("hex")}@example.invalid`;
  try {
    const response = await registerTestAccount(context, {
      name: accountName, email, password: randomBytes(24).toString("base64url"),
    });
    expect(response.status(), "Disposable marketing account registration").toBe(200);
    const id: string = (await response.json()).user.id;
    return { id, cookies: await context.cookies(), cleanup: async () => {
      try { await sql`delete from "user" where id = ${id} and email = ${email}`; }
      finally { await sql.end(); }
    } };
  } catch (error) {
    try { await sql`delete from "user" where email = ${email}`; }
    finally { await sql.end(); }
    throw error;
  }
}

type Account = Awaited<ReturnType<typeof disposableAccount>>;
const test = base.extend<object, { account: Account }>({
  account: [async ({ browser }, provide) => {
    const context = await browser.newContext({ baseURL });
    const account = await disposableAccount(context);
    try { await provide(account); }
    finally { await account.cleanup(); await context.close(); }
  }, { scope: "worker" }],
});

async function setLanguage(context: BrowserContext, locale: string) {
  await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const locale of ["zh-CN", "en"] as const) {
  const english = locale === "en";
  const start = english ? "Get started" : "开始体验";
  const continueLabel = english ? "Continue" : "继续使用";
  const availabilityTitle = english ? "What you can do today" : "当前可以做什么";

  for (const width of [375, 768, 1440]) {
    test(`${locale}: truthful public scope and identity navigation at ${width}px`, async ({ page, context, account }, testInfo) => {
      await setLanguage(context, locale);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const businessWrites: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/")) businessWrites.push(request.url());
      });
      await page.goto("/?source=保留#availability");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const scope = page.getByRole("region", { name: availabilityTitle });
      await expect(scope).toContainText(english ? "No real monitoring channels are open" : "当前没有已开放的真实监测通道");
      await expect(scope).toContainText(english ? "Brand onboarding and draft recovery are not open yet" : "品牌引导与草稿恢复尚未开放");
      await expect(scope).toContainText(english ? "The real pilot is not open yet" : "真实试点尚未开放");
      await expect(scope).toContainText(english ? "data request channel" : "数据请求渠道");
      await expect(scope).toContainText(english ? "password recovery and email verification" : "密码找回、邮箱验证");
      await expect(page.getByText(english ? "Illustrative flow · Not open yet" : "流程示意 · 尚未开放", { exact: true })).toBeVisible();
      await expect(page.getByText(english ? "This is an illustration of the product direction" : "以上仅为产品方向示意", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: continueLabel, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: start, exact: true })).toHaveAttribute("href", "/login?mode=signup");
      await expect(page.locator("body")).not.toContainText(/免费无限|提升\s*\d+%|unlimited free|guaranteed #1/i);
      await noOverflow(page);
      // Both section links remain keyboard reachable on small screens.
      const availabilityLink = page.getByRole("link", { name: english ? "Current availability" : "当前开放范围", exact: true });
      await availabilityLink.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#availability$/);
      await expect(page.getByRole("heading", { name: availabilityTitle })).toBeInViewport();
      const capabilities = page.getByRole("link", { name: english ? "Capabilities" : "产品能力", exact: true });
      await capabilities.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#capabilities$/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("public-home.png"), fullPage: true });
      await page.getByRole("link", { name: start, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/login\?mode=signup$/);
      await expect(page.getByRole("tab", { name: english ? "Create account" : "创建账号", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.goto("/");
      await page.getByRole("link", { name: english ? "Sign in" : "登录", exact: true }).click();
      await expect(page.getByRole("tab", { name: english ? "Sign in" : "登录", exact: true })).toHaveAttribute("aria-selected", "true");

      await context.addCookies(account.cookies);
      await page.goto("/?source=保留#availability");
      await expect(page.getByRole("link", { name: start, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: english ? "Sign in" : "登录", exact: true })).toHaveCount(0);
      const continued = page.getByRole("link", { name: continueLabel, exact: true });
      await expect(continued).toHaveAttribute("href", "/dashboard");
      const location = page.url();
      const select = page.getByRole("combobox");
      await select.focus();
      await select.press(english ? "ArrowUp" : "ArrowDown");
      await select.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("lang", english ? "zh-CN" : "en");
      await expect(select).toBeFocused();
      expect(page.url()).toBe(location);
      await noOverflow(page);
      const session = await (await context.request.get("/api/auth/get-session")).json();
      expect(session.user.id).toBe(account.id);
      const continueAfterSwitch = page.getByRole("link", { name: english ? "继续使用" : "Continue", exact: true });
      await continueAfterSwitch.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);
      expect(businessWrites).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`${locale}: account failures keep the public page readable and identity recoverable`, async ({ page, context, account }, testInfo) => {
    await context.addCookies(account.cookies);
    await setLanguage(context, locale);
    for (const [cookie, message] of [
      ["geo-auth-unconfigured", english ? "Account services are not configured" : "账号服务尚未配置"],
      ["geo-auth-unavailable", english ? "We could not confirm your sign-in status" : "暂时无法确认登录状态"],
    ]) {
      await context.addCookies([{ name: cookie, value: "1", url: baseURL }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("status")).toContainText(message);
        await expect(page.getByRole("heading", { name: availabilityTitle })).toBeVisible();
        await expect(page.getByRole("link", { name: continueLabel, exact: true })).toHaveCount(0);
        await expect(page.locator("body")).not.toContainText(/Private auth test failure|DATABASE_URL|BETTER_AUTH_SECRET/);
        await noOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`${cookie}-${width}.png`), fullPage: true });
      }
      await page.getByRole("navigation").getByRole("link", { name: english ? "Check account access" : "查看账号入口" }).click();
      await expect(page.getByLabel(english ? "Password" : "密码", { exact: true })).toBeDisabled();
      await context.clearCookies({ name: cookie });
      if (cookie === "geo-auth-unavailable") {
        await page.getByRole("button", { name: english ? "Retry account services" : "重试账号服务" }).focus();
        await page.keyboard.press("Enter");
      } else {
        await page.reload();
      }
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);
    }
  });

  test(`${locale}: forged and expired cookies never grant a continue entry`, async ({ page, context, account }) => {
    await setLanguage(context, locale);
    const sessionCookie = account.cookies.find((cookie) => cookie.name.endsWith("session_token"));
    expect(sessionCookie).toBeDefined();
    if (!sessionCookie) throw new Error("Expected a session cookie");
    await context.addCookies([{ ...sessionCookie, value: "forged-session-token" }]);
    await page.goto("/");
    await expect(page.getByRole("link", { name: start, exact: true })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    const expired = await disposableAccount(context);
    try {
      const sql = postgres(localDatabaseURL(), { max: 1 });
      try { await sql`update session set expires_at = ${new Date(Date.now() - 60_000)} where user_id = ${expired.id}`; }
      finally { await sql.end(); }
      await page.goto("/");
      await expect(page.getByRole("link", { name: start, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: continueLabel, exact: true })).toHaveCount(0);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/login\?returnTo=/);
    } finally { await expired.cleanup(); }
  });
}

test("SSR keeps public identity and language separate between concurrent requests", async ({ request, account }) => {
  const cookie = account.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const english = i % 2 === 0;
    const signedIn = i % 3 === 0;
    const locale = english ? "en" : "zh-CN";
    const response = await request.get("/", { headers: { Cookie: `${signedIn ? `${cookie}; ` : ""}geo-locale=${locale}` } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain(english ? "The real pilot is not open yet" : "真实试点尚未开放");
    expect(html).toContain(signedIn ? (english ? ">Continue<" : ">继续使用<") : (english ? ">Get started<" : ">开始体验<"));
    expect(html).not.toContain(accountName);
    expect(html).not.toContain(account.id);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }));
});
