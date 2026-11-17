import { test as base, expect, type BrowserContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";

const execute = promisify(execFile);
const baseURL = "http://localhost:3100";
type Account = { id: string; cookies: Awaited<ReturnType<BrowserContext["cookies"]>> };
type Accounts = { operator: Account; maintainer: Account; ordinary: Account; reset: () => Promise<void> };

const test = base.extend<object, { accounts: Accounts }>({
  accounts: [async ({ browser }, provide) => {
    const value = process.env.DATABASE_URL;
    if (!value || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) throw new Error("Maintenance browser tests require local PostgreSQL");
    const sql = postgres(value, { max: 1 });
    const created: string[] = [];
    async function account(name: string): Promise<Account> {
      const context = await browser.newContext({ baseURL });
      try {
        const response = await registerTestAccount(context, { name, email: `b08-ui-${randomBytes(10).toString("hex")}@example.invalid`, password: randomBytes(24).toString("base64url") });
        expect(response.status()).toBe(200);
        const id: string = (await response.json()).user.id;
        created.push(id);
        return { id, cookies: await context.cookies() };
      } finally { await context.close(); }
    }
    try {
      const operator = await account("Synthetic B08 project owner");
      const maintainer = await account("Synthetic B08 separate maintainer 🚀");
      const ordinary = await account("Synthetic B08 ordinary account");
      await provide({ operator, maintainer, ordinary, reset: async () => { await sql`delete from maintenance_grant where user_id = ${maintainer.id}`; } });
    } finally {
      if (created.length) {
        // Only synthetic fixture records from this worker are removed.
        await sql`delete from maintenance_audit where actor_id in ${sql(created)} or subject_id in ${sql(created)}`;
        await sql`delete from "user" where id in ${sql(created)}`;
      }
      await sql.end();
    }
  }, { scope: "worker" }],
});

async function change(accounts: Accounts, action: "grant" | "revoke", permission: string) {
  const { stdout } = await execute(process.execPath, ["--conditions=react-server", "scripts/maintenance-access.mjs", action, accounts.operator.id, accounts.maintainer.id, permission, action === "grant" ? "initial-setup" : "offboarding"], { env: { ...process.env, DATABASE_PROVIDER: "postgresql" } });
  expect(JSON.parse(stdout.trim()).status).toBe("allowed");
}

async function identity(context: BrowserContext, account: Account, locale: string) {
  await context.clearCookies();
  await context.addCookies([...account.cookies, { name: "geo-locale", value: locale, url: baseURL }]);
}

for (const locale of ["zh-CN", "en"] as const) {
  const english = locale === "en";
  for (const width of [375, 768, 1440]) {
    test(`${locale}: real permissions, revocation, failure and keyboard at ${width}px`, async ({ page, context, accounts }, testInfo) => {
      await accounts.reset();
      await identity(context, accounts.ordinary, locale);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [], writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/maintenance")) writes.push(request.url()); });
      const target = "/dashboard/maintenance?source=保留#current";
      const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto(target);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(new RegExp(english ? "Platform maintenance access" : "平台维护权限"));
      await expect(page.getByRole("status")).toContainText(english ? "lacks the required" : "没有所需");
      await expect(page.getByText(english ? "Not granted" : "未授予", { exact: true })).toHaveCount(3);
      await noOverflow();
      await page.screenshot({ path: testInfo.outputPath("ordinary.png"), fullPage: true });

      await change(accounts, "grant", "capabilities.manage");
      await identity(context, accounts.maintainer, locale);
      const session = await (await context.request.get("/api/auth/get-session")).json();
      expect(session.user.id).toBe(accounts.maintainer.id);
      // Reusing an identical fragment URL is a same-document navigation in the
      // browser. Reload after changing fixture cookies to request the new SSR.
      await page.reload();
      await expect(page.getByRole("status")).toContainText(english ? "Some maintenance permissions" : "已获得部分维护权限");
      await expect(page.getByText(english ? "Granted" : "已授予", { exact: true })).toHaveCount(1);
      await expect(page.getByText(english ? "Not granted" : "未授予", { exact: true })).toHaveCount(2);
      await expect(page.getByText(english ? "corresponding business operations are not open yet" : "对应业务操作尚未开放", { exact: false }).first()).toBeVisible();
      expect((await context.request.get("/api/maintenance/access?permission=quotas.manage")).status()).toBe(403);
      await noOverflow();
      await page.screenshot({ path: testInfo.outputPath("maintainer.png"), fullPage: true });

      await change(accounts, "revoke", "capabilities.manage");
      expect((await context.request.get("/api/maintenance/access?permission=capabilities.manage")).status()).toBe(403);
      const refresh = page.getByRole("link", { name: english ? "Refresh access status" : "刷新权限状态", exact: true });
      await refresh.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toContainText(english ? "lacks the required" : "没有所需");
      await noOverflow();

      await change(accounts, "grant", "support.read");
      await page.goto(target);
      const before = await (await context.request.get("/api/maintenance/access")).json();
      const nextLocale = english ? "zh-CN" : "en";
      await page.getByRole("combobox").selectOption(nextLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(english ? "平台维护权限" : "Platform maintenance access");
      await expect(page).toHaveURL(`${baseURL}/dashboard/maintenance?source=%E4%BF%9D%E7%95%99#current`);
      const after = await (await context.request.get("/api/maintenance/access")).json();
      expect(after.permissions).toEqual(before.permissions);
      expect(after.permissions).toEqual(["support.read"]);

      await context.addCookies([{ name: "geo-maintenance-unavailable", value: "1", url: baseURL }]);
      await page.reload();
      await expect(page.getByRole("status")).toContainText(english ? "暂时无法核验维护权限" : "Maintenance access cannot be verified");
      await expect(page.getByRole("link", { name: english ? "刷新权限状态" : "Refresh access status" })).toBeVisible();
      await noOverflow();
      await page.screenshot({ path: testInfo.outputPath("unavailable.png"), fullPage: true });
      await context.clearCookies({ name: "geo-maintenance-unavailable" });
      await page.getByRole("link", { name: english ? "刷新权限状态" : "Refresh access status" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toContainText(english ? "已获得部分维护权限" : "Some maintenance permissions");
      await page.getByRole("link", { name: english ? "返回工作台" : "Back to workspace", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${baseURL}/dashboard`);
      if (width < 768) await page.getByRole("button", { name: english ? "切换侧边导航" : "Toggle sidebar navigation" }).click();
      const entry = page.getByRole("link", { name: english ? "平台维护权限" : "Maintenance access", exact: true });
      await entry.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${baseURL}/dashboard/maintenance`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(english ? "平台维护权限" : "Platform maintenance access");
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`${locale}: maintenance loading is localized`, async ({ page, context, accounts }, testInfo) => {
    await identity(context, accounts.ordinary, locale);
    await context.addCookies([{ name: "geo-maintenance-slow", value: "1", url: baseURL }]);
    await page.goto("/dashboard/maintenance", { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: english ? "Checking maintenance access…" : "正在核验维护权限…" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("loading.png"), fullPage: true });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(english ? "Platform maintenance access" : "平台维护权限");
  });
}
