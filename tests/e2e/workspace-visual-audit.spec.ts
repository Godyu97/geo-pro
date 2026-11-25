import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { expectTextContrast } from "./appearance-helpers";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const loadMessageFile = createRequire(import.meta.url);
const en: typeof import("../../src/lib/i18n/messages/en.json") = loadMessageFile("../../src/lib/i18n/messages/en.json");
const zh: typeof import("../../src/lib/i18n/messages/zh-CN.json") = loadMessageFile("../../src/lib/i18n/messages/zh-CN.json");

const origin = "http://localhost:3100";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const brandName = `合成验收品牌${"WorkspaceVisual".repeat(4)}`;
const app = join(process.cwd(), "src/app");
const routePatterns = readdirSync(app, { recursive: true, encoding: "utf8" })
  .filter((path) => path.split(sep).at(-1) === "page.tsx")
  .map((path) => `/${path.split(sep).filter((segment) => !segment.startsWith("(")).slice(0, -1).join("/")}`)
  .sort();
const screenshots = process.env.GEO_VISUAL_SCREENSHOTS;

async function capture(page: Page, filename: string) {
  if (!screenshots) return;
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, `${filename}.png`) });
}

async function register(context: BrowserContext) {
  const email = `visual-audit-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, { name: "Visual audit fixture", email, password: randomBytes(24).toString("base64url") });
  expect(response.status()).toBe(200);
  const userId: string = (await response.json()).user.id;
  return { userId, email };
}

function cleanup(account: { userId: string; email: string }) {
  execFileSync(process.execPath, ["--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account)]);
}

async function createBrand(context: BrowserContext, userId: string) {
  const response = await context.request.post("/api/brands", { headers: { Origin: origin }, data: {
    action: "submit", actorId: userId, operationId: randomUUID(), target: null, expectedDraft: null,
    acceptedPolicyVersion: publishedRetentionVersion(),
    fields: { name: brandName, description: "合成界面验收资料", website: "https://visual-audit.example.com",
      aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
  } });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

async function activate(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function checkLayout(page: Page, locale: string, description: string) {
  await expect(page.locator("html"), description).toHaveAttribute("lang", locale);
  await expect.soft(page.getByRole("main"), description).toHaveCount(1, { timeout: 1000 });
  const main = page.locator("#main-content").first();
  await expect.soft(main.getByRole("heading", { level: 1 }), description).toBeVisible({ timeout: 1000 });
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), description)
    .toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

// Real IDs are covered by the feature suites for the independent run, evidence,
// task and content workflows. Missing IDs here verify their unavailable state.
function routeFor(pattern: string, brandId: string, missing: string) {
  const target = pattern.endsWith("/recovery") ? missing : brandId;
  return pattern.replace("[id]", target).replace(/\[[^\]]+\]/g, missing);
}

const representative = new Set(["/", "/login", "/account-access", "/dashboard", "/dashboard/brands",
  "/dashboard/brands/industry-packs", "/dashboard/monitoring/overview", "/dashboard/monitoring/explorations",
  "/dashboard/optimization", "/dashboard/content", "/dashboard/reports", "/dashboard/settings/team",
  "/dashboard/settings/approval-policy", "/dashboard/maintenance/capabilities"]);

for (const locale of locales) {
  test(`visual smoke covers every application route in ${locale} at three widths`, async ({ page, context, browser }) => {
    test.setTimeout(240_000);
    const account = await register(context);
    const guest = await browser.newContext({ baseURL: origin });
    try {
      const brandId = await createBrand(context, account.userId);
      const currentSession = await context.request.get("/api/auth/get-session");
      expect(currentSession.ok()).toBe(true);
      const sessionBody = await currentSession.json();
      expect(sessionBody.user.id).toBe(account.userId);
      // SSR still authenticates every navigation. Replay the same client session
      // heartbeat during the rapid viewport sweep so rate limits do not obscure the layout.
      await context.route("**/api/auth/get-session", (route) => route.fulfill({ json: sessionBody }));
      const missing = randomUUID();
      const guestPage = await guest.newPage();
      for (const target of [context, guest]) {
        await target.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      }
      for (const pattern of routePatterns) {
        const url = routeFor(pattern, brandId, missing);
        const dashboard = url.startsWith("/dashboard");
        const current = dashboard ? page : guestPage;
        for (const width of widths) {
          const description = `${pattern} ${locale} ${width}`;
          await current.setViewportSize({ width, height: 850 });
          const response = await current.goto(url);
          expect.soft(response?.status() ?? 500, description).toBeLessThan(500);
          await checkLayout(current, locale, description);
          if (dashboard) {
            await expect.soft(current.locator("[data-workspace-section]"), description).toBeVisible({ timeout: 1000 });
          }
          if (representative.has(pattern)) await capture(current, `${pattern.slice(1).replaceAll("/", "-") || "home"}-${locale}-${width}`);
        }
      }
      await expectTextContrast(page);
      console.log(`Checked ${routePatterns.length} routes at ${widths.join("/")} px (${locale}).`);
    } finally {
      await guest.close();
      cleanup(account);
    }
  });
}

const readCases = [
  ["industry-packs", "/dashboard/brands/industry-packs", "industryPacks"],
  ["explorations", "/dashboard/monitoring/explorations", "explorations"],
  ["team", "/dashboard/settings/team", "teamAccess"],
  ["approval-policy", "/dashboard/settings/approval-policy", "approvalPolicy"],
] as const;


test("the remaining workspace reads announce loading and recover the same route by keyboard", async ({ page, context }) => {
  test.setTimeout(100_000);
  const account = await register(context);
  try {
    const brandId = await createBrand(context, account.userId);
    for (const locale of locales) {
      const copy = locale === "en" ? en : zh;
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      await page.setViewportSize({ width: 375, height: 850 });
      for (const [fixture, path, namespace] of readCases) {
        const url = fixture === "explorations" ? `${path}?brandId=${brandId}` : path;
        const messages = copy[namespace];
        const main = page.getByRole("main");
        await context.addCookies([{ name: "geo-workspace-read", value: fixture, url: origin }]);
        const navigation = page.goto(url, { waitUntil: "domcontentloaded" });
        const loading = main.getByRole("status", { name: messages.loading });
        await expect(loading).toBeVisible();
        await expect(loading.locator("[data-slot=skeleton]")).toHaveCount(2);
        await capture(page, `${fixture}-loading-${locale}`);
        await navigation;
        await expect(main.getByRole("heading", { name: messages.title, level: 1 })).toBeVisible();
        await expect(main.getByRole("alert")).toHaveText(messages.SERVICE_UNAVAILABLE);
        await expect(main.getByText(/^(Reference |追踪编号 )[0-9a-f-]{36}$/)).toBeVisible();
        await expect(main).not.toContainText(brandName);
        await expect(main).not.toContainText("Private workspace read fixture failure");
        await capture(page, `${fixture}-read-failure-${locale}`);
        await context.clearCookies({ name: "geo-workspace-read" });
        const reload = main.getByRole("link", { name: copy.common.retry, exact: true });
        await expect(reload).toBeInViewport();
        await activate(page, reload);
        await expect(page).toHaveURL(url);
        await expect(main.getByText(messages.SERVICE_UNAVAILABLE, { exact: true })).toHaveCount(0);
        await expect(main.getByRole("heading", { name: messages.title, level: 1 })).toBeVisible();
      }
      const capabilities = copy.capabilities;
      await context.addCookies([{ name: "geo-maintenance-unavailable", value: "1", url: origin }]);
      await page.goto("/dashboard/maintenance/capabilities");
      const retry = page.getByRole("button", { name: capabilities.retry, exact: true });
      await expect(page.getByRole("main").getByRole("alert")).toContainText(capabilities.SERVICE_UNAVAILABLE);
      await expect(retry).toBeInViewport();
      await context.clearCookies({ name: "geo-maintenance-unavailable" });
      await activate(page, retry);
      await expect(page.getByRole("main").getByText(capabilities.FORBIDDEN, { exact: true })).toBeVisible();
    }
  } finally {
    cleanup(account);
  }
});
