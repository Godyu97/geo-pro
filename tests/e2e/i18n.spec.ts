import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const baseURL = "http://localhost:3100";
const name = `品牌🚀 Évidence ${"LongBrandName".repeat(4)}`;

async function setLanguage(context: BrowserContext, locale: string) {
  await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectTextContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is required for color conversion");
    function luminance(variable: string) {
      if (!context) throw new Error("Missing color context");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = style.getPropertyValue(variable).trim();
      context.fillRect(0, 0, 1, 1);
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
        const component = value / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    return [
      ["--foreground", "--background"], ["--muted-foreground", "--card"],
      ["--muted-foreground", "--background"], ["--primary-foreground", "--primary"],
      ["--secondary-foreground", "--secondary"], ["--destructive", "--card"],
      ["--sidebar-foreground", "--sidebar"],
    ].map(([foreground, background]) => {
      const a = luminance(foreground), b = luminance(background);
      return { foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  for (const result of ratios) expect(result.ratio, `${result.foreground} on ${result.background}`).toBeGreaterThanOrEqual(4.5);
}

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser auth tests require a local development database");
  }
  return databaseURL;
}

async function disposableAccount(context: BrowserContext) {
  const databaseURL = localDatabaseURL();
  const email = `b01-${randomBytes(10).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: { Origin: baseURL }, data: { name, email, password },
  });
  expect(response.status(), "Disposable local account registration").toBe(200);
  const userId: string = (await response.json()).user.id;
  return async () => {
    const sql = postgres(databaseURL, { max: 1 });
    try { await sql`delete from "user" where id = ${userId} and email = ${email}`; }
    finally { await sql.end(); }
  };
}

type CookieState = Awaited<ReturnType<BrowserContext["cookies"]>>;
const test = base.extend<object, { accountCookies: CookieState }>({
  accountCookies: [async ({ browser }, provide) => {
    const context = await browser.newContext({ baseURL });
    const cleanup = await disposableAccount(context);
    try { await provide(await context.cookies()); }
    finally { await cleanup(); await context.close(); }
  }, { scope: "worker" }],
});

test("SSR negotiation, safe fallback and concurrent responses keep languages isolated", async ({ request }) => {
  for (const [headers, locale, title] of [
    [{}, "zh-CN", "GEO 品牌可见度"],
    [{ "Accept-Language": "en-GB,en;q=0.9" }, "en", "GEO brand visibility"],
    [{ "Accept-Language": "fr-FR" }, "zh-CN", "GEO 品牌可见度"],
    [{ Cookie: "geo-locale=zh-CN", "Accept-Language": "en-US" }, "zh-CN", "GEO 品牌可见度"],
    [{ Cookie: "geo-locale=invalid", "Accept-Language": "en-US" }, "zh-CN", "GEO 品牌可见度"],
  ] as const) {
    const response = await request.get("/", { headers });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain(title);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const languages = Array.from({ length: 20 }, (_, i) => i % 2 ? "en" : "zh-CN");
  await Promise.all(languages.map(async (locale) => {
    const response = await request.get("/login", { headers: { Cookie: `geo-locale=${locale}` } });
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain(locale === "en" ? "Welcome to GeoPro" : "欢迎来到 GeoPro");
    expect(html).not.toContain(locale === "en" ? "欢迎来到 GeoPro" : "Welcome to GeoPro");
    expect(response.headers()["cache-control"]).toContain("no-store");
  }));
});

test("switching preserves drafts, validation, query, hash and keyboard focus", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setLanguage(context, "zh-CN");
  await page.goto("/login?mode=signup&filter=保留#draft");
  await page.getByLabel("称呼", { exact: true }).fill("品牌🚀 Draft É");
  await page.getByLabel("邮箱", { exact: true }).fill("invalid");
  await page.getByLabel("密码", { exact: true }).fill("short");
  await page.getByRole("button", { name: "创建账号并进入工作台", exact: true }).click();
  await expect(page.getByText("请输入有效的邮箱地址", { exact: true })).toBeVisible();
  const url = page.url();
  const select = page.getByRole("combobox");
  await select.focus();
  await select.press("ArrowDown");
  await select.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("combobox")).toBeFocused();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("品牌🚀 Draft É");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("invalid");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("short");
  await expect(page.getByText("Enter a valid email address", { exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page).toHaveTitle("Sign in · GeoPro");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/");
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goForward();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("failed language updates and unknown auth errors are localized and safe; IME does not submit", async ({ page, context }) => {
  await setLanguage(context, "en");
  await page.goto("/login?mode=signup");
  await page.getByLabel("Name", { exact: true }).fill("输入法品牌");
  await page.getByLabel("Email", { exact: true }).fill("ime@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  let submitted = 0;
  await page.route("**/api/auth/sign-up/email", async (route) => {
    submitted++;
    await route.fulfill({ status: 503, json: { code: "UNKNOWN_CODE", message: "PRIVATE_INTERNAL_ERROR" } });
  });
  await page.getByLabel("Name", { exact: true }).dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
  expect(submitted).toBe(0);
  await page.getByRole("button", { name: "Create account and open workspace" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Authentication is temporarily unavailable" })).toHaveText("Authentication is temporarily unavailable. Please try again later.");
  await expect(page.getByText("PRIVATE_INTERNAL_ERROR")).toHaveCount(0);
  await page.route("**/login*", (route) => route.request().headers()["next-action"] ? route.abort() : route.continue());
  await page.getByRole("combobox").selectOption("zh-CN");
  await expect(page.getByText("Could not change the language. Please try again.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("输入法品牌");
});

for (const locale of ["zh-CN", "en"] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${locale}: homepage, validation and authenticated workspace at ${width}px`, async ({ page, context, accountCookies }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await setLanguage(context, locale);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expectNoOverflow(page);
      await expectTextContrast(page);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: locale === "en" ? "Skip to main content" : "跳转到主要内容" })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
      await page.getByRole("link", { name: locale === "en" ? "Get started" : "开始体验", exact: true }).click();
      await expect(page.getByRole("tab", { name: locale === "en" ? "Create account" : "创建账号", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: locale === "en" ? "Create account and open workspace" : "创建账号并进入工作台" }).click();
      await expect(page.getByText(locale === "en" ? "Enter your name" : "请输入称呼", { exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("validation.png"), fullPage: true });
      await context.addCookies(accountCookies);
      {
        await page.goto("/dashboard?filter=保留#monitoring");
        await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
        await expect(page.getByRole("heading", { name: locale === "en" ? "Waiting for the first real evidence" : "等待第一份真实证据" })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await page.getByRole("button", { name: locale === "en" ? "Toggle sidebar navigation" : "切换侧边导航" }).click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          await expect(dialog).toHaveAccessibleName(locale === "en" ? "Workspace navigation" : "工作台导航");
          await expectNoOverflow(page);
          await page.screenshot({ path: testInfo.outputPath("sidebar.png"), fullPage: true });
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(page.getByRole("button", { name: locale === "en" ? "Toggle sidebar navigation" : "切换侧边导航" })).toBeFocused();
        }
        await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
        await page.getByRole("combobox").selectOption(locale === "en" ? "zh-CN" : "en");
        await expect(page.locator("html")).toHaveAttribute("lang", locale === "en" ? "zh-CN" : "en");
        expect(page.url()).toContain("filter=");
        expect(page.url()).toContain("#monitoring");
        await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
        await expectNoOverflow(page);
      }
      expect(errors).toEqual([]);
    });
  }

  test(`${locale}: deep links, sign-in and sign-out keep language and filters without loops`, async ({ page, context }) => {
    await setLanguage(context, locale);
    const email = `b01-ui-${randomBytes(8).toString("hex")}@example.invalid`;
    const password = randomBytes(24).toString("base64url");
    const sql = postgres(localDatabaseURL(), { max: 1 });
    try {
      await page.goto("/dashboard?filter=保留");
      await expect(page).toHaveURL(/\/login\?returnTo=/);
      await page.getByRole("tab", { name: locale === "en" ? "Create account" : "创建账号", exact: true }).click();
      await page.getByLabel(locale === "en" ? "Name" : "称呼", { exact: true }).fill("品牌🚀 Account É");
      await page.getByLabel(locale === "en" ? "Email" : "邮箱", { exact: true }).fill(email);
      await page.getByLabel(locale === "en" ? "Password" : "密码", { exact: true }).fill(password);
      const submitted = page.waitForResponse(response => response.url().includes("/api/auth/sign-up/email"));
      await page.getByRole("button", { name: locale === "en" ? "Create account and open workspace" : "创建账号并进入工作台" }).click();
      const response = await submitted;
      const responseBody = await response.json();
      expect(response.status(), `Sign-up returned ${responseBody.code ?? "unknown"}`).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\?filter=/);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await page.getByRole("button", { name: locale === "en" ? "Sign out" : "退出登录", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await page.getByLabel(locale === "en" ? "Email" : "邮箱", { exact: true }).fill(email);
      await page.getByLabel(locale === "en" ? "Password" : "密码", { exact: true }).fill(password);
      await page.getByRole("button", { name: locale === "en" ? "Sign in and open workspace" : "登录并进入工作台" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    } finally {
      await sql`delete from "user" where email = ${email}`;
      await sql.end();
    }
  });

  test(`${locale}: 404, loading, service failure and the independent fatal boundary`, async ({ page, context, accountCookies }) => {
    await setLanguage(context, locale);
    await page.goto("/missing-page");
    await expect(page.getByRole("heading", { name: locale === "en" ? "Page not found" : "找不到这个页面" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.goto("/i18n-probe/loading", { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: locale === "en" ? "Loading workspace…" : "正在加载工作台…" })).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await page.goto("/i18n-probe/error");
    await expect(page.getByRole("heading", { name: locale === "en" ? "Unable to load this page" : "暂时无法载入页面" })).toBeVisible();
    await expect(page.getByText("Private test failure", { exact: false })).toHaveCount(0);
    await context.addCookies(accountCookies);
    await page.goto("/dashboard?probeError=true");
    await expect(page.getByRole("heading", { name: locale === "en" ? "Unable to load this page" : "暂时无法载入页面" })).toBeVisible();
    await expect(page.locator("#main-content")).toHaveCount(1);
    await page.goto("/i18n-probe/unavailable");
    await expect(page.getByRole("status")).toContainText(locale === "en" ? "Account services are not configured" : "账号服务尚未配置");
    await expect(page.getByRole("button", { name: locale === "en" ? "Sign in and open workspace" : "登录并进入工作台" })).toBeDisabled();
    await page.goto("/i18n-probe/fatal");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Unable to load GeoPro");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("暂时无法加载 GeoPro");
    await page.getByRole("link", { name: "返回首页 / Back to home" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
}
