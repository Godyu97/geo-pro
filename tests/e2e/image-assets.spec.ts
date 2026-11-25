import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/content/assets";
const api = "/api/content/assets";
const headers = { Origin: origin };
const shots = ".cache/issue-135/assets";
const fileName = `合成素材-${"SyntheticImage".repeat(7)}.png`;
const copy = {
  "zh-CN": {
    title: "图片素材", open: "图片素材", setup: "前往品牌", start: "开始登记素材", list: "已登记素材",
    view: "查看已登记素材", empty: "还没有图片素材。", file: "文件名", version: "素材版本",
    register: "登记素材", citation: "内容版本 ID", addCitation: "登记引用", revoke: "撤销使用权",
    confirm: "确认撤销", expire: "标记到期", confirmExpire: "确认到期", cancel: "取消",
    loading: "正在加载图片素材…", unavailable: "图片素材暂时不能读取。请稍后重试。", retry: "重新载入",
  },
  en: {
    title: "Image assets", open: "Image assets", setup: "Go to brands", start: "Start asset registration", list: "Registered assets",
    view: "View registered assets", empty: "No image assets yet.", file: "File name", version: "Asset version",
    register: "Register asset", citation: "Content version ID", addCitation: "Register citation", revoke: "Revoke right",
    confirm: "Confirm revocation", expire: "Mark expired", confirmExpire: "Confirm expiration", cancel: "Cancel",
    loading: "Loading image assets…", unavailable: "Image assets are temporarily unavailable. Try again later.", retry: "Reload",
  },
} as const;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];

