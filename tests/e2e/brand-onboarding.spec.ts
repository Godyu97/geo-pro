import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { expectTextContrast } from "./appearance-helpers";
import { registerTestAccount, submitTestAccountForm } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const brands = "/dashboard/brands";
const synthetic = "北岸合成品牌 Studio 🚀";
const description = "Synthetic brand for local testing only.";

const test = base.extend<{
  accounts: {
    create: (context: BrowserContext) => Promise<{ id: string; email: string; password: string }>;
    expire: (id: string) => Promise<void>;
    verifyEmail: (id: string) => Promise<void>;
  };
}>({
  accounts: async ({}, provide) => {
    const url = URL.parse(process.env.DATABASE_URL ?? "");
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Brand tests require local PostgreSQL");
    const sql = postgres(url.href, { max: 1 });
    const created: string[] = [];
    try {
      await provide({
        async create(context) {
          const email = `b04-${randomBytes(12).toString("hex")}@example.invalid`;
          const password = randomBytes(24).toString("base64url");
          created.push(email);
          const result = await registerTestAccount(context, { name: "Synthetic brand owner", email, password });
          expect(result.status()).toBe(200);
          const { user } = await result.json();
          return { id: user.id, email, password };
        },
        async expire(id) {
          await sql`update session set expires_at = ${new Date(Date.now() - 60_000)} where user_id = ${id}`;
        },
        async verifyEmail(id) {
          await sql`update "user" set email_verified = true where id = ${id}`;
        },
      });
    } finally {
      if (created.length) await sql`delete from "user" where email in ${sql(created)}`;
      await sql.end();
    }
  },
});

const copy = {
  "zh-CN": {
    brandWorkspace: "品牌资料", start: "建立品牌或继续草稿", title: "建立品牌", name: "品牌名称", business: "一句话业务", site: "官网地址",
    aliases: "别名", nameError: "品牌名称应为 2–80 字。", siteError: "请输入有效的公开 HTTP(S) 域名地址，或留空。",
    next: "下一步", back: "上一步", scope: "关注范围", region: "目标地区", language: "业务语言",
    interfaceLanguage: "界面语言", questions: "客户可能会问什么？", create: "保存品牌", save: "保存草稿", saved: "草稿已保存。",
    loading: "正在载入品牌资料…", unavailable: "暂时无法处理品牌资料。请稍后重试。", noWebsite: "未登记官网。官网引用不适用。",
    noChannels: "目前没有可用通道，无法启动监测。", signOut: "退出登录", email: "邮箱", password: "密码", signIn: "登录并进入工作台",
  },
  en: {
    brandWorkspace: "Brand workspace", start: "Set up a brand or resume a draft", title: "Set up a brand", name: "Brand name", business: "One-sentence business description", site: "Website",
    aliases: "Aliases", nameError: "Enter a brand name of 2–80 characters.", siteError: "Enter a valid public HTTP(S) domain address or leave this blank.",
    next: "Next", back: "Back", scope: "Focus area", region: "Target region", language: "Business language",
    interfaceLanguage: "Interface language", questions: "What might customers ask?", create: "Save brand", save: "Save draft", saved: "Draft saved.",
    loading: "Loading brand details…", unavailable: "We couldn’t process the brand details. Try again shortly.", noWebsite: "No website registered. Website citations do not apply.",
    noChannels: "No monitoring channels are available.", signOut: "Sign out", email: "Email", password: "Password", signIn: "Sign in and open workspace",
  },
} as const;

function label(page: Page, name: string) {
  return page.getByLabel(name, { exact: true });
}

