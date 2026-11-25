import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/shares";
const endpoint = "/api/reports/shares";
const headers = { Origin: origin };
const probe = "geo-shares-read";
const shots = ".cache/issue-135/shares";
const brandName = `Fixture-${"whitelabel".repeat(6)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
type Locale = typeof locales[number];
type Messages = typeof import("../../src/lib/i18n/messages/zh-CN.json");
const zh: Messages = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const en: Messages = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const messages = { "zh-CN": zh, en };

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Synthetic white-label fixture", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: Locale, width: number, viaSettings = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaSettings ? "/dashboard/settings" : path);
  if (viaSettings) await activate(page, page.getByRole("link", { name: messages[locale].settings.openWhitelabelShares, exact: true }));
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="reports"]')).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: messages[locale].shares.title })).toBeVisible();
}

async function checkLayout(page: Page, action: string, width: number, shot: string) {
  const link = page.getByRole("main").getByRole("link", { name: action, exact: true });
  await expect(link).toBeInViewport({ ratio: 1 });
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `${shots}/${shot}-${width}.png`, animations: "disabled" });
}

function field(card: Locator, label: string) {
  return card.locator("dl > div").filter({ has: card.page().getByText(label, { exact: true }) });
}

test("brand owners can preview, expire and revoke white-label shares from the keyboard", async ({ context, page, browser }) => {
  test.setTimeout(150_000);
  const database = process.env.DATABASE_URL;
  if (!database || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
    throw new Error("White-label share browser tests require loopback PostgreSQL");
  }
  const sql = postgres(database, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const emails = [`share-owner-${randomUUID()}@example.invalid`, `share-outsider-${randomUUID()}@example.invalid`];
  const main = page.getByRole("main");
  let brandId: string | undefined;
  let shareId: string | undefined;

  try {
    const ownerId = await register(context, emails[0]);
    const shares = () => sql`
      select id, brand_id, track, sample_size, grade, expires_at, revoked
      from whitelabel_share where owner_id = ${ownerId} order by created_at, id`;
    const accesses = () => sql`
      select a.share_id, a.visitor_id, a.accessed_at
      from whitelabel_share_access a join whitelabel_share s on s.id = a.share_id
      where s.owner_id = ${ownerId} order by a.accessed_at, a.id`;

    for (const locale of locales) {
      const copy = messages[locale].shares;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main.getByText(copy.empty, { exact: true })).toBeVisible();
        await checkLayout(page, copy.openBrands, width, `no-brand-${locale}`);
      }
    }

    const brand = await context.request.post("/api/brands", { headers, data: {
      action: "submit", actorId: ownerId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName, description: "Synthetic white-label fixture.", website: "https://shares.example.com",
        aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    } });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;
    for (const locale of locales) {
      const copy = messages[locale].shares;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form", { name: copy.createTitle })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `ready-${locale}`);
      }
    }

    const data = {
      brandId, track: "official_api", sampleSize: 1234, grade: "exploratory",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect((await context.request.post(endpoint, { headers, data: { ...data, guarantee: "guaranteed results" } })).status()).toBe(400);
    expect((await context.request.post(endpoint, { headers, data: { ...data, expiresAt: new Date(0).toISOString() } })).status()).toBe(400);
    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.shares.createTitle });
    await activate(page, main.getByRole("link", { name: zh.shares.startRegistration, exact: true }));
    await expect(form.getByRole("combobox", { name: zh.shares.brand })).toBeFocused();
    await page.keyboard.press("Tab");
    const track = form.getByRole("textbox", { name: zh.shares.track });
    await expect(track).toBeFocused();
    await track.fill(data.track);
    await form.getByRole("textbox", { name: zh.shares.grade }).fill(data.grade);
    await form.getByRole("textbox", { name: zh.shares.expiresAt }).fill(data.expiresAt);
    const sample = form.getByRole("textbox", { name: zh.shares.sampleSize });
    await sample.fill("-1");
    const save = form.getByRole("button", { name: zh.shares.saveShare, exact: true });
    await activate(page, save);
    await expect(form.getByRole("status")).toHaveText(zh.shares.INVALID_INPUT);
    expect(await shares()).toHaveLength(0);

    await sample.fill(String(data.sampleSize));
    const release = Promise.withResolvers<void>();
    let writes = 0;
    const countWrite = (request: Request) => {
      if (request.url() === origin + endpoint && request.method() === "POST") writes++;
    };
    page.on("request", countWrite);
    await page.route(`**${endpoint}`, async (route) => {
      await release.promise;
      await route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } });
    }, { times: 1 });
    try {
      await activate(page, save);
      const saving = form.getByRole("button", { name: zh.shares.saving });
      await expect(saving).toBeFocused();
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect.poll(() => writes).toBe(1);
    } finally {
      release.resolve();
      page.off("request", countWrite);
    }
    await expect(form.getByRole("status")).toHaveText(zh.shares.SERVICE_UNAVAILABLE);
    await expect(save).toBeFocused();
    expect(await shares()).toHaveLength(0);
    await page.getByRole("combobox", { name: zh.common.language, exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishForm = main.getByRole("form", { name: en.shares.createTitle });
    await expect(englishForm.getByRole("status")).toHaveText(en.shares.SERVICE_UNAVAILABLE);
    await expect(englishForm.getByRole("textbox", { name: en.shares.expiresAt })).toHaveValue(data.expiresAt);
    await expect(englishForm.getByRole("textbox", { name: en.shares.sampleSize })).toHaveValue(String(data.sampleSize));
    await activate(page, englishForm.getByRole("button", { name: en.shares.saveShare, exact: true }));
    await expect(englishForm.getByRole("status")).toHaveText(en.shares.saved);
    const [saved] = await shares();
    expect(saved).toMatchObject({ brand_id: brandId, track: data.track, sample_size: data.sampleSize, grade: data.grade, expires_at: data.expiresAt, revoked: 0 });
    shareId = saved.id as string;
    const card = main.getByRole("article", { name: brandName, exact: true });
    await expect(card).toBeVisible();

    for (const locale of locales) {
      const copy = messages[locale].shares;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(card.getByText(copy.statusActive, { exact: true })).toBeVisible();
        await expect(field(card, copy.track).locator("dd")).toHaveText(data.track);
        await expect(field(card, copy.sampleSize).locator("dd")).toHaveText(String(data.sampleSize));
        await expect(field(card, copy.grade).locator("dd")).toHaveText(data.grade);
        await expect(field(card, copy.expiresAt).locator("time")).toHaveAttribute("datetime", data.expiresAt);
        await checkLayout(page, copy.viewHistory, width, `active-${locale}`);
      }
    }

    const resource = `${endpoint}/${shareId}`;
    expect((await context.request.post(resource)).status()).toBe(403);
    expect((await context.request.post(resource, { headers: { Origin: "https://untrusted.example.invalid" } })).status()).toBe(403);
    expect(await accesses()).toHaveLength(0);
    await visit(page, "en", 375);
    await activate(page, main.getByRole("link", { name: en.shares.viewHistory, exact: true }));
    await expect(main.getByRole("heading", { name: en.shares.myShares })).toBeFocused();
    const preview = page.waitForResponse((response) => response.url() === origin + resource && response.request().method() === "POST");
    await activate(page, card.getByRole("button", { name: en.shares.viewShare, exact: true }));
    const viewed = await preview;
    expect(viewed.status()).toBe(200);
    expect(viewed.headers()["cache-control"]).toBe("private, no-store");
    expect((await viewed.json()).share).toMatchObject({
      id: shareId, track: data.track, sampleSize: data.sampleSize, grade: data.grade,
    });
    await expect(card.getByRole("status")).toContainText("Track: official_api. Sample size: 1234. Conclusion grade: exploratory.");
    const history = await accesses();
    expect(history).toEqual([expect.objectContaining({ share_id: shareId, visitor_id: ownerId })]);
    await expect(field(card, en.shares.accessCount).locator("time")).toHaveAttribute("datetime", history[0].accessed_at);
    await card.screenshot({ path: `${shots}/preview-en-375.png` });

    expect((await outsider.request.post(resource, { headers })).status()).toBe(401);
    await register(outsider, emails[1]);
    expect((await outsider.request.get(resource, { headers })).status()).toBe(404);
    expect((await outsider.request.post(resource, { headers })).status()).toBe(404);
    expect((await outsider.request.post(`${resource}/revoke`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(endpoint, { headers, data })).status()).toBe(404);
    expect(await accesses()).toEqual(history);

    for (const locale of locales) {
      const copy = messages[locale].shares;
      await visit(page, locale, 375);
      const revoke = card.getByRole("button", { name: copy.revokeShare, exact: true });
      await activate(page, revoke);
      const dialog = page.getByRole("dialog", { name: copy.revokeShare });
      await expect(dialog).toContainText(copy.confirmDescription);
      await expect(dialog.getByRole("button", { name: copy.cancel, exact: true })).toBeFocused();
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/revoke-${locale}-375.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(revoke).toBeFocused();
      expect(await shares()).toEqual([saved]);
    }

    await activate(page, card.getByRole("button", { name: en.shares.revokeShare, exact: true }));
    const dialog = page.getByRole("dialog", { name: en.shares.revokeShare });
    const confirm = dialog.getByRole("button", { name: en.shares.confirmRevoke, exact: true });
    await page.route(`**${resource}/revoke`, (route) => route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } }), { times: 1 });
    await activate(page, confirm);
    await expect(dialog.getByRole("status")).toHaveText(en.shares.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await shares()).toEqual([saved]);
    await activate(page, confirm);
    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole("heading")).toBeFocused();
    await expect(card.getByText(en.shares.statusRevoked, { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: en.shares.viewShare })).toHaveCount(0);
    await expect(card.getByRole("status")).toHaveText(en.shares.revoked);
    expect(await shares()).toEqual([{ ...saved, revoked: 1 }]);
    expect((await context.request.get(resource, { headers })).status()).toBe(404);
    expect((await context.request.post(resource, { headers })).status()).toBe(404);
    expect(await accesses()).toEqual(history);

    const expiring = await context.request.post(endpoint, { headers, data: {
      ...data, sampleSize: 0, expiresAt: new Date(Date.now() + 8000).toISOString(),
    } });
    expect(expiring.status()).toBe(200);
    const expiredId = (await expiring.json()).share.id as string;
    await visit(page, "zh-CN", 375);
    const expired = main.locator(`article[aria-labelledby="whitelabel-share-${expiredId}"]`);
    await expect(expired.getByText(zh.shares.statusActive, { exact: true })).toBeVisible();
    await expect(expired.getByText(zh.shares.statusExpired, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(expired.getByRole("button", { name: zh.shares.viewShare })).toHaveCount(0);
    await expect(field(expired, zh.shares.sampleSize).locator("dd")).toHaveText("0");
    expect((await context.request.post(`${endpoint}/${expiredId}`, { headers })).status()).toBe(404);
    expect(await accesses()).toEqual(history);
    await expired.screenshot({ path: `${shots}/expired-zh-CN-375.png` });

    for (const locale of locales) {
      const copy = messages[locale].shares;
      await visit(page, locale, 375);
      await expect(expired.getByText(copy.statusExpired, { exact: true })).toBeVisible();
      await context.addCookies([{ name: probe, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(expired).toBeVisible();
      await context.addCookies([{ name: probe, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("article")).toHaveCount(0);
      await expect(main).not.toContainText("Private white-label share fixture failure");
      await checkLayout(page, copy.reload, 375, `read-failure-${locale}`);
      await context.clearCookies({ name: probe });
      await activate(page, main.getByRole("link", { name: copy.reload, exact: true }));
      await expect(expired).toBeVisible();
    }

    const archive = await context.request.post("/api/brands", { headers, data: {
      action: "archive", actorId: ownerId, operationId: randomUUID(), brandId, expectedBrandRevision: 1,
    } });
    expect(archive.status()).toBe(200);
    expect((await context.request.post(endpoint, { headers, data })).status()).toBe(404);
    await visit(page, "en", 375);
    await expect(main.getByRole("form", { name: en.shares.createTitle })).toHaveCount(0);
    await expect(main.getByRole("article", { name: brandId, exact: true })).toHaveCount(2);
    await checkLayout(page, en.shares.viewHistory, 375, "archived-en");
    expect(await accesses()).toEqual(history);
  } finally {
    try {
      await outsider.close();
      for (const email of emails) {
        await sql`delete from "user" where email = ${email}`;
        expect(await sql`select 1 from "user" where email = ${email}`).toHaveLength(0);
      }
      if (brandId) {
        expect(await sql`select 1 from brand where id = ${brandId}`).toHaveLength(0);
        expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select 1 from whitelabel_share where brand_id = ${brandId}`).toHaveLength(0);
      }
      if (shareId) expect(await sql`select 1 from whitelabel_share_access where share_id = ${shareId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
