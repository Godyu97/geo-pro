import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/settings/data-connections";
const api = "/api/settings/data-connections";
const headers = { Origin: origin };
const shots = ".cache/issue-135/data-connections";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const displayName = `Fixture-${"source".repeat(12)}`;
const fields = ["event_id", `local_${"field".repeat(11)}`, "session_count"];
const probeCookie = "geo-data-connections-read";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const copy = {
  "zh-CN": {
    title: "数据连接", open: "预览字段并批准拉取", start: "开始登记", review: "查看待批准预览",
    back: "返回账户设置", empty: "还没有数据连接。", noBrands: "当前没有可登记数据连接的品牌。",
    goBrands: "前往品牌资料", brand: "品牌", form: "登记预览", name: "显示名称", fields: "字段名",
    preview: "预览", approved: "已批准", approve: "批准连接", pull: "尝试拉取",
    missingPull: "尚未记录", count: "字段数量", records: "连接记录", reload: "重新载入",
    loading: "正在加载数据连接…", unavailable: "数据连接暂时不可用，请稍后重试。",
  },
  en: {
    title: "Data connections", open: "Preview fields and approve a pull", start: "Start registration", review: "Review pending preview",
    back: "Back to account settings", empty: "No data connections yet.", noBrands: "There is no brand available for a data connection.",
    goBrands: "Go to brands", brand: "Brand", form: "Register preview", name: "Display name", fields: "Field names",
    preview: "Preview", approved: "Approved", approve: "Approve connection", pull: "Try pull",
    missingPull: "Not recorded", count: "Field count", records: "Connections", reload: "Reload",
    loading: "Loading data connections…", unavailable: "Data connections are temporarily unavailable. Try again shortly.",
  },
} as const;

