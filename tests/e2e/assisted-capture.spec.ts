import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const route = "/dashboard/monitoring/capture";
const overviewRoute = "/dashboard/monitoring/overview";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成采集品牌-${"LongSegment_".repeat(4)}end`;

const copy = {
  "zh-CN": {
    title: "采集助手",
    openCapture: "打开采集助手",
    noBrand: "先完成一个活跃品牌的建档，再保存采集预览。",
    openBrand: "去建档",
    backOverview: "返回监测概览",
    startCreate: "冻结采集题单",
    browseSheets: "查看采集题单",
    viewBrand: "查看品牌",
    empty: "还没有采集题单。登录墙不会被记成完整存证。",
    promptIds: "题目 ID",
    assistedMinutes: "辅助耗时（分钟）",
    manualMinutes: "人工耗时（分钟）",
    citationsComplete: "引用是否完整",
    create: "保存题单",
    creating: "正在保存…",
    sheetSaved: "已保存冻结题单。",
    invalidInput: "题单或尝试无效。请检查题目 ID、耗时、引用数和阻塞原因。",
    modeAssisted: "辅助",
    modeManual: "人工",
    savedMinutesLine: (minutes: string) => `节省 ${minutes} 分钟`,
    blockedBy: "阻塞原因",
    citationCount: "引用数",
    recordAttempt: "保存预览",
    attemptSaved: "已保存采集预览。",
    statusHandoff: "已交接",
    statusPartial: "部分",
    statusPreview: "预览",
    confirm: "确认这次预览",
    confirmedSaved: "已确认本次预览。",
    completeYes: "完整标记：是",
    completeNo: "完整标记：否",
    savedYes: "已保存预览",
    savedNo: "尚未保存为存证",
    structureChanged: "入口结构是否变化",
    degrade: "更新题单模式",
    modeUpdated: "已更新题单模式。",
    manualActiveNote: "当前已处于人工模式，原冻结题目保留，仍可继续新增人工尝试。",
    loading: "正在加载采集助手…",
    unavailable: "暂时无法读取或保存采集预览，请稍后重试。",
    reload: "重新载入",
  },
  en: {
    title: "Capture helper",
    openCapture: "Open capture helper",
    noBrand: "Finish an active brand profile before saving a capture preview.",
    openBrand: "Open brand setup",
    backOverview: "Back to monitoring overview",
    startCreate: "Freeze a capture sheet",
    browseSheets: "View capture sheets",
    viewBrand: "View brand",
    empty: "No capture sheets yet. A login wall is not stored as complete evidence.",
    promptIds: "Question IDs",
    assistedMinutes: "Assisted minutes",
    manualMinutes: "Manual minutes",
    citationsComplete: "Citations complete",
    create: "Save sheet",
    creating: "Saving…",
    sheetSaved: "Frozen capture sheet saved.",
    invalidInput: "The sheet or attempt is invalid. Check the question IDs, timings, citation count, and block reason.",
    modeAssisted: "Assisted",
    modeManual: "Manual",
    savedMinutesLine: (minutes: string) => `Saved ${minutes} minutes`,
    blockedBy: "Block reason",
    citationCount: "Citation count",
    recordAttempt: "Save preview",
    attemptSaved: "Capture preview saved.",
    statusHandoff: "Handed off",
    statusPartial: "Partial",
    statusPreview: "Preview",
    confirm: "Confirm this preview",
    confirmedSaved: "Preview confirmed.",
    completeYes: "Complete flag: yes",
    completeNo: "Complete flag: no",
    savedYes: "Preview saved",
    savedNo: "Not saved as evidence",
    structureChanged: "Did the entry structure change?",
    degrade: "Update sheet mode",
    modeUpdated: "Sheet mode updated.",
    manualActiveNote: "Manual mode is active. Frozen question IDs remain and manual attempts can still be recorded.",
    loading: "Loading capture helper…",
    unavailable: "Capture previews cannot be read or saved right now. Try again later.",
    reload: "Reload",
  },
};

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function keyboardActivate(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.GEO_CAPTURE_SCREENSHOTS;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function register(context: BrowserContext, sql: postgres.Sql) {
  const email = `assisted-capture-${randomUUID()}@example.invalid`;
  const signup = await registerTestAccount(context, {
    name: "Assisted capture visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(signup.status()).toBe(200);
  const { user: { id } } = await signup.json();
  const userId = String(id);
  await sql`UPDATE "user" SET email_verified = true WHERE id = ${userId}`;
  return { userId, email };
}

test("monitoring/capture aligns to ui-visual-v1 with bilingual viewports, keyboard flow, isolation, and read recovery", async ({
  context,
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const sql = openTestDatabase();
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const users: string[] = [];
  let brandId = "";
  const firstPromptId = randomUUID();
  const secondPromptId = randomUUID();
  const main = page.getByRole("main");
  const header = main.locator("header").first();

  async function checkAcrossViewports(
    primaryKey: "openBrand" | "startCreate" | "browseSheets",
    shotPrefix: string,
    assertBody: (locale: (typeof locales)[number]) => Promise<void>,
  ) {
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator('[data-workspace-section="monitoring"]')).toBeVisible();
        await expect(main).toHaveCount(1);
        await expect(header.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
        const primary = header.getByRole("link", { name: labels[primaryKey], exact: true });
        await expect(primary).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await assertBody(locale);
        if (width === 375) await screenshot(page, `${shotPrefix}-${locale}-375`);
      }
    }
  }

  try {
    const owner = await register(context, sql);
    users.push(owner.userId);
    const peer = await register(outsider, sql);
    users.push(peer.userId);

    await checkAcrossViewports("openBrand", "nobrand", async (locale) => {
      await expect(main.getByText(copy[locale].noBrand, { exact: true })).toBeVisible();
      await expect(header.getByRole("link", { name: copy[locale].backOverview, exact: true })).toBeVisible();
    });

    const saved = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: owner.userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "用于采集助手页面视觉与流程验收的合成品牌。",
          website: "https://assisted-capture-fixture.example.com",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(saved.status()).toBe(200);
    brandId = String((await saved.json()).id);

    await checkAcrossViewports("startCreate", "empty", async (locale) => {
      await expect(main.getByText(brandName, { exact: true })).toBeVisible();
      await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
      await expect(header.getByRole("link", { name: copy[locale].viewBrand, exact: true })).toHaveAttribute(
        "href",
        `/dashboard/brands/${brandId}`,
      );
    });

    // Navigate from monitoring overview via keyboard
    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(overviewRoute);
    await keyboardActivate(page, main.getByRole("link", { name: copy["zh-CN"].openCapture, exact: true }));
    await expect(page).toHaveURL(`${origin}${route}`);

    await keyboardActivate(page, header.getByRole("link", { name: copy["zh-CN"].startCreate, exact: true }));
    await expect(page).toHaveURL(`${origin}${route}#capture-create-heading`);

    // Client-side validation rejects invalid prompt IDs, preserves input, and sends 0 POSTs
    let sheetPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/monitoring/capture/sheets")) {
        sheetPosts += 1;
      }
    });
    const promptInput = main.getByLabel(copy["zh-CN"].promptIds, { exact: true });
    await promptInput.fill("not-a-uuid");
    await keyboardActivate(page, main.getByRole("button", { name: copy["zh-CN"].create, exact: true }));
    await expect(main.getByRole("alert")).toContainText(copy["zh-CN"].invalidInput);
    await expect(promptInput).toHaveValue("not-a-uuid");
    expect(sheetPosts).toBe(0);

    // Slow submit with in-flight dedup guard
    await promptInput.fill(`${firstPromptId}\n${secondPromptId}`);
    await main.getByLabel(copy["zh-CN"].assistedMinutes, { exact: true }).fill("12");
    await main.getByLabel(copy["zh-CN"].manualMinutes, { exact: true }).fill("30");
    await main.getByLabel(copy["zh-CN"].citationsComplete, { exact: true }).selectOption("true");

    await context.addCookies([{ name: "geo-capture-write", value: "slow", url: origin }]);
    const createBtn = main.getByRole("button", { name: copy["zh-CN"].create, exact: true });
    await createBtn.focus();
    await page.keyboard.press("Enter");
    const pendingBtn = main.getByRole("button", { name: copy["zh-CN"].creating, exact: true });
    await expect(pendingBtn).toBeVisible();
    await expect(pendingBtn).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(main.getByText(copy["zh-CN"].sheetSaved, { exact: true })).toBeVisible();
    expect(sheetPosts).toBe(1);
    await context.clearCookies({ name: "geo-capture-write" });

    // Sheet is displayed with saved minutes and frozen question IDs
    await expect(main.getByText(copy["zh-CN"].savedMinutesLine("18"), { exact: true })).toBeVisible();
    await expect(main.getByText(firstPromptId, { exact: true })).toBeVisible();
    await expect(main.getByText(secondPromptId, { exact: true })).toBeVisible();

    const [sheetRow] = await sql`
      SELECT id, mode FROM capture_sheet WHERE brand_id = ${brandId} ORDER BY created_at DESC LIMIT 1
    `;
    const sheetId = String(sheetRow.id);
    expect(sheetRow.mode).toBe("assisted");

    // Record handoff (login wall): stopped, no confirm button, API confirm stays unsaved
    const blockSelect = main.getByLabel(copy["zh-CN"].blockedBy, { exact: true });
    const citationInput = main.getByLabel(copy["zh-CN"].citationCount, { exact: true });
    const recordBtn = main.getByRole("button", { name: copy["zh-CN"].recordAttempt, exact: true });

    await blockSelect.selectOption("login");
    await citationInput.fill("3");
    await keyboardActivate(page, recordBtn);
    await expect(main.getByText(copy["zh-CN"].attemptSaved, { exact: true })).toBeVisible();
    await expect(main.getByText(copy["zh-CN"].statusHandoff, { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: copy["zh-CN"].confirm, exact: true })).toHaveCount(0);

    const [handoffAttempt] = await sql`
      SELECT id, status, confirmed FROM capture_attempt WHERE sheet_id = ${sheetId} AND status = 'handoff' LIMIT 1
    `;
    const handoffConfirm = await context.request.post(`/api/monitoring/capture/attempts/${handoffAttempt.id}/confirm`, {
      headers,
      data: { confirmed: true },
    });
    expect(handoffConfirm.status()).toBe(200);
    const handoffPayload = await handoffConfirm.json();
    expect(handoffPayload.sheet.attempts[0].saved).toBe(false);
    expect(handoffPayload.sheet.attempts[0].complete).toBe(false);

    // Record partial (0 citations): can confirm via keyboard, complete stays No
    await blockSelect.selectOption("");
    await citationInput.fill("0");
    await keyboardActivate(page, recordBtn);
    await expect(main.getByText(copy["zh-CN"].statusPartial, { exact: true })).toBeVisible();
    await keyboardActivate(page, main.getByRole("button", { name: copy["zh-CN"].confirm, exact: true }).first());
    await expect(main.getByText(copy["zh-CN"].savedYes, { exact: true }).first()).toBeVisible();

    // Record preview (>0 citations): confirm via keyboard -> complete Yes
    await blockSelect.selectOption("");
    await citationInput.fill("2");
    await keyboardActivate(page, recordBtn);
    await expect(main.getByText(copy["zh-CN"].statusPreview, { exact: true })).toBeVisible();
    await keyboardActivate(page, main.getByRole("button", { name: copy["zh-CN"].confirm, exact: true }).first());
    await expect(main.getByText(copy["zh-CN"].completeYes, { exact: true })).toBeVisible();

    // Verify bilingual populated viewports before and after degrade
    await checkAcrossViewports("browseSheets", "populated", async (locale) => {
      await expect(main.getByText(firstPromptId, { exact: true })).toBeVisible();
      await expect(main.getByText(copy[locale].savedMinutesLine("18"), { exact: true })).toBeVisible();
    });

    // Degrade to manual: keeps question IDs and allows new manual attempt
    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(route);
    await main.getByLabel(copy["zh-CN"].structureChanged, { exact: true }).selectOption("true");
    await keyboardActivate(page, main.getByRole("button", { name: copy["zh-CN"].degrade, exact: true }));
    await expect(main.getByText(copy["zh-CN"].modeUpdated, { exact: true })).toBeVisible();
    await expect(main.getByText(copy["zh-CN"].manualActiveNote, { exact: true })).toBeVisible();
    await expect(main.getByText(firstPromptId, { exact: true })).toBeVisible();

    // Still recordable after degrade
    await main.getByLabel(copy["zh-CN"].citationCount, { exact: true }).fill("4");
    await keyboardActivate(page, main.getByRole("button", { name: copy["zh-CN"].recordAttempt, exact: true }));
    await expect(main.getByText(copy["zh-CN"].attemptSaved, { exact: true })).toBeVisible();

    // Cross-account isolation
    const outsiderPage = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(route);
    const outsiderMain = outsiderPage.getByRole("main");
    await expect(outsiderMain.getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(outsiderMain.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(outsiderMain.getByText(firstPromptId, { exact: true })).toHaveCount(0);
    const deniedDegrade = await outsider.request.post(`/api/monitoring/capture/sheets/${sheetId}/degrade`, {
      headers,
      data: { structureChanged: true },
    });
    expect(deniedDegrade.status()).toBe(404);
    await outsiderPage.close();

    // Read failure & loading skeleton recovery in zh-CN & en at 375px
    for (const locale of locales) {
      const labels = copy[locale];
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-capture-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(route, { waitUntil: "commit" });
      await expect(main.getByRole("status", { name: labels.loading })).toBeVisible();
      await screenshot(page, `loading-${locale}-375`);

      const alert = main.getByRole("alert");
      await expect(alert).toContainText(labels.unavailable);
      await expect(main.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
      await expect(main.getByText("Private assisted capture fixture failure")).toHaveCount(0);
      await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(main.getByText(firstPromptId, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

      const reload = main.getByRole("link", { name: labels.reload, exact: true });
      await expect(reload).toBeInViewport({ ratio: 1 });
      await expect(reload).toHaveAttribute("href", route);
      await screenshot(page, `unavailable-${locale}-375`);

      await context.clearCookies({ name: "geo-capture-read" });
      await keyboardActivate(page, reload);
      await expect(page).toHaveURL(`${origin}${route}`);
      await expect(main.getByText(firstPromptId, { exact: true })).toBeVisible();
    }
  } finally {
    try {
      await outsider.close();
      if (brandId) {
        await sql`DELETE FROM capture_attempt WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM capture_sheet WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM brand WHERE id = ${brandId}`;
      }
      if (users.length) {
        await sql`DELETE FROM "user" WHERE id IN ${sql(users)}`;
        expect(await sql`SELECT id FROM "user" WHERE id IN ${sql(users)}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
