import { execFileSync } from "node:child_process";
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
const shots = ".cache/issue-183/shares";
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

function reportFixture(command: string, payload: object) {
  return JSON.parse(execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", command, JSON.stringify(payload),
  ], { encoding: "utf8" }));
}

test("brand owner shares a real snapshot with an authorized read-only viewer and revokes access", async ({ context, page, browser }) => {
  test.setTimeout(150_000);
  const database = process.env.DATABASE_URL;
  if (!database || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
    throw new Error("White-label share browser tests require loopback PostgreSQL");
  }
  const sql = postgres(database, { max: 1 });
  const viewerCtx = await browser.newContext({ baseURL: origin });
  const viewerPage = await viewerCtx.newPage();
  const outsider = await browser.newContext({ baseURL: origin });
  const emails = [
    `share-owner-${randomUUID()}@example.invalid`,
    `share-viewer-${randomUUID()}@example.invalid`,
    `share-outsider-${randomUUID()}@example.invalid`,
  ];
  const main = page.getByRole("main");
  let brandId: string | undefined;
  let shareId: string | undefined;

  try {
    const ownerId = await register(context, emails[0]);
    const viewerId = await register(viewerCtx, emails[1]);
    await register(outsider, emails[2]);

    const shares = () => sql`
      select id, brand_id, snapshot_id, track, sample_size, grade, expires_at, revoked
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

    // Grant read_only access to viewerId
    const grantResp = await context.request.post("/api/settings/team/grants", {
      headers,
      data: { userId: viewerId, brandId, role: "read_only" },
    });
    expect(grantResp.status()).toBe(200);

    // Before generating a snapshot, the form should guide to reports instead of manual fields
    await visit(page, "zh-CN", 375);
    await expect(main.getByText(zh.shares.noSnapshots, { exact: true })).toBeVisible();

    // Seed report observations and generate a real report snapshot
    const seeded = reportFixture("report-observations", { userId: ownerId, brandId }) as {
      before: { start: string; endExclusive: string; samples: unknown[] };
      after: { start: string; endExclusive: string; samples: unknown[] };
    };
    const retestResp = await context.request.post("/api/reports", {
      headers,
      data: {
        action: "request-retest",
        brandId,
        operationId: randomUUID(),
        kind: "exploratory",
        intent: "diagnostic",
        track: "model_api",
        timezone: "Asia/Shanghai",
        entityVersion: 1,
        before: seeded.before,
        after: seeded.after,
        locale: "zh-CN",
        metric: "recommendation_rate",
      },
    });
    expect(retestResp.status()).toBe(200);
    const retestId = (await retestResp.json()).retest.id as string;

    const snapResp = await context.request.post("/api/reports", {
      headers,
      data: {
        action: "generate-report",
        brandId,
        operationId: randomUUID(),
        retestId,
        before: seeded.before,
        after: seeded.after,
        locale: "zh-CN",
        metric: "recommendation_rate",
        brandName,
      },
    });
    expect(snapResp.status()).toBe(200);
    const snapshotId = (await snapResp.json()).snapshot.id as string;

    for (const locale of locales) {
      const copy = messages[locale].shares;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form", { name: copy.createTitle })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `ready-${locale}`);
      }
    }

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    expect((await context.request.post(endpoint, { headers, data: { brandId, snapshotId, expiresAt, guarantee: "guaranteed results" } })).status()).toBe(400);
    expect((await context.request.post(endpoint, { headers, data: { brandId, snapshotId, expiresAt: new Date(0).toISOString() } })).status()).toBe(400);
    expect((await context.request.post(endpoint, { headers, data: { brandId, track: "model_api", sampleSize: 6, grade: "exploratory", expiresAt } })).status()).toBe(400);

    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.shares.createTitle });
    await activate(page, main.getByRole("link", { name: zh.shares.startRegistration, exact: true }));
    await expect(form.getByRole("combobox", { name: zh.shares.brand })).toBeFocused();
    await page.keyboard.press("Tab");
    const snapshotSelect = form.getByRole("combobox", { name: zh.shares.snapshot });
    await expect(snapshotSelect).toBeFocused();
    await expect(snapshotSelect).toHaveValue(snapshotId);

    const expiresInput = form.getByRole("textbox", { name: zh.shares.expiresAt });
    await expiresInput.fill(expiresAt);

    const save = form.getByRole("button", { name: zh.shares.saveShare, exact: true });
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
    await expect(englishForm.getByRole("textbox", { name: en.shares.expiresAt })).toHaveValue(expiresAt);
    await activate(page, englishForm.getByRole("button", { name: en.shares.saveShare, exact: true }));
    await expect(englishForm.getByRole("status")).toHaveText(en.shares.saved);

    const [saved] = await shares();
    expect(saved).toMatchObject({ brand_id: brandId, snapshot_id: snapshotId, track: "model_api", sample_size: 6, grade: "exploratory", expires_at: expiresAt, revoked: 0 });
    shareId = saved.id as string;
    const card = main.getByRole("article", { name: brandName, exact: true });
    await expect(card).toBeVisible();

    for (const locale of locales) {
      const copy = messages[locale].shares;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(card.getByText(copy.statusActive, { exact: true })).toBeVisible();
        await expect(field(card, copy.track).locator("dd")).toContainText("model_api");
        await expect(field(card, copy.sampleSize).locator("dd").first()).toHaveText("6");
        await expect(field(card, copy.grade).locator("dd")).toContainText("exploratory");
        await expect(field(card, copy.limitations).locator("dd")).toContainText("小样本探索，不代表稳定趋势");
        await expect(field(card, copy.expiresAt).locator("time")).toHaveAttribute("datetime", expiresAt);
        await checkLayout(page, copy.viewHistory, width, `active-${locale}`);
      }
    }

    // Authorized read_only viewer opens /dashboard/reports/shares and the controlled preview URL
    await viewerPage.context().addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await viewerPage.setViewportSize({ width: 375, height: 800 });
    await viewerPage.goto(path);
    const viewerMain = viewerPage.getByRole("main");
    await expect(viewerMain.getByRole("form")).toHaveCount(0);
    await expect(viewerMain.getByText(zh.shares.readOnlyNotice, { exact: true })).toBeVisible();
    const viewerCard = viewerMain.getByRole("article", { name: brandName, exact: true });
    await expect(viewerCard.getByRole("button", { name: zh.shares.revokeShare })).toHaveCount(0);
    await viewerCard.getByRole("link", { name: zh.shares.openPreview, exact: true }).click();
    await expect(viewerPage).toHaveURL(`${origin}${path}/${shareId}`);
    await expect(viewerMain.getByRole("heading", { level: 1, name: zh.shares.previewTitle })).toBeVisible();
    await expect(viewerMain).toContainText(brandName);
    await expect(viewerMain).toContainText("model_api");
    await expect(viewerMain).toContainText("6");
    await expect(viewerMain).toContainText("exploratory");
    await expect(viewerMain).toContainText("小样本探索，不代表稳定趋势");
    await expect(viewerMain).toContainText(zh.shares.causalityNotice);

    const history = await accesses();
    expect(history).toEqual([expect.objectContaining({ share_id: shareId, visitor_id: viewerId })]);

    // read_only viewer cannot create or revoke via API
    const resource = `${endpoint}/${shareId}`;
    expect((await viewerCtx.request.post(endpoint, { headers, data: { brandId, snapshotId, expiresAt } })).status()).toBe(403);
    expect((await viewerCtx.request.post(`${resource}/revoke`, { headers })).status()).toBe(403);

    // Outsider cannot read, preview, create, or revoke
    expect((await outsider.request.get(resource, { headers })).status()).toBe(404);
    expect((await outsider.request.post(resource, { headers })).status()).toBe(404);
    expect((await outsider.request.post(`${resource}/revoke`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(endpoint, { headers, data: { brandId, snapshotId, expiresAt } })).status()).toBe(404);

    // Owner revokes the share; the viewer's original entry /dashboard/reports/shares/[id] immediately stops working
    await visit(page, "en", 375);
    await activate(page, card.getByRole("button", { name: en.shares.revokeShare, exact: true }));
    const dialog = page.getByRole("dialog", { name: en.shares.revokeShare });
    const confirm = dialog.getByRole("button", { name: en.shares.confirmRevoke, exact: true });
    await activate(page, confirm);
    await expect(dialog).toHaveCount(0);
    await expect(card.getByText(en.shares.statusRevoked, { exact: true })).toBeVisible();
    expect(await shares()).toEqual([{ ...saved, revoked: 1 }]);
    expect((await viewerCtx.request.get(resource, { headers })).status()).toBe(404);
    expect((await viewerCtx.request.post(resource, { headers })).status()).toBe(404);
    await viewerPage.goto(`${path}/${shareId}`);
    await expect(viewerMain.getByRole("alert")).toHaveText(zh.shares.NOT_FOUND);
    await expect(viewerMain).not.toContainText("小样本探索，不代表稳定趋势");
    expect(await accesses()).toEqual(history);
  } finally {
    try {
      await viewerCtx.close();
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