async function register(context: BrowserContext) {
  const email = `data-connections-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Data connections visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: keyof typeof copy, width: number, viaSettings = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaSettings ? "/dashboard/settings" : path);
  if (viaSettings) await activate(page, page.getByRole("link", { name: copy[locale].open, exact: true }));
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(copy[locale].title));
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375 || width === 1440) await page.screenshot({ path: `${shots}/${shot}-${width}.png` });
}

test("connection preview, approval and pull have a keyboard path and preserve field scope", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local PostgreSQL database");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  const brandIds: string[] = [];
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    const brand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "Synthetic brand for data connection preview.",
          website: "https://data-connections.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const brandId: string = (await brand.json()).id;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    brandIds.push(brandId);
    const main = await visit(page, "zh-CN", 375, true);
    await checkLayout(page, main.getByRole("link", { name: copy["zh-CN"].start, exact: true }), 375, "empty-zh-CN");

    async function readStored() {
      const rows = await sql`
        select id, brand_id, display_name, status, field_count, pull_attempted_at, updated_at
        from data_connection where owner_id = ${owner.userId} order by id`;
      const fieldRows = await sql`
        select field_name from data_connection_field where owner_id = ${owner.userId} order by position`;
      return { rows, fields: fieldRows.map((row) => row.field_name) };
    }

    for (const locale of locales) {
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expect(main.getByRole("form", { name: copy[locale].form })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start, exact: true }), width, `empty-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const zh = copy["zh-CN"];
    const form = main.getByRole("form", { name: zh.form });
    const brandField = form.getByRole("combobox", { name: zh.brand });
    const name = form.getByRole("textbox", { name: zh.name, exact: true });
    const fieldNames = form.getByRole("textbox", { name: zh.fields, exact: true });
    const save = form.getByRole("button", { name: zh.form, exact: true });
    const formNotice = form.getByRole("status");
    await activate(page, main.getByRole("link", { name: zh.start, exact: true }));
    await expect(brandField).toBeFocused();
    expect(await brandField.evaluate((element) => element.matches(":focus-visible") && getComputedStyle(element).boxShadow !== "none")).toBe(true);
    await page.screenshot({ path: `${shots}/field-focus-zh-CN-375.png` });
    await expect(brandField).toHaveValue(brandId);
    await name.fill(displayName);
    await fieldNames.fill("event_id\nevent_id");
    await activate(page, save);
    await expect(formNotice).toContainText("请检查显示名称和字段名");
    await expect(fieldNames).toHaveValue("event_id\nevent_id");
    expect(await readStored()).toEqual({ rows: [], fields: [] });

    const submittedFields = fields.join("\n");
    await fieldNames.fill(submittedFields);
    await page.route(`**${api}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Private data connection write fixture failure" } },
    }), { times: 1 });
    await activate(page, save);
    await expect(formNotice).toHaveText(zh.unavailable);
    await expect(save).toBeFocused();
    await expect(main).not.toContainText("Private data connection write fixture failure");
    await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const enForm = main.getByRole("form", { name: copy.en.form });
    await expect(enForm.getByRole("status")).toHaveText(copy.en.unavailable);
    await expect(enForm.getByRole("textbox", { name: copy.en.name, exact: true })).toHaveValue(displayName);
    await expect(enForm.getByRole("textbox", { name: copy.en.fields, exact: true })).toHaveValue(submittedFields);
    expect(await readStored()).toEqual({ rows: [], fields: [] });
    await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    const createdResponse = page.waitForResponse(origin + api, { timeout: 10_000 });
    await activate(page, save);
    expect((await createdResponse).status()).toBe(200);
    await expect(formNotice).toContainText("已保存");
    await expect(name).toHaveValue("");
    await expect(fieldNames).toHaveValue("");
    await expect(save).toBeFocused();
    const storedPreview = await readStored();
    expect(storedPreview).toMatchObject({ rows: [{
      brand_id: brandId, display_name: displayName, status: "preview", field_count: 3, pull_attempted_at: null,
    }], fields });
    expect(storedPreview.rows).toHaveLength(1);
    const connectionId: string = storedPreview.rows[0].id;

    const card = main.getByRole("article", { name: displayName });
    async function checkConnection(status: "preview" | "approved") {
      for (const locale of locales) {
        for (const width of widths) {
          await visit(page, locale, width);
          await expect(card.getByText(brandName, { exact: true })).toBeVisible();
          await expect(card.getByText(copy[locale][status], { exact: true })).toBeVisible();
          await expect(card.getByText(copy[locale].count, { exact: true })).toBeVisible();
          await expect(card.getByText("3", { exact: true })).toBeVisible();
          await expect(card.getByRole("listitem")).toHaveText(fields);
          await checkLayout(page, main.getByRole("link", { name: copy[locale][status === "preview" ? "review" : "start"], exact: true }), width, `${status}-${locale}`);
          if (width === 375) await card.screenshot({ path: `${shots}/card-${status}-${locale}.png` });
        }
      }
    }
    await checkConnection("preview");
    await visit(page, "zh-CN", 375);
    const heading = card.getByRole("heading", { name: displayName, exact: true });
    const approve = card.getByRole("button", { name: zh.approve });
    const pull = card.getByRole("button", { name: zh.pull });
    const approvePath = `${api}/${connectionId}/approve`;
    const pullPath = `${api}/${connectionId}/pull`;
    await activate(page, main.getByRole("link", { name: zh.review, exact: true }));
    await expect(heading).toBeFocused();
    await expect(card.getByText(zh.missingPull, { exact: true })).toBeVisible();
    const blockedResponse = page.waitForResponse(origin + pullPath, { timeout: 10_000 });
    await activate(page, pull);
    expect((await blockedResponse).status()).toBe(409);
    await expect(card.getByRole("status")).toHaveText("连接仍是预览状态，拉取已被拒绝。");
    await expect(pull).toBeFocused();
    expect(await readStored()).toEqual(storedPreview);

    await page.route(`**${approvePath}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
    }), { times: 1 });
    await activate(page, approve);
    await expect(card.getByRole("status")).toHaveText(zh.unavailable);
    await expect(approve).toBeFocused();
    expect(await readStored()).toEqual(storedPreview);
    const approvedResponse = page.waitForResponse(origin + approvePath, { timeout: 10_000 });
    await activate(page, approve);
    expect((await approvedResponse).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText("连接已批准。现在可以记录一次拉取尝试。");
    await expect(approve).toHaveCount(0);
    await expect(heading).toBeFocused();
    expect(await readStored()).toMatchObject({ rows: [{ id: connectionId, status: "approved", pull_attempted_at: null }], fields });

    await page.keyboard.press("Tab");
    await expect(pull).toBeFocused();
    const pulledResponse = page.waitForResponse(origin + pullPath, { timeout: 10_000 });
    await page.keyboard.press("Enter");
    expect((await pulledResponse).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText("拉取尝试已记录。");
    await expect(card.getByText(zh.missingPull, { exact: true })).toHaveCount(0);
    const storedApproved = await readStored();
    const pullAttemptedAt: string = storedApproved.rows[0].pull_attempted_at;
    expect(pullAttemptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(storedApproved).toMatchObject({ rows: [{ id: connectionId, status: "approved", pull_attempted_at: pullAttemptedAt }], fields });
    const repeated = await context.request.post(pullPath, { headers, data: {} });
    expect(repeated.status()).toBe(200);
    expect(await repeated.json()).toMatchObject({ connection: {
      id: connectionId, brandId, displayName, fieldCount: fields.length, fieldNames: fields, status: "approved",
      pullAttemptedAt, preview: { pull: true, fields },
    } });
    expect(await readStored()).toEqual(storedApproved);
    const [{ eventCount }] = await sql`select count(*)::int as "eventCount" from connector_event where owner_id = ${owner.userId}`;
    expect(eventCount).toBe(0);
    await checkConnection("approved");

    for (const locale of locales) {
      await visit(page, locale, 375);
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy[locale].loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(heading).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy[locale].unavailable);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("region", { name: copy[locale].records })).toHaveCount(0);
      for (const hidden of [brandName, displayName, fields[0], "Private data connections fixture failure"]) {
        await expect(main).not.toContainText(hidden);
      }
      const reload = main.getByRole("link", { name: copy[locale].reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(heading).toBeVisible();
      expect(await readStored()).toEqual(storedApproved);
    }

    const otherPage = await outsider.newPage();
    for (const locale of locales) {
      for (const width of widths) {
        const outsideMain = await visit(otherPage, locale, width);
        await expect(outsideMain.getByText(copy[locale].noBrands, { exact: true })).toBeVisible();
        await expect(outsideMain.getByRole("form")).toHaveCount(0);
        await expect(outsideMain).not.toContainText(displayName);
        await checkLayout(otherPage, outsideMain.getByRole("link", { name: copy[locale].goBrands, exact: true }), width, `no-brand-${locale}`);
      }
    }
    await activate(otherPage, otherPage.getByRole("link", { name: copy.en.goBrands, exact: true }));
    await expect(otherPage).toHaveURL(`${origin}/dashboard/brands`);
    expect((await outsider.request.post(api, { headers, data: { brandId, displayName, fieldNames: fields } })).status()).toBe(404);
    for (const command of [approvePath, pullPath]) {
      expect((await outsider.request.post(command, { headers, data: {} })).status()).toBe(404);
    }
    expect(await readStored()).toEqual(storedApproved);
  } finally {
    await outsider.close();
    try {
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
        const { userId, email } = account;
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from data_connection where owner_id = ${userId}) as connection,
                 exists (select 1 from data_connection_field where owner_id = ${userId}) as field`;
        expect(remaining).toEqual({ account: false, brand: false, connection: false, field: false });
      }
      for (const brandId of brandIds) {
        expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
