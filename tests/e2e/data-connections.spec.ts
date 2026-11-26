import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
    for (const command of [approvePath, pullPath, `${api}/${connectionId}/sync`]) {
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

test("incremental sync preserves current cursor on historical replay, enforces conflict, and shows receipt boundaries", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local PostgreSQL database");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  const brandIds: string[] = [];
  const syncCopy = {
    "zh-CN": {
      cursorField: "下一段游标",
      coverage: "这一段覆盖完整",
      eventsField: "事件行",
      syncAction: "同步这一段",
      syncSaved: "已按游标保存。相同事件仍只计 1 条咨询。",
      syncReplayed: "这一段游标已经同步过，咨询计数没有增加。",
      conflict: "这次连接状态或同步游标已变化，或与历史批次荷载冲突，没有写入。请重新载入或核对当前游标后再试。",
      incomplete: "这一段同步范围不完整。已保存的事件仍按原计数，不会补造缺失事件。",
      missingReceipts: "缺少启用前的历史同步回执，更早的游标无法核对；可从当前游标继续推进。",
      stopped: "同步已停止。已保存的事件和线索仍可查看，后续拉取不再写入。",
      leadsTitle: "脱敏线索",
      leadsCount: "这条咨询计 1 次。",
      leadsSources: "连接器 · CSV",
      leadsMissingReceipts: "缺少启用前的历史同步回执，更早游标边界无法核对；可从当前游标继续同步。",
    },
    en: {
      cursorField: "Next cursor",
      coverage: "This range is complete",
      eventsField: "Event rows",
      syncAction: "Sync this range",
      syncSaved: "Saved for this cursor. The same event still counts as one inquiry.",
      syncReplayed: "This cursor was already synced, so the inquiry count did not increase.",
      conflict: "This connection state or sync cursor changed, or the payload conflicts with a processed batch, so nothing was saved. Reload or check the current cursor and try again.",
      incomplete: "This sync range is incomplete. Saved events keep their count, and missing events are not invented.",
      missingReceipts: "Historical sync receipts before this check was enabled are missing, so earlier cursors cannot be verified. You can continue from the current cursor.",
      stopped: "Sync is stopped. Saved events and leads remain available, and later pulls do not write new rows.",
      leadsTitle: "De-identified leads",
      leadsCount: "This inquiry counts as 1.",
      leadsSources: "Connector · CSV",
      leadsMissingReceipts: "Historical sync receipts before this check was enabled are missing, so earlier cursor boundaries cannot be verified. Sync can continue from the current cursor.",
    },
  } as const;

  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    const syncBrandName = `SyncFlow-${randomUUID().slice(0, 8)}`;
    const sourceName = `SyncSource-${randomUUID().slice(0, 8)}`;
    const legacyName = `LegacySource-${randomUUID().slice(0, 8)}`;
    const brandRes = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: syncBrandName, description: "Synthetic brand for cursor replay e2e.",
          website: "https://sync-e2e.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brandRes.status()).toBe(200);
    const brandId: string = (await brandRes.json()).id;
    brandIds.push(brandId);

    // Authorize both connections, create & approve them.
    const authRes = await context.request.post("/api/settings/sync-authorizations", {
      headers,
      data: { brandId, sourceName, retainedRows: 3 },
    });
    expect(authRes.status()).toBe(200);
    const authorizationId: string = (await authRes.json()).authorization.id;

    const legacyAuthRes = await context.request.post("/api/settings/sync-authorizations", {
      headers,
      data: { brandId, sourceName: legacyName, retainedRows: 1 },
    });
    expect(legacyAuthRes.status()).toBe(200);

    const connRes = await context.request.post(api, {
      headers,
      data: { brandId, displayName: sourceName, fieldNames: ["event_id", "page_path"] },
    });
    expect(connRes.status()).toBe(200);
    const connectionId: string = (await connRes.json()).connection.id;
    expect((await context.request.post(`${api}/${connectionId}/approve`, { headers, data: {} })).status()).toBe(200);

    const legacyConnRes = await context.request.post(api, {
      headers,
      data: { brandId, displayName: legacyName, fieldNames: ["event_id"] },
    });
    expect(legacyConnRes.status()).toBe(200);
    const legacyConnectionId: string = (await legacyConnRes.json()).connection.id;
    expect((await context.request.post(`${api}/${legacyConnectionId}/approve`, { headers, data: {} })).status()).toBe(200);

    // Simulate a pre-existing connection that already had a cursor before batch receipts existed.
    await sql`update data_connection set sync_cursor = 'legacy-cur-1', coverage_complete = 1 where id = ${legacyConnectionId}`;

    // Import one CSV lead first so we can verify cross-source dedup on sync.
    const csvEventKey = "evt-e2e-csv-1";
    const connectorDigest = createHash("sha256").update(`connector:${csvEventKey}`).digest("hex");
    const csvRes = await context.request.post("/api/reports/leads", {
      headers,
      data: { brandId, rows: [{ eventId: csvEventKey, evidence: "self_report", directIdentifier: false }] },
    });
    expect(csvRes.status()).toBe(200);

    // Use keyboard on /dashboard/settings/data-connections to sync batch-1 (incomplete), then batch-2 (complete + late CSV event).
    const main = await visit(page, "zh-CN", 375);
    const card = main.getByRole("article", { name: sourceName });
    const legacyCard = main.getByRole("article", { name: legacyName });
    await expect(legacyCard.getByText(syncCopy["zh-CN"].missingReceipts, { exact: true })).toBeVisible();

    const syncForm = card.getByRole("form", { name: "增量同步" });
    const cursorInput = syncForm.getByRole("textbox", { name: syncCopy["zh-CN"].cursorField });
    const coverageCheckbox = syncForm.getByRole("checkbox", { name: syncCopy["zh-CN"].coverage });
    const eventsInput = syncForm.getByRole("textbox", { name: syncCopy["zh-CN"].eventsField });
    const syncButton = syncForm.getByRole("button", { name: syncCopy["zh-CN"].syncAction });

    await cursorInput.fill("batch-1");
    await coverageCheckbox.uncheck();
    await eventsInput.fill(`${csvEventKey},${connectorDigest},referral`);
    const batch1Res = page.waitForResponse(`${origin}${api}/${connectionId}/sync`, { timeout: 10_000 });
    await activate(page, syncButton);
    expect((await batch1Res).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText(syncCopy["zh-CN"].syncSaved);
    await expect(card.getByText("batch-1", { exact: true })).toBeVisible();
    await expect(card.getByText(syncCopy["zh-CN"].incomplete, { exact: true })).toBeVisible();

    await cursorInput.fill("batch-2");
    await coverageCheckbox.check();
    await eventsInput.fill("");
    const batch2Res = page.waitForResponse(`${origin}${api}/${connectionId}/sync`, { timeout: 10_000 });
    await activate(page, syncButton);
    expect((await batch2Res).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText(syncCopy["zh-CN"].syncSaved);
    await expect(card.getByText("batch-2", { exact: true })).toBeVisible();

    // Delayed replay of historical batch-1 via UI form keeps batch-2 and coverageComplete=true.
    await cursorInput.fill("batch-1");
    await coverageCheckbox.uncheck();
    await eventsInput.fill(`${csvEventKey},${connectorDigest},referral`);
    const replayRes = page.waitForResponse(`${origin}${api}/${connectionId}/sync`, { timeout: 10_000 });
    await activate(page, syncButton);
    expect((await replayRes).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText(syncCopy["zh-CN"].syncReplayed);
    await expect(card.getByText("batch-2", { exact: true })).toBeVisible();
    await expect(card.getByText(syncCopy["zh-CN"].incomplete, { exact: true })).toHaveCount(0);

    // Submitting historical batch-1 with a different payload returns 409 CONFLICT and preserves batch-2.
    await coverageCheckbox.check();
    const conflictRes = page.waitForResponse(`${origin}${api}/${connectionId}/sync`, { timeout: 10_000 });
    await activate(page, syncButton);
    expect((await conflictRes).status()).toBe(409);
    await expect(card.getByRole("status")).toHaveText(syncCopy["zh-CN"].conflict);
    await expect(card.getByText("batch-2", { exact: true })).toBeVisible();

    // Verify responsive layout in zh-CN & en across 375/768/1440 on /dashboard/settings/data-connections and /dashboard/reports/leads.
    for (const locale of locales) {
      for (const width of widths) {
        const settingsMain = await visit(page, locale, width);
        await expect(settingsMain.getByRole("article", { name: sourceName }).getByText("batch-2", { exact: true })).toBeVisible();
        await expect(settingsMain.getByRole("article", { name: legacyName }).getByText(syncCopy[locale].missingReceipts, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

        await page.goto("/dashboard/reports/leads");
        const leadsMain = page.getByRole("main");
        await expect(leadsMain.getByRole("heading", { level: 1, name: syncCopy[locale].leadsTitle, exact: true })).toBeVisible();
        await expect(leadsMain.getByText("batch-2", { exact: true })).toBeVisible();
        await expect(leadsMain.getByText(syncCopy[locale].leadsCount, { exact: true })).toBeVisible();
        await expect(leadsMain.getByText(syncCopy[locale].leadsSources).first()).toBeVisible();
        await expect(leadsMain.getByText(syncCopy[locale].leadsMissingReceipts, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }

    // Concurrent API calls with same expectedCursor ("batch-2"): one 200, one 409 CONFLICT, no partial writes.
    const [race1, race2] = await Promise.all([
      context.request.post(`${api}/${connectionId}/sync`, {
        headers,
        data: {
          expectedCursor: "batch-2",
          cursor: "batch-3a",
          coverageComplete: true,
          events: [{ eventKey: "evt-e2e-race-a", payloadDigest: connectorDigest, evidence: "referral" }],
        },
      }),
      context.request.post(`${api}/${connectionId}/sync`, {
        headers,
        data: {
          expectedCursor: "batch-2",
          cursor: "batch-3b",
          coverageComplete: true,
          events: [{ eventKey: "evt-e2e-race-b", payloadDigest: connectorDigest, evidence: "referral" }],
        },
      }),
    ]);
    expect([race1.status(), race2.status()].sort()).toEqual([200, 409]);

    // Revoke authorization, confirm SYNC_STOPPED (409) and cross-account 404 without cursor leak.
    const revokeRes = await context.request.post(`/api/settings/sync-authorizations/${authorizationId}/revoke`, {
      headers,
      data: {},
    });
    expect(revokeRes.status()).toBe(200);
    const stoppedRes = await context.request.post(`${api}/${connectionId}/sync`, {
      headers,
      data: { cursor: "batch-after-revoke", coverageComplete: true, events: [] },
    });
    expect(stoppedRes.status()).toBe(409);
    const outsiderRes = await outsider.request.post(`${api}/${connectionId}/sync`, {
      headers,
      data: { cursor: "batch-outsider", coverageComplete: true, events: [] },
    });
    expect(outsiderRes.status()).toBe(404);
    expect(await outsiderRes.text()).not.toContain("batch-");

    await visit(page, "zh-CN", 375);
    await expect(page.getByRole("article", { name: sourceName }).getByText(syncCopy["zh-CN"].stopped, { exact: true })).toBeVisible();
  } finally {
    await outsider.close();
    try {
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
      }
      for (const brandId of brandIds) {
        expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