function button(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

for (const locale of ["zh-CN", "en"] as const) {
  const current = copy[locale];
  const nextLocale = locale === "en" ? "zh-CN" : "en";
  const translated = copy[nextLocale];

  for (const width of [375, 768, 1440]) {
    test(`${locale} brand setup, validation and language changes at ${width}px`, async ({ page, context, accounts }) => {
      await accounts.create(context);
      await page.setViewportSize({ width, height: 900 });
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/api/brands")) writes.push(request.url());
      });
      await page.goto("/");
      await page.locator("main").getByRole("link", { name: locale === "en" ? "Continue" : "继续使用", exact: true }).click();
      await page.locator("main").getByRole("link", { name: current.brandWorkspace, exact: true }).click();
      await page.getByRole("link", { name: current.start, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(new RegExp(current.brandWorkspace));
      await expect(page.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
      await expect(page.locator("aside").filter({ hasText: locale === "en" ? "Synthetic data" : "合成资料" })).toBeVisible();
      await expectTextContrast(page);

      await button(page, current.next).focus();
      await page.keyboard.press("Enter");
      const name = label(page, current.name);
      await expect(name).toBeFocused();
      await expect(name).toHaveAccessibleDescription(current.nameError);
      await name.fill(synthetic);
      expect(await name.evaluate((field) => !field.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", isComposing: true, cancelable: true, bubbles: true,
      })))).toBe(true);
      await label(page, current.business).fill(description);
      await label(page, current.site).fill("https://localhost/private");
      await button(page, current.next).click();
      await expect(label(page, current.site)).toBeFocused();
      await expect(page.getByText(current.siteError, { exact: true })).toBeVisible();
      await label(page, current.site).fill("");
      expect(writes).toHaveLength(0);

      await label(page, current.interfaceLanguage).selectOption(nextLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
      await expect(label(page, translated.name)).toHaveValue(synthetic);
      await expect(label(page, translated.business)).toHaveValue(description);
      await button(page, translated.next).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: translated.scope, exact: true })).toBeFocused();
      await expect(label(page, translated.region)).toHaveValue("CN");
      await expect(label(page, translated.language)).toHaveValue("zh-CN");
      await button(page, translated.back).click();
      await expect(label(page, translated.name)).toHaveValue(synthetic);
      await button(page, translated.next).click();
      await button(page, translated.next).click();
      await label(page, translated.questions).fill("What might a synthetic visitor ask?");
      await button(page, translated.create).click();
      await expect(page.getByRole("heading", { name: synthetic, exact: true })).toBeVisible();
      await expect(page.getByText(translated.noWebsite, { exact: true })).toBeVisible();
      await expect(page.getByText(translated.noChannels, { exact: true })).toBeVisible();
      await expect(page.getByText("What might a synthetic visitor ask?", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectTextContrast(page);
      expect(errors).toEqual([]);
    });
  }

  test(`${locale}: loading, failed save and saved draft recovery after sign-out and expiration`, async ({ page, context, accounts }) => {
    const account = await accounts.create(context);
    const sessionResponse = () => page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/get-session") && response.request().method() === "GET" && response.status() === 200);
    async function expectSession(response: ReturnType<typeof sessionResponse>) {
      expect(await (await response).json()).toMatchObject({ user: { id: account.id } });
    }
    await context.addCookies([
      { name: "geo-locale", value: locale, url: baseURL },
      { name: "geo-brands-slow", value: "1", url: baseURL },
    ]);
    const target = brands + "/new?from=workspace";
    const initialSession = sessionResponse();
    await page.goto(target, { waitUntil: "commit" });
    await expect(page.getByRole("status").filter({ hasText: current.loading })).toBeVisible();
    await expect(label(page, current.name)).toBeVisible();
    await expectSession(initialSession);
    await context.clearCookies({ name: "geo-brands-slow" });

    const operations: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/brands")) operations.push(request.postDataJSON().operationId);
    });
    await page.route("**/api/brands", (route) => route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } }), { times: 1 });
    await label(page, current.name).fill(synthetic);
    await label(page, current.business).fill(description);
    await button(page, current.save).click();
    await expect(page.getByRole("alert").filter({ hasText: current.unavailable })).toBeVisible();
    await expect(label(page, current.name)).toHaveValue(synthetic);
    await button(page, current.save).click();
    await expect(page.getByText(current.saved, { exact: true })).toBeVisible();
    expect(operations[1]).toBe(operations[0]);

    await button(page, current.signOut).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(target);
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("returnTo") === target);
    async function signIn() {
      await label(page, current.email).fill(account.email);
      await label(page, current.password).fill(account.password);
      const restoredSession = sessionResponse();
      const response = await submitTestAccountForm(page, button(page, current.signIn), "/api/auth/sign-in/email");
      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(baseURL + target);
      await expectSession(restoredSession);
    }
    await signIn();
    await expect(label(page, current.name)).toHaveValue(synthetic);
    await button(page, current.next).click();
    await expect(label(page, current.region)).toHaveValue("CN");
    await accounts.expire(account.id);
    await button(page, current.save).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("returnTo") === target);
    await signIn();
    await expect(label(page, current.region)).toHaveValue("CN");
    expect(operations).toHaveLength(4);
    // Finish the page before the fixture deletes this account and revokes the session.
    await page.close();
  });
}