async function register(context: BrowserContext) {
  const response = await registerTestAccount(context, {
    name: "Synthetic image asset tester", email: `asset-visual-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function layout(page: Page, control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function seedContentVersion(sql: ReturnType<typeof postgres>, brandId: string, ownerId: string) {
  const [brief, briefVersion, batch, unit, content] = Array.from({ length: 5 }, () => randomUUID());
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`insert into content_brief (id, brand_id, owner_id, status, created_at, updated_at)
      values (${brief}, ${brandId}, ${ownerId}, 'draft', ${now}, ${now})`;
    await tx`insert into content_brief_version (id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary,
      primary_page, conversion_action, template_kind, title_candidates_json, fact_version_ids_json, created_at)
      values (${briefVersion}, ${brief}, ${brandId}, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["Synthetic title"]', '[]', ${now})`;
    await tx`insert into content_batch (id, brand_id, owner_id, status, operation_id, cost_ledger_json, created_at, updated_at)
      values (${batch}, ${brandId}, ${ownerId}, 'completed', ${randomUUID()}, '{}', ${now}, ${now})`;
    await tx`insert into content_batch_unit (id, batch_id, brief_id, brand_id, status, attempt_count, created_at, updated_at)
      values (${unit}, ${batch}, ${brief}, ${brandId}, 'succeeded', 1, ${now}, ${now})`;
    await tx`insert into content_version (id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id, template_kind,
      title, body_markdown, claims_json, status, fingerprint, created_at, updated_at, target_channel, labeling_profile_version,
      labeling_profile_status, image_asset_ids_json, fact_version_ids_json)
      values (${content}, ${brandId}, ${ownerId}, ${brief}, ${briefVersion}, ${unit}, 'fact_faq', 'Synthetic title', 'Synthetic body',
      '{}', 'draft', 'asset-visual-fingerprint', ${now}, ${now}, 'primary_page', 'unverified', 'unverified', '[]', '[]')`;
  });
  return content;
}

test("image assets preserve citations through confirmed rights changes and recover from read failure", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Image asset browser tests require local PostgreSQL");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: string[] = [];
  let brandId: string | undefined;
  async function visit(locale: (typeof locales)[number], width: number, target: string) {
    await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(target);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator('[data-workspace-section="content"]')).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  }
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    for (const locale of locales) {
      for (const width of widths) {
        await visit(locale, width, path);
        await layout(page, page.getByRole("main").getByRole("link", { name: copy[locale].setup, exact: true }));
      }
      await page.setViewportSize({ width: 375, height: 800 });
      await page.screenshot({ path: `${shots}/no-brand-${locale}-375.png` });
    }

    const brand = await context.request.post("/api/brands", { headers, data: {
      action: "submit", actorId: owner, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: { name: "Synthetic image assets brand", description: "Synthetic visual acceptance only.",
        website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
    } });
    expect(brand.status()).toBe(200);
    const ownedBrandId: string = (await brand.json()).id;
    brandId = ownedBrandId;
    const target = `${path}?brandId=${ownedBrandId}`;
    const contentId = await seedContentVersion(sql, ownedBrandId, owner);
    const contentRow = () => sql`select status, fingerprint, image_asset_ids_json from content_version where id = ${contentId}`;
    const originalContent = await contentRow();
    const main = page.getByRole("main");

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(`/dashboard/content?brandId=${ownedBrandId}`);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].open, exact: true }));
    await expect(page).toHaveURL(origin + target);
    for (const locale of locales) {
      for (const width of widths) {
        await visit(locale, width, target);
        await layout(page, main.getByRole("link", { name: copy[locale].start }));
        await expect(main.getByText(copy[locale].empty)).toBeVisible();
        if (width === 375) await page.screenshot({ path: `${shots}/empty-${locale}-375.png` });
      }
    }

    const zh = copy["zh-CN"];
    await visit("zh-CN", 375, target);
    await activate(page, main.getByRole("link", { name: zh.start }));
    const nameInput = main.getByRole("textbox", { name: zh.file });
    await expect(nameInput).toBeFocused();
    await nameInput.fill(fileName);
    await main.getByRole("textbox", { name: zh.version }).fill("3");
    await activate(page, main.getByRole("button", { name: zh.register }));
    await expect(main.getByRole("status")).toContainText("已登记素材。");
    const [asset] = await sql`select id, version, byte_size from image_asset where brand_id = ${ownedBrandId}`;
    expect(asset).toMatchObject({ version: 3, byte_size: null });
    const assetId: string = asset.id;
    const assetApi = `${api}/${assetId}`;
    const statuses = () => sql`select rights_status from image_asset where brand_id = ${ownedBrandId} and id = ${assetId}`;
    await main.getByRole("textbox", { name: zh.citation }).fill(contentId);
    await activate(page, main.getByRole("button", { name: zh.addCitation }));
    await expect(main.getByRole("status")).toContainText("已按当前素材版本登记引用。");

    for (const locale of locales) {
      const words = copy[locale];
      for (const width of widths) {
        await visit(locale, width, target);
        await layout(page, main.getByRole("link", { name: words.view }));
        await activate(page, main.getByRole("link", { name: words.view }));
        await expect(main.getByRole("heading", { name: words.list, exact: true })).toBeFocused();
        await expect(main.getByRole("heading", { name: fileName })).toBeVisible();
        const trigger = main.getByRole("button", { name: words.revoke });
        await activate(page, trigger);
        const dialog = page.getByRole("dialog", { name: words.revoke });
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(dialog.getByRole("button", { name: words.cancel })).toBeFocused();
        await expect(dialog).toContainText(fileName);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `${shots}/confirm-${locale}-${width}.png`, animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
    expect(await statuses()).toEqual([{ rights_status: "active" }]);
    expect(await sql`select id from image_asset_todo where brand_id = ${ownedBrandId}`).toHaveLength(0);

    await visit("zh-CN", 375, target);
    await activate(page, main.getByRole("button", { name: zh.revoke }));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: zh.confirm })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(main.getByRole("status")).toContainText("使用权已撤销");
    await expect(main.getByRole("textbox", { name: zh.citation })).toHaveCount(0);
    const history = main.getByRole("listitem").filter({ has: page.getByRole("heading", { name: fileName }) });
    await expect(history.getByText(`固定素材版本 3 · 内容版本 ${contentId}`, { exact: true })).toBeVisible();
    await expect(history.getByText(`待办 · 固定素材版本 3 · 内容版本 ${contentId}`, { exact: true })).toBeVisible();
    await history.screenshot({ path: `${shots}/revoked-history-zh-CN.png` });

    const repeated = await context.request.post(`${assetApi}/revoke`, { headers, data: { brandId: ownedBrandId } });
    expect(repeated.status()).toBe(200);
    const receipt = await repeated.json();
    expect(receipt.uses).toHaveLength(1);
    expect(receipt.todos).toHaveLength(1);
    expect(receipt.uses[0]).toMatchObject({ contentVersionId: contentId, assetVersion: 3 });
    expect(receipt.todos[0]).toMatchObject({ useId: receipt.uses[0].id, contentVersionId: contentId, assetVersion: 3 });
    expect(await statuses()).toEqual([{ rights_status: "revoked" }]);
    expect(await sql`select id from image_asset_use where brand_id = ${ownedBrandId}`).toHaveLength(1);
    expect(await sql`select id from image_asset_todo where brand_id = ${ownedBrandId}`).toHaveLength(1);
    expect(await contentRow()).toEqual(originalContent);
    expect((await context.request.post(`${assetApi}/uses`, { headers, data: { brandId: ownedBrandId, contentVersionId: contentId } })).status()).toBe(409);

    const second = await context.request.post(api, { headers, data: { brandId: ownedBrandId, fileName: "synthetic-expiry.png" } });
    expect(second.status()).toBe(201);
    const expiryId: string = (await second.json()).asset.id;
    const en = copy.en;
    await visit("en", 375, target);
    await activate(page, main.getByRole("button", { name: en.expire }));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: en.confirmExpire })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(main.getByRole("status")).toContainText("Asset expired");
    expect(await sql`select rights_status from image_asset where id = ${expiryId}`).toEqual([{ rights_status: "expired" }]);

    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const other = await outsider.newPage();
    await other.goto(target);
    await expect(other.getByRole("heading", { name: en.title, exact: true })).toBeVisible();
    await expect(other.getByRole("main").getByRole("alert")).toContainText("Asset not found or not visible.");
    await expect(other.getByText(fileName)).toHaveCount(0);
    await expect(other.getByRole("form")).toHaveCount(0);
    expect((await outsider.request.get(`${assetApi}?brandId=${ownedBrandId}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(`${assetApi}/revoke`, { headers, data: { brandId: ownedBrandId } })).status()).toBe(404);

    for (const locale of locales) {
      const words = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-image-assets-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(target, { waitUntil: "commit" });
      await expect(main.getByRole("status")).toContainText(words.loading);
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(main.getByRole("alert")).toContainText(words.unavailable);
      await expect(main.getByRole("heading", { name: words.title, exact: true })).toBeVisible();
      await expect(main.getByText(fileName)).toHaveCount(0);
      await expect(main.getByText("Private image assets fixture failure")).toHaveCount(0);
      const retry = main.getByRole("link", { name: words.retry });
      await expect(retry).toHaveAttribute("href", target);
      await layout(page, retry);
      await page.screenshot({ path: `${shots}/unavailable-${locale}-375.png` });
      await context.clearCookies({ name: "geo-image-assets-read" });
      await activate(page, retry);
      await expect(main.getByRole("heading", { name: fileName })).toBeVisible();
    }
  } finally {
    try {
      if (accounts.length) {
        await sql`delete from "user" where id in ${sql(accounts)}`;
        expect(await sql`select id from "user" where id in ${sql(accounts)}`).toHaveLength(0);
      }
      if (brandId) {
        expect(await sql`select id from brand where id = ${brandId}`).toHaveLength(0);
        expect(await sql`select id from content_version where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select id from image_asset where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select id from image_asset_use where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select id from image_asset_todo where brand_id = ${brandId}`).toHaveLength(0);
      }
    } finally {
      await outsider.close();
      await sql.end();
    }
  }
});
