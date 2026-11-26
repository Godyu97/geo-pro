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
    const main = page.getByRole("main");
    await expect(main.getByText("当前版本的趋势阈值是 10 个百分点。", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await activateFromKeyboard(page, page.getByRole("link", { name: "查看站内提醒", exact: true }));
    await expect(page).toHaveURL(alertsPath);
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
      { locale: "zh-CN", title: "质量提醒", kind: "数据质量", reason: /最新窗口覆盖不足/, window: `窗口 ${windowId}`, count: "已记录 2 次", acknowledge: "确认", open: "待处理", missing: /未找到关联的采样计划与窗口读数/ },
      { locale: "en", title: "Quality alerts", kind: "Data quality", reason: /latest window does not have enough coverage/, window: `Window ${windowId}`, count: "2 occurrences recorded", acknowledge: "Acknowledge", open: "Open", missing: /No linked sampling plan or window reading was found/ },
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
        await expect(main.getByText(copy.missing)).toBeVisible();
        await expect(main.getByRole("listitem")).toHaveCount(2);
        await expect(main.getByRole("button", { name: copy.acknowledge, exact: true })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`quality-alert-${copy.locale}.png`) });
      }
    }

    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/dashboard/monitoring/plans");
    await expect(main.getByText("This version's trend threshold is 10 percentage points.", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/monitoring/plans");
    await expect(main.getByText("This version's trend threshold is 10 percentage points.", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.goto(alertsPath);
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

test("owners can navigate from an alert to its exact plan window and linked run while outsiders are denied", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(120_000);
  const ownerEmail = `alert-window-owner-${randomUUID()}@example.invalid`;
  const outsiderEmail = `alert-window-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string; brandId?: string }> = [];
  try {
    const ownerId = await register(context, ownerEmail);
    const outsiderId = await register(outsider, outsiderEmail);
    accounts.push({ userId: ownerId, email: ownerEmail });
    accounts.push({ userId: outsiderId, email: outsiderEmail });

    const createBrand = async (target: Page, targetContext: BrowserContext, name: string) => {
      await targetContext.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
      await target.goto("/dashboard/brands/new");
      await target.getByLabel("品牌名称", { exact: true }).fill(name);
      await target.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于提醒窗口导航验收。");
      await target.getByLabel("官网地址", { exact: true }).fill("https://alert-window.example.com");
      await target.getByRole("button", { name: "下一步", exact: true }).click();
      await target.getByLabel("竞品", { exact: true }).fill("合成对照品牌");
      await target.getByRole("button", { name: "下一步", exact: true }).click();
      await target.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
      await target.getByRole("button", { name: "保存品牌", exact: true }).click();
      await expect(target.getByRole("heading", { name: name, exact: true })).toBeVisible();
      return new URL(target.url()).pathname.split("/").at(-1) as string;
    };

    const brandId = await createBrand(page, context, "提醒窗口导航品牌");
    accounts[0].brandId = brandId;
    const outsiderPage = await outsider.newPage();
    const outsiderBrandId = await createBrand(outsiderPage, outsider, "无关旁观品牌");
    accounts[1].brandId = outsiderBrandId;

    const fixture = JSON.parse(
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "alert-window-fixture",
        JSON.stringify({ ownerId, brandId }),
      ], { encoding: "utf8" }),
    ) as {
      planAId: string;
      planBId: string;
      runA22Id: string;
      runA23Id: string;
      runB22Id: string;
      alertId: string;
      windowId: string;
      timezone: string;
      plannedCount: number;
      eligibleCount: number;
      judgedCount: number;
    };

    const main = page.getByRole("main");
    for (const copy of [
      {
        locale: "zh-CN",
        openWindow: "打开采样窗口",
        reading: "保存读数：P 2 · E 0 · 可判断 0",
        noDecline: "这条提醒不宣称品牌表现下滑。",
        windowTitle: "提醒触发的采样窗口",
        failedKept: "其中 1 个失败槽位保留在 P 分母中。",
        noAnswers: "该运行暂无已入证回答。",
        openRunDetail: "打开运行详情与回答",
        runTitle: "监测运行",
        runReceipts: "槽位和回执",
        slotFailed: "失败",
      },
      {
        locale: "en",
        openWindow: "Open sampling window",
        reading: "Saved reading: P 2 · E 0 · Judged 0",
        noDecline: "This alert does not claim that brand performance declined.",
        windowTitle: "Sampling window for alert",
        failedKept: "1 failed slot(s) remain in the P denominator.",
        noAnswers: "No ingested answers for this run yet.",
        openRunDetail: "Open run details and answers",
        runTitle: "Monitoring run",
        runReceipts: "Slots and receipts",
        slotFailed: "Failed",
      },
    ]) {
      await context.addCookies([{ name: "geo-locale", value: copy.locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(alertsPath);
        await expect(main.getByText(fixture.planAId)).toBeVisible();
        await expect(main.getByText(fixture.planBId)).toHaveCount(0);
        await expect(main.getByText(new RegExp(`${fixture.windowId}.*${fixture.timezone}`))).toBeVisible();
        await expect(main.getByText(copy.reading, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.noDecline, { exact: true })).toBeVisible();
        await expect(main.getByRole("link", { name: new RegExp(fixture.runA23Id) })).toBeVisible();
        await expect(main.getByText(fixture.runA22Id)).toHaveCount(0);
        await expect(main.getByText(fixture.runB22Id)).toHaveCount(0);
        await expectNoOverflow(page);
      }

      await page.setViewportSize({ width: 375, height: 800 });
      await activateFromKeyboard(page, main.getByRole("link", { name: copy.openWindow, exact: true }));
      await expect(page).toHaveURL(`/dashboard/monitoring/plans?planId=${fixture.planAId}&windowId=${fixture.windowId}`);
      await expect(main.getByRole("heading", { name: copy.windowTitle, exact: true })).toBeVisible();
      await expect(main.getByText(new RegExp(fixture.planAId))).toBeVisible();
      await expect(main.getByText(new RegExp(`${fixture.windowId}.*${fixture.timezone}`))).toBeVisible();
      await expect(main.getByText(copy.failedKept, { exact: true })).toBeVisible();
      await expect(main.getByText(new RegExp(fixture.runA23Id))).toBeVisible();
      await expect(main.getByText(copy.noAnswers, { exact: true })).toBeVisible();
      await expect(main.getByText(fixture.runA22Id)).toHaveCount(0);
      await expect(main.getByText(fixture.runB22Id)).toHaveCount(0);
      await expectNoOverflow(page);
      if (copy.locale === "zh-CN") {
        await page.screenshot({ path: testInfo.outputPath("alert-window-detail-zh-CN.png") });
      }
      await activateFromKeyboard(page, main.getByRole("link", { name: copy.openRunDetail, exact: true }));
      await expect(page).toHaveURL(`/dashboard/monitoring/runs/${fixture.runA23Id}`);
      await expect(main.getByRole("heading", { name: copy.runTitle, exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: copy.runReceipts, exact: true })).toBeVisible();
      await expect(main.getByText(copy.slotFailed, { exact: true }).first()).toBeVisible();
      await expectNoOverflow(page);
    }

    // Repeat trigger and acknowledge keep occurrences and window navigation intact.
    execFileSync(process.execPath, [
      "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "alert-window-repeat",
      JSON.stringify({ ownerId, planId: fixture.planAId }),
    ], { stdio: "inherit" });
    await context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await page.goto(alertsPath);
    await expect(main.getByText("2 occurrences recorded", { exact: true })).toBeVisible();
    await activateFromKeyboard(page, main.getByRole("button", { name: "Acknowledge", exact: true }));
    await expect(main.getByText("Acknowledged", { exact: true })).toBeVisible();
    await expect(main.getByText("2 occurrences recorded", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Open sampling window", exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: new RegExp(fixture.runA23Id) })).toBeVisible();

    // Outsider with their own brand is denied on both window and run deep links.
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(`/dashboard/monitoring/plans?planId=${fixture.planAId}&windowId=${fixture.windowId}`);
    await expect(outsiderPage.getByText("This page may have moved or be unavailable to your account.", { exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(fixture.planAId)).toHaveCount(0);
    await expect(outsiderPage.getByText(fixture.runA23Id)).toHaveCount(0);
    await outsiderPage.goto(`/dashboard/monitoring/runs/${fixture.runA23Id}`);
    await expect(outsiderPage.getByText("This run is unavailable for your account.", { exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(fixture.runA23Id)).toHaveCount(0);
    console.log(JSON.stringify({
      alertId: fixture.alertId,
      planId: fixture.planAId,
      excludedPlanId: fixture.planBId,
      windowId: fixture.windowId,
      timezone: fixture.timezone,
      plannedCount: fixture.plannedCount,
      eligibleCount: fixture.eligibleCount,
      judgedCount: fixture.judgedCount,
      linkedRunId: fixture.runA23Id,
      excludedRunIds: [fixture.runA22Id, fixture.runB22Id],
    }));
  } finally {
    await outsider.close();
    for (const { userId, email, brandId } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId, email, brandId }),
      ], { stdio: "inherit" });
    }
  }
});
