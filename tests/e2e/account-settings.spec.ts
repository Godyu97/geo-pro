import { test as base, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

import { expectTextContrast } from "./appearance-helpers";
import { registerTestAccount, submitTestAccountForm } from "./auth-helpers";

const baseURL = "http://localhost:3100";
const settings = "/dashboard/settings";
const profileUpdate = "/api/auth/update-user";
const initialName = "账户🚀 Account É";
const displayName = "负责人🚀 Owner É";

type Account = { id: string; email: string; password: string };

const test = base.extend<{ account: Account }>({
  account: async ({ context }, provide) => {
    const database = process.env.DATABASE_URL;
    if (!database || !URL.canParse(database) || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
      throw new Error("Account settings browser tests require local PostgreSQL");
    }
    const email = `b15-${randomBytes(10).toString("hex")}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    const sql = postgres(database, { max: 1 });
    try {
      const response = await registerTestAccount(context, { name: initialName, email, password });
      expect(response.status()).toBe(200);
      const { user } = await response.json();
      await provide({ id: user.id, email, password });
    } finally {
      await sql`delete from "user" where email = ${email}`;
      await sql.end();
    }
  },
});

const copy = {
  "zh-CN": {
    title: "账户设置",
    profile: "个人资料",
    name: "称呼",
    required: "请输入称呼。",
    tooLong: "称呼最多 80 个字符。",
    email: "登录邮箱（只读）",
    save: "保存称呼",
    saved: "称呼已保存。",
    failed: /暂时无法确认是否已保存/,
    data: "自助数据导出和删除暂未开放。",
    signOut: "退出登录",
    language: "界面语言",
    loading: "正在加载账户设置…",
    signIn: "登录并进入工作台",
  },
  en: {
    title: "Account settings",
    profile: "Personal profile",
    name: "Display name",
    required: "Enter a display name.",
    tooLong: "Use no more than 80 characters.",
    email: "Sign-in email (read-only)",
    save: "Save name",
    saved: "Display name saved.",
    failed: /We couldn’t confirm the save/,
    data: "Self-service data export and deletion are currently unavailable.",
    signOut: "Sign out",
    language: "Interface language",
    loading: "Loading account settings…",
    signIn: "Sign in and open workspace",
  },
} as const;

for (const locale of ["zh-CN", "en"] as const) {
  const current = copy[locale];
  const nextLocale = locale === "en" ? "zh-CN" : "en";
  const next = copy[nextLocale];

  for (const width of [375, 768, 1440]) {
    test(`${locale}: account settings validate, switch language and save at ${width}px`, async ({ page, context, account }) => {
      await page.setViewportSize({ width, height: 900 });
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith(profileUpdate)) writes.push(request.url());
      });

      const target = `${settings}?source=workspace`;
      const response = await page.goto(`${target}#data-management`);
      expect(response?.headers()["cache-control"]).toContain("no-store");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(new RegExp(current.title));
      await expect(page.getByRole("heading", { name: current.title })).toBeVisible();
      const profile = page.getByRole("region", { name: current.profile, exact: true });
      await expect(profile.locator("form")).toHaveAttribute("method", "post");
      await expect(profile.getByRole("term")).toHaveText(current.email);
      await expect(profile.getByRole("definition")).toHaveText(account.email);
      await expect(page.locator("#data-management:visible")).toContainText(current.data);
      await expect(page.getByRole("textbox")).toHaveCount(1);
      await expectTextContrast(page);

      const field = page.getByRole("textbox", { name: current.name, exact: true });
      const save = page.getByRole("button", { name: current.save, exact: true });
      await expect(field).toHaveValue(initialName);
      await field.fill("   ");
      await save.focus();
      await page.keyboard.press("Enter");
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(new RegExp(current.required));
      await field.fill("🚀".repeat(81));
      await field.press("Enter");
      await expect(field).toHaveAccessibleDescription(new RegExp(current.tooLong));

      const draft = `  ${displayName}  `;
      await field.fill(draft);
      const composingEnterPrevented = await field.evaluate((input) => !input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", isComposing: true, bubbles: true, cancelable: true,
      })));
      expect(composingEnterPrevented).toBe(true);
      expect(writes).toHaveLength(0);

      const language = page.getByRole("combobox", { name: current.language, exact: true });
      await save.focus();
      await page.keyboard.press("Tab");
      await expect(language).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: current.signOut, exact: true })).toBeFocused();
      await language.selectOption(nextLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
      await expect(page.getByRole("heading", { name: next.title })).toBeVisible();
      await expect(page).toHaveURL(`${baseURL}${target}#data-management`);
      const edited = page.getByRole("textbox", { name: next.name, exact: true });
      await expect(edited).toHaveValue(draft);
      const beforeSave = await (await context.request.get("/api/auth/get-session")).json();
      expect(beforeSave.user.id).toBe(account.id);
      expect(beforeSave.user.name).toBe(initialName);
      expect(writes).toHaveLength(0);

      await context.addCookies([{ name: "geo-auth-unavailable", value: "1", url: baseURL }]);
      const saveTranslated = page.getByRole("button", { name: next.save, exact: true });
      const failedSave = page.waitForResponse((request) => request.url().endsWith(profileUpdate));
      await saveTranslated.click();
      expect((await failedSave).status()).toBe(503);
      await expect(page.getByRole("alert").filter({ hasText: next.failed })).toBeVisible();
      await expect(page.getByText(next.saved, { exact: true })).toHaveCount(0);
      await expect(edited).toHaveValue(draft);
      await context.clearCookies({ name: "geo-auth-unavailable" });
      expect((await (await context.request.get("/api/auth/get-session")).json()).user.name).toBe(initialName);

      await edited.press("Enter");
      const translatedProfile = page.getByRole("region", { name: next.profile, exact: true });
      await expect(translatedProfile.getByRole("status")).toHaveText(next.saved);
      await expect(edited).toHaveValue(displayName);
      if (width >= 768) {
        await expect(page.locator("header").getByText(displayName, { exact: true })).toBeVisible();
      }
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
      await expect(edited).toHaveValue(displayName);
      await expect(translatedProfile.getByRole("definition")).toHaveText(account.email);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectTextContrast(page);

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(displayName);
      expect(writes).toHaveLength(2);
      expect(errors).toEqual([]);
    });
  }

  test(`${locale}: settings loading and sign-in recovery retain the entry without replay`, async ({ page, context, account }) => {
    await context.addCookies([
      { name: "geo-locale", value: locale, url: baseURL },
      { name: "geo-settings-slow", value: "1", url: baseURL },
    ]);
    const target = `${settings}?from=workspace#security`;
    const sessionReady = page.waitForResponse((response) => response.url().endsWith("/api/auth/get-session"));
    await page.goto(target, { waitUntil: "commit" });
    await expect(page.getByRole("status").filter({ hasText: current.loading })).toBeVisible();
    await expect(page.getByRole("heading", { name: current.title })).toBeVisible();
    expect((await sessionReady).status()).toBe(200);
    await context.clearCookies({ name: "geo-settings-slow" });

    const name = page.getByRole("textbox", { name: current.name, exact: true });
    await name.fill(displayName);
    const signOut = await context.request.post("/api/auth/sign-out", { headers: { Origin: baseURL }, data: {} });
    expect(signOut.status()).toBe(200);
    const anonymous = await context.request.get(target, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    expect(await anonymous.text()).not.toContain(account.email);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(profileUpdate)) writes.push(request.url());
    });
    await name.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("returnTo") === target);
    await page.getByRole("textbox", { name: locale === "en" ? "Email" : "邮箱", exact: true }).fill(account.email);
    await page.getByLabel(locale === "en" ? "Password" : "密码", { exact: true }).fill(account.password);
    const signedIn = await submitTestAccountForm(page, page.getByRole("button", { name: current.signIn }), "/api/auth/sign-in/email");
    expect(signedIn.status()).toBe(200);
    await expect(page).toHaveURL(`${baseURL}${target}`);
    await expect(name).toHaveValue(initialName);
    expect(writes).toHaveLength(1);
  });
}

test("account settings are reachable from workspace navigation", async ({ page, context, account }) => {
  await context.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Toggle sidebar navigation" }).press("Enter");
  await page.getByRole("link", { name: copy.en.title, exact: true }).press("Enter");
  await expect(page).toHaveURL(`${baseURL}${settings}`);
  await expect(page.getByRole("heading", { name: copy.en.title })).toBeVisible();
  await expect(page.getByRole("definition")).toHaveText(account.email);
  await page.getByRole("button", { name: copy.en.signOut, exact: true }).press("Enter");
  await expect(page).toHaveURL(`${baseURL}/login`);
});
