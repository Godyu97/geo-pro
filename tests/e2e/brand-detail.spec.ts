import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const brandName = "合成品牌详情";
const longWebsite = `https://brand-detail.example.com/${"w".repeat(180)}`;
const longAlias = "A".repeat(80);
const description = `${"用于隔离验收的合成业务说明。".repeat(12)}END`;

const copy = {
  "zh-CN": {
    task: "核对最新实体版本、已确认的自然发现题、通道和额度。条件齐备后，从这里确认监测运行。",
    next: "自然发现题少于 3 道。去确认题目。",
    related: "相关入口",
    unavailable: "暂时无法处理品牌资料。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
  },
  en: {
    task: "Check the latest entity version, confirmed natural-discovery questions, channels, and quota. Confirm a monitoring run from here when those are ready.",
    next: "Fewer than 3 natural-discovery questions. Confirm questions.",
    related: "Related entries",
    unavailable: "We couldn’t process the brand details. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Brand detail visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

test("brand detail keeps the next monitoring action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/brand-detail";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `brand-detail-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-detail-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const saved = await context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description, website: longWebsite, aliases: [longAlias],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(saved.status()).toBe(200);
    const { id } = await saved.json();
    const href = `/dashboard/brands/${id}`;

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
        const next = main.getByRole("link", { name: current.next, exact: true });
        await expect(next).toHaveCount(1);
        await expect(next).toHaveAttribute("href", `/dashboard/brands/${id}/questions`);
        if (width === 375) {
          await expect(next).toBeInViewport();
          await page.screenshot({ path: `${shots}/brand-detail-${locale}-375.png`, fullPage: false });
        }
        await expect(main.getByText(current.task, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        await expect(main.getByText(longWebsite, { exact: true })).toBeVisible();
        await expect(main.getByText(longAlias, { exact: true })).toBeVisible();
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    const next = page.getByRole("main").getByRole("link", { name: copy["zh-CN"].next, exact: true });
    await activateFromKeyboard(page, next);
    await expect(page).toHaveURL(new RegExp(`/dashboard/brands/${id}/questions`));

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-brands-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: "Brand workspace", exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(failed.getByText(longWebsite)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/brand-detail-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-brands-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(longWebsite)).toHaveCount(0);
    await expectNoOverflow(stranger);
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