test("owner can edit, view old versions, archive and restore while another account is denied", async ({ page, context, browser, accounts }) => {
  const owner = await accounts.create(context);
  await context.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
  const response = await context.request.post("/api/brands", {
    headers: { Origin: baseURL },
    data: {
      action: "submit", actorId: owner.id, operationId: globalThis.crypto.randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: { name: synthetic, description, website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
    },
  });
  expect(response.status()).toBe(200);
  const { id } = await response.json();
  const target = brands + "/" + id;
  await page.goto(target);
  await page.getByRole("link", { name: "Edit details", exact: true }).click();
  await label(page, "Aliases").fill("Updated synthetic alias");
  await button(page, "Next").click();
  await button(page, "Next").click();
  await button(page, "Save new version").click();
  await expect(page.getByText("Entity version 2", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View previous version", exact: true }).click();
  await expect(page.getByText("Entity version 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated synthetic alias", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "View current version", exact: true }).click();
  await button(page, "Archive brand").click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await button(page, "Restore brand").click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  const other = await browser.newContext();
  try {
    await other.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await accounts.create(other);
    const stranger = await other.newPage();
    await stranger.goto(baseURL + target);
    await expect(stranger.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(stranger.getByText(synthetic, { exact: true })).toHaveCount(0);
  } finally {
    await other.close();
  }
});

const deletionCopy = {
  "zh-CN": {
    review: "预览品牌删除", impact: "预览删除影响", cancel: "取消删除",
    confirm: "确认删除并冻结访问", recovery: "品牌恢复", deadline: "恢复截止时间（上海时间）",
    reauthenticate: "退出以重新登录", restore: "恢复品牌访问",
  },
  en: {
    review: "Review brand deletion", impact: "Review deletion impact", cancel: "Cancel deletion",
    confirm: "Confirm deletion and freeze access", recovery: "Brand recovery", deadline: "Recovery deadline (Shanghai time)",
    reauthenticate: "Sign out to sign in again", restore: "Restore brand access",
  },
} as const;

for (const locale of ["zh-CN", "en"] as const) {
  const current = deletionCopy[locale];
  const otherLocale = locale === "en" ? "zh-CN" : "en";
  for (const width of [375, 768, 1440]) {
    test(`${locale}: brand deletion and recovery at ${width}px`, async ({ page, context, accounts }) => {
      const account = await accounts.create(context);
      await accounts.verifyEmail(account.id); // Verified identity fixture, with real sign-in for recovery.
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.setViewportSize({ width, height: 900 });
      const saved = await context.request.post("/api/brands", {
        headers: { Origin: baseURL },
        data: {
          action: "submit", target: null, expectedDraft: null, actorId: account.id, operationId: randomUUID(),
          acceptedPolicyVersion: publishedRetentionVersion(),
          fields: { name: synthetic, description, website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
        },
      });
      expect(saved.status()).toBe(200);
      const { id } = await saved.json();
      const href = brands + "/" + id;
      const expectNoOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.goto(href);
      await page.getByRole("link", { name: current.review, exact: true }).click();
      await expect(page.getByRole("heading", { name: current.impact, exact: true })).toBeVisible();
      await expectTextContrast(page);
      await expectNoOverflow();
      const cancel = page.getByRole("link", { name: current.cancel, exact: true });
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: synthetic, exact: true })).toBeVisible();

      await page.getByRole("link", { name: current.review, exact: true }).click();
      await label(page, copy[locale].interfaceLanguage).selectOption(otherLocale);
      await expect(page.getByRole("heading", { name: deletionCopy[otherLocale].impact, exact: true })).toBeVisible();
      await expect(page).toHaveURL(href + "/delete");
      await label(page, copy[otherLocale].interfaceLanguage).selectOption(locale);
      const confirm = button(page, current.confirm);
      await expect(confirm).toBeEnabled();
      if (width === 375) {
        await page.route("**/api/brands", (route) => route.fulfill({
          status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
        }), { times: 1 });
        await confirm.click();
        await expect(page.locator('main [role="alert"]')).toContainText(copy[locale].unavailable);
        expect((await context.request.get("/api/brands?id=" + id)).status()).toBe(200);
      }
      await confirm.focus();
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(href + "/recovery");
      await expect(page.getByRole("heading", { name: current.recovery, exact: true })).toBeVisible();
      await expect(page.getByText(current.deadline, { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: current.recovery })).not.toContainText(synthetic);
      await expectNoOverflow();
      await expectTextContrast(page);
      await expect(button(page, current.restore)).toHaveCount(0);

      if (width === 375) {
        await page.goBack();
        await expect(page).toHaveURL(href);
        await expect(page.getByRole("heading", { name: locale === "en" ? "Page not found" : "找不到这个页面", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: synthetic, exact: true })).toHaveCount(0);
        await page.goto(href + "/recovery");
      }
      await button(page, current.reauthenticate).click();
      await expect(page).toHaveURL(/\/login\?returnTo=/);
      await label(page, copy[locale].email).fill(account.email);
      await label(page, copy[locale].password).fill(account.password);
      const login = await submitTestAccountForm(page, button(page, copy[locale].signIn), "/api/auth/sign-in/email");
      expect(login.status()).toBe(200);
      await expect(page).toHaveURL(href + "/recovery");
      await button(page, current.restore).click();
      await expect(page).toHaveURL(href);
      await expect(page.getByRole("heading", { name: synthetic, exact: true })).toBeVisible();
    });
  }
}
