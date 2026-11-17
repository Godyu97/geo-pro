import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";

const baseURL = "http://localhost:3100";
const accountName = "会话🚀 Session É";

function localDatabaseURL() {
  const value = process.env.DATABASE_URL;
  if (!value || !URL.canParse(value) || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Session tests require a local development database");
  }
  return value;
}

type Account = { email: string; password: string; id: string };
const test = base.extend<{ account: Account }>({
  account: async ({ context }, provide) => {
    const sql = postgres(localDatabaseURL(), { max: 1 });
    const email = `b02-${randomBytes(10).toString("hex")}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    try {
      const response = await registerTestAccount(context, { name: accountName, email, password });
      expect(response.status(), "Disposable session account registration").toBe(200);
      const id: string = (await response.json()).user.id;
      await provide({ email, password, id });
    } finally {
      await sql`delete from "user" where email = ${email}`;
      await sql.end();
    }
  },
});

async function localeCookie(context: BrowserContext, locale: string) {
  await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
}

async function focusSession(page: Page) {
  const checked = page.waitForResponse((response) => response.url().includes("/api/auth/get-session"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  return checked;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const locale of ["zh-CN", "en"] as const) {
  const english = locale === "en";
  for (const width of [375, 768, 1440]) {
    test(`${locale}: session expiry restores location without replay; failed sign-out stays at ${width}px`, async ({ page, context, account }, testInfo) => {
      await localeCookie(context, locale);
      await page.setViewportSize({ width, height: 900 });
      const target = "/dashboard?filter=%E5%93%81%E7%89%8C#monitoring";
      // Keep an earlier private history entry to check back-navigation after logout.
      await Promise.all([
        page.waitForResponse((response) => response.url().includes("/api/auth/get-session")),
        page.goto("/dashboard?previous=1"),
      ]);
      const sessionChecked = page.waitForResponse((response) => response.url().includes("/api/auth/get-session"));
      await page.goto(`/login?mode=signup&returnTo=${encodeURIComponent(target)}`);
      await expect(page).toHaveURL(`${baseURL}${target}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);
      await sessionChecked;
      await noOverflow(page);

      const writes: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && !request.url().includes("/api/auth/get-session")) {
          writes.push(new URL(request.url()).pathname);
        }
      });
      const sql = postgres(localDatabaseURL(), { max: 1 });
      try {
        await sql`update session set expires_at = ${new Date(Date.now() - 60_000)} where user_id = ${account.id}`;
      } finally { await sql.end(); }
      await focusSession(page);
      await expect(page).toHaveURL(/\/login\?returnTo=.*reason=session-required/);
      await expect(page.getByRole("status")).toContainText(english ? "Sign in to continue" : "请登录后继续");
      expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      expect(writes).toEqual([]);
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("session-ended.png"), fullPage: true });

      await page.getByLabel(english ? "Email" : "邮箱", { exact: true }).fill(account.email);
      await page.getByLabel(english ? "Password" : "密码", { exact: true }).fill(account.password);
      const credentialsStored = await page.evaluate(({ email, password }) => {
        const saved = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
        return saved.includes(email) || saved.includes(password) || saved.includes("session_token");
      }, account);
      expect(credentialsStored, "Credentials must not enter browser draft storage").toBe(false);
      await page.reload();
      await expect(page.getByLabel(english ? "Password" : "密码", { exact: true })).toHaveValue("");
      await page.getByLabel(english ? "Email" : "邮箱", { exact: true }).fill(account.email);
      await page.getByLabel(english ? "Password" : "密码", { exact: true }).fill(account.password);
      const submit = page.getByRole("button", { name: english ? "Sign in and open workspace" : "登录并进入工作台", exact: true });
      await submit.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${baseURL}${target}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);
      await noOverflow(page);
      expect(writes).toEqual(["/api/auth/sign-in/email"]);

      const signOut = page.getByRole("button", { name: english ? "Sign out" : "退出登录", exact: true });
      await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 503, json: { code: "AUTH_UNAVAILABLE" } }));
      await signOut.click();
      await expect(page.getByRole("alert").filter({ hasText: english ? "Could not sign out" : "退出失败" })).toHaveText(english ? "Could not sign out. Please try again." : "退出失败，请重试");
      await expect(page).toHaveURL(`${baseURL}${target}`);
      expect((await (await context.request.get("/api/auth/get-session")).json()).user.id).toBe(account.id);
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("sign-out-failed.png"), fullPage: true });
      await page.unroute("**/api/auth/sign-out");
      await signOut.click();
      await expect(page).toHaveURL(`${baseURL}/login`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByLabel(english ? "Password" : "密码", { exact: true })).toHaveValue("");
      await page.goBack();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: new RegExp(accountName) })).toHaveCount(0);
    });
  }

  test(`${locale}: auth outages are distinct from expiry and retry preserves identity`, async ({ page, context, account }, testInfo) => {
    await localeCookie(context, locale);
    await context.addCookies([{ name: "geo-auth-unavailable", value: "1", url: baseURL }]);
    await page.goto("/login?returnTo=%2Fdashboard%3Ffilter%3Dkeep");
    const unavailable = english ? "Authentication is temporarily unavailable" : "认证服务暂不可用";
    await expect(page.getByRole("status")).toContainText(unavailable);
    await expect(page.getByLabel(english ? "Password" : "密码", { exact: true })).toBeDisabled();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`unavailable-${width}.png`), fullPage: true });
    }
    const response = await context.request.get("/api/auth/get-session");
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).code).toBe("AUTH_UNAVAILABLE");
    await expect(page.getByText("Private auth test failure", { exact: false })).toHaveCount(0);
    await context.clearCookies({ name: "geo-auth-unavailable" });
    await page.getByRole("button", { name: english ? "Retry account services" : "重试账号服务" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${baseURL}/dashboard?filter=keep`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);

    await context.addCookies([{ name: "geo-auth-unavailable", value: "1", url: baseURL }]);
    await focusSession(page);
    const sessionAlert = page.getByRole("alert").filter({ hasText: english ? "Could not check your session" : "暂时无法检查登录状态" });
    await expect(sessionAlert).toBeVisible();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await expect(page).toHaveURL(`${baseURL}/dashboard?filter=keep`);
    await context.clearCookies({ name: "geo-auth-unavailable" });
    await page.getByRole("button", { name: english ? "Reload" : "重新加载", exact: true }).click();
    await expect(sessionAlert).toHaveCount(0);
    expect((await (await context.request.get("/api/auth/get-session")).json()).user.id).toBe(account.id);

    await context.addCookies([{ name: "geo-auth-unconfigured", value: "1", url: baseURL }]);
    await page.goto("/login");
    await expect(page.getByRole("status")).toContainText(english ? "Account services are not configured" : "账号服务尚未配置");
    await expect(page.getByLabel(english ? "Password" : "密码", { exact: true })).toBeDisabled();
  });
}

test("changing identity in another tab discards the previous user's server UI", async ({ page, context, browser, account }) => {
  await localeCookie(context, "en");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/get-session")),
    page.goto("/dashboard?filter=keep#monitoring"),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(accountName);
  const other = await browser.newContext({ baseURL });
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const email = `b02-switch-${randomBytes(10).toString("hex")}@example.invalid`;
  try {
    const response = await registerTestAccount(other, {
      name: "Other identity", email, password: randomBytes(24).toString("base64url"),
    });
    expect(response.status()).toBe(200);
    const otherId: string = (await response.json()).user.id;
    expect(otherId === account.id).toBe(false);
    await context.addCookies(await other.cookies());
    await focusSession(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello, Other identity");
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText(accountName);
    await expect(page).toHaveURL(`${baseURL}/dashboard?filter=keep#monitoring`);
  } finally {
    await sql`delete from "user" where email = ${email}`;
    await sql.end();
    await other.close();
  }
});
