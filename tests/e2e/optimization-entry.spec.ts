import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { initialBrandFields } from "../../src/features/brands/contracts";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const optimizationPath = "/dashboard/optimization";
const restrictedURL = `https://example.invalid/${"restricted".repeat(80)}`;
const taskTitle = "公开页面受限，待核验";
const copy = {
  "zh-CN": {
    title: "优化任务", location: "当前位置: 优化建议", brands: "前往品牌",
    evidence: "查看证据概览", open: "开放任务", checks: "公开页面检查", status: "待处理",
    missing: "未找到资源或无权访问。", empty: "暂无开放优化任务。",
  },
  en: {
    title: "Optimization tasks", location: "Current location: Optimization suggestions", brands: "Go to brands",
    evidence: "View evidence overview", open: "Open tasks", checks: "Public page checks", status: "To do",
    missing: "Resource not found or not accessible.", empty: "No open optimization tasks.",
  },
} as const;

test("optimization entry prioritizes scoped tasks and recovery in both languages", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Optimization browser tests require local PostgreSQL");
  }
  const sql = postgres(url.href, { max: 1 });
  const email = `optimization-${randomUUID()}@example.invalid`;
  const outsiderEmail = `optimization-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const main = page.getByRole("main");
  const locales = ["zh-CN", "en"] as const;
  const widths = [375, 768, 1440];

  const expectNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(main).toHaveCount(1);
  };

  try {
    const registered = await registerTestAccount(context, { name: "优化验收", email, password });
    expect(registered.status()).toBe(200);
    const { user } = await registered.json();

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(optimizationPath);
      await expect(main.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
      await expect(main.getByRole("link", { name: copy[locale].brands, exact: true })).toHaveAttribute("href", "/dashboard/brands");
      await expectNoOverflow();
    }

    const created = await context.request.post("/api/brands", {
      headers: { Origin: baseURL },
      data: {
        actorId: user.id, operationId: randomUUID(), action: "submit", target: null, expectedDraft: null,
        fields: { ...initialBrandFields, name: "优化验收品牌", description: "本地隔离验收使用的合成资料" },
        acceptedPolicyVersion: publishedRetentionVersion(),
      },
    });
    expect(created.status()).toBe(200);
    const { id: brandId } = await created.json();
    const scopedPath = `${optimizationPath}?brandId=${brandId}`;
    const overviewPath = `/dashboard/monitoring/overview?brandId=${brandId}`;

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(scopedPath);
        const evidence = main.getByRole("link", { name: copy[locale].evidence, exact: true });
        await expect(evidence).toHaveAttribute("href", overviewPath);
        await expect(evidence).toBeInViewport();
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expectNoOverflow();
        if (width === 375) {
          await page.screenshot({ path: testInfo.outputPath(`optimization-empty-${locale}.png`) });
          await evidence.focus();
          await expect(evidence).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(overviewPath);
        }
      }
    }

    await page.getByLabel("Public URLs (one per line)", { exact: true }).fill(restrictedURL);
    await main.getByRole("combobox", { name: "Isolated fixture status", exact: true }).selectOption("restricted");
    await page.getByLabel("Isolated fixture body (optional)", { exact: true }).fill("Synthetic fixture, no network request.");
    const check = main.getByRole("button", { name: "Run check", exact: true });
    await check.focus();
    await page.keyboard.press("Enter");
    await expect(main.getByRole("link", { name: taskTitle, exact: true })).toBeVisible();

    const [record] = await sql`
      select public_status, access_condition from page_check_record
      where owner_id = ${user.id} and brand_id = ${brandId} and url = ${restrictedURL}
    `;
    expect(record).toEqual({ public_status: "restricted", access_condition: "isolated-fixture" });

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(scopedPath);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByText(copy[locale].location, { exact: true })).toBeVisible();
        const open = main.getByRole("region", { name: copy[locale].open });
        const task = open.getByRole("link", { name: taskTitle, exact: true });
        await expect(open.getByText(copy[locale].status, { exact: true })).toBeVisible();
        await expect(open.getByText(restrictedURL, { exact: true })).toBeVisible();
        await expect(task).toBeInViewport();
        await expectNoOverflow();

        await main.getByRole("link", { name: copy[locale].evidence, exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(task).toBeFocused();
        await expect(task).not.toHaveCSS("box-shadow", "none");
        if (width === 375) {
          await page.screenshot({ path: testInfo.outputPath(`optimization-task-${locale}.png`) });
        }
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/dashboard\/optimization\/[0-9a-f-]{36}$/);
        await expect(main.getByRole("heading", { name: taskTitle, exact: true })).toBeVisible();
      }
    }

    const outsider = await browser.newContext({ baseURL });
    try {
      const other = await registerTestAccount(outsider, { name: "优化隔离验收", email: outsiderEmail, password });
      expect(other.status()).toBe(200);
      const denied = await outsider.newPage();
      await denied.setViewportSize({ width: 375, height: 900 });
      for (const locale of locales) {
        await outsider.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
        await denied.goto(scopedPath);
        await expect(denied.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
        await expect(denied.getByRole("alert").filter({ hasText: copy[locale].missing })).toBeVisible();
        await expect(denied.getByRole("link", { name: copy[locale].brands, exact: true })).toHaveAttribute("href", "/dashboard/brands");
        await expect(denied.getByRole("link", { name: taskTitle, exact: true })).toHaveCount(0);
        await expect(denied.getByRole("heading", { name: copy[locale].checks, exact: true })).toHaveCount(0);
      }
    } finally {
      await outsider.close();
    }
  } finally {
    try {
      await sql`delete from "user" where email in (${email}, ${outsiderEmail})`;
    } finally {
      await sql.end();
    }
  }
});
