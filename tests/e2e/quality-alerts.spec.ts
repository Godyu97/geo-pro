import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const alertsPath = "/dashboard/monitoring/alerts";
const alertsApi = "/api/monitoring/alerts";
const windowId = "W".repeat(64);

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Quality alert visual test", email, password: randomBytes(24).toString("base64url"),
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}

test("monitoring owners can review and confirm in-app quality alerts in both languages", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(100_000);
  const ownerEmail = `quality-owner-${randomUUID()}@example.invalid`;
  const outsiderEmail = `quality-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("站内提醒验收品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于站内提醒验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://quality-alerts.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("合成对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "站内提醒验收品牌", exact: true })).toBeVisible();
    const brandId = new URL(page.url()).pathname.split("/").at(-1);
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);

    const headers = { Origin: origin };
    const nextAt = "2099-01-01T00:00:00.000Z";
    const plan = await context.request.post("/api/monitoring/plans", {
      headers,
      data: {
        action: "create", brandId, phase: "active", currency: "CNY",
        budgetMinor: 5, spentMinor: 0, pendingMinor: 0, nextAt,
        slots: [{ id: randomUUID(), channelId: "isolated-manual", at: nextAt, status: "scheduled", manual: true, costMinor: 0 }],
      },
    });
    expect(plan.status()).toBe(200);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/monitoring/plans");
    await activateFromKeyboard(page, page.getByRole("link", { name: "查看站内提醒", exact: true }));
    await expect(page).toHaveURL(alertsPath);
    const main = page.getByRole("main");
    await expect(main.getByText(/还没有质量提醒/)).toBeVisible();
    await expectNoOverflow(page);

    const record = {
      action: "record", brandId,
      windows: [
        { windowId: "previous", completed: true, coverageSufficient: true, citationFieldChanged: false, modeChanged: false, recommendationRate: 0.4 },
        { windowId, completed: true, coverageSufficient: false, citationFieldChanged: false, modeChanged: false, recommendationRate: 0.2 },
      ],
    };
    const first = await context.request.post(alertsApi, { headers, data: record });
    expect(first.status()).toBe(200);
    const { alert } = await first.json();
    const repeat = await context.request.post(alertsApi, { headers, data: record });
    expect(repeat.status()).toBe(200);
    const repeated = await repeat.json();
    expect(repeated).toMatchObject({
      created: false, alert: { id: alert.id, kind: "data_quality", reason: "coverage_insufficient", claimBrandDecline: false, windowId },
    });
    expect(repeated.alert.events).toHaveLength(2);

    for (const copy of [
      { locale: "zh-CN", title: "质量提醒", kind: "数据质量", reason: /最新窗口覆盖不足/, window: `窗口 ${windowId}`, count: "已记录 2 次", acknowledge: "确认", open: "待处理" },
      { locale: "en", title: "Quality alerts", kind: "Data quality", reason: /latest window does not have enough coverage/, window: `Window ${windowId}`, count: "2 occurrences recorded", acknowledge: "Acknowledge", open: "Open" },
    ]) {
      await context.addCookies([{ name: "geo-locale", value: copy.locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(alertsPath);
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { name: copy.kind, exact: true })).toHaveCount(1);
        await expect(main.getByText(copy.reason)).toBeVisible();
        await expect(main.getByText(copy.open, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.window, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.count, { exact: true })).toBeVisible();
        await expect(main.getByRole("listitem")).toHaveCount(2);
        await expect(main.getByRole("button", { name: copy.acknowledge, exact: true })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`quality-alert-${copy.locale}.png`) });
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await activateFromKeyboard(page, main.getByRole("button", { name: "Acknowledge", exact: true }));
    await expect(main.getByText("Acknowledged", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Acknowledge", exact: true })).toHaveCount(0);
    await expect(main.getByText("2 occurrences recorded", { exact: true })).toBeVisible();
    const listed = await context.request.get(`${alertsApi}?brandId=${brandId}`, { headers });
    expect(listed.status()).toBe(200);
    expect((await listed.json()).alerts).toEqual([{ ...repeated.alert, status: "acknowledged", updatedAt: expect.any(String) }]);

    const denied = await outsider.request.get(`${alertsApi}?brandId=${brandId}`, { headers });
    expect(denied.status()).toBe(404);
    expect((await denied.json()).error.code).toBe("NOT_FOUND");
    const deniedWrite = await outsider.request.post(alertsApi, { headers, data: { action: "snooze", alertId: alert.id } });
    expect(deniedWrite.status()).toBe(404);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto(alertsPath);
    await expect(outsiderPage.getByRole("link", { name: "Set up a brand", exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(windowId)).toHaveCount(0);
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
