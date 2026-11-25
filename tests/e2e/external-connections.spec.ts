import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/settings/connections";
const api = "/api/settings/connections";
const headers = { Origin: origin };
const shots = ".cache/issue-135/external-connections";
const probeCookie = "geo-external-connections-read";
const brandName = `Fixture-${"brand".repeat(13)}`;
const draftName = `Fixture-${"desk".repeat(17)}`;
const publishName = "Synthetic publish desk";
const draftKey = `draft-${"check".repeat(14)}`;
const unknownKey = "fixture-unknown-action";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const zhCN: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const messages = { "zh-CN": zhCN, en };
const zh = zhCN.externalConnections;

async function register(context: BrowserContext) {
  const email = `external-connections-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "External connections fixture", email, password: randomBytes(24).toString("base64url"),
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

async function visit(page: Page, locale: keyof typeof messages, width: number, viaSettings = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaSettings ? "/dashboard/settings" : path);
  if (viaSettings) {
    await activate(page, page.getByRole("link", { name: messages[locale].settings.openExternalConnections, exact: true }));
  }
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  const title = messages[locale].externalConnections.title;
  await expect(main.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(title));
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width !== 768) await page.screenshot({ path: `${shots}/${shot}-${width}.png` });
}

function nextResponse(page: Page, endpoint: string) {
  return page.waitForResponse((response) => response.url() === origin + endpoint && response.request().method() === "POST", { timeout: 10_000 });
}

function failOnce(page: Page, endpoint: string) {
  return page.route(`**${endpoint}`, (route) => route.fulfill({
    status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
  }), { times: 1 });
}

test("external connections expose local permissions, reconciliation and revocation from the keyboard", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("External connections browser tests require a loopback PostgreSQL database");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  let brandId: string | undefined;
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
          name: brandName, description: "Synthetic brand for external connection testing.",
          website: "https://connections.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const createdBrand: string = (await brand.json()).id;
    brandId = createdBrand;
    expect(createdBrand).toMatch(/^[0-9a-f-]{36}$/);
    const stored = async () => ({
      connections: await sql`
        select id, brand_id, label, status, can_read, can_draft, can_publish, updated_at
        from external_connection where owner_id = ${owner.userId} order by label`,
      actions: await sql`
        select id, connection_id, idempotency_key, status, receipt_kind, effective_at, updated_at
        from external_action where owner_id = ${owner.userId} order by idempotency_key`,
    });

    const main = page.getByRole("main");
    for (const locale of locales) {
      const copy = messages[locale].externalConnections;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByText(copy.fixtureNote, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.emptyConnections, { exact: true })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: copy.startRegistration, exact: true }), width, `empty-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.register, exact: true });
    const brandField = form.getByRole("combobox", { name: zh.brand, exact: true });
    const label = form.getByRole("textbox", { name: zh.label, exact: true });
    const registerButton = form.getByRole("button", { name: zh.register, exact: true });
    await activate(page, main.getByRole("link", { name: zh.startRegistration, exact: true }));
    await expect(brandField).toBeFocused();
    await expect(brandField).toHaveValue(createdBrand);
    await page.keyboard.press("Tab");
    await expect(label).toBeFocused();
    await label.fill(draftName);
    await failOnce(page, api);
    await activate(page, registerButton);
    await expect(form.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(registerButton).toBeFocused();
    expect(await stored()).toEqual({ connections: [], actions: [] });

    await page.getByRole("combobox", { name: zhCN.common.language, exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishForm = main.getByRole("form", { name: en.externalConnections.register, exact: true });
    await expect(englishForm.getByRole("status")).toHaveText(en.externalConnections.SERVICE_UNAVAILABLE);
    await expect(englishForm.getByRole("textbox", { name: en.externalConnections.label, exact: true })).toHaveValue(draftName);
    await page.getByRole("combobox", { name: en.common.language, exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    let response = nextResponse(page, api);
    await activate(page, registerButton);
    expect((await response).status()).toBe(200);
    await expect(form.getByRole("status")).toHaveText(zh.saved);
    await expect(label).toHaveValue("");
    const draftCard = main.getByRole("article", { name: draftName, exact: true });
    const draftHeading = draftCard.getByRole("heading", { name: draftName, exact: true });
    await expect(draftCard.getByText(zh.statusPending, { exact: true })).toBeVisible();
    const pending = await stored();
    expect(pending.connections).toMatchObject([{ brand_id: brandId, label: draftName, status: "pending", can_read: 0, can_draft: 1, can_publish: 0 }]);
    const draftId: string = pending.connections[0].id;

    for (const locale of locales) {
      const copy = messages[locale].externalConnections;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(draftCard.getByText(copy.statusPending, { exact: true })).toBeVisible();
        const review = main.getByRole("link", { name: copy.reviewConnection, exact: true });
        await checkLayout(page, review, width, `pending-${locale}`);
        if (width === 375) {
          await activate(page, review);
          await expect(draftHeading).toBeFocused();
          await expect(draftHeading).toBeInViewport();
          await expect(draftCard.getByText(brandName, { exact: true })).toBeVisible();
        }
      }
    }

    await visit(page, "zh-CN", 375);
    await activate(page, draftCard.getByRole("button", { name: zh.verify, exact: true }));
    await expect(draftCard.getByText(zh.statusVerified, { exact: true })).toBeVisible();
    await expect(draftHeading).toBeFocused();
    expect((await stored()).connections).toMatchObject([{ id: draftId, status: "verified" }]);

    const actionBody = { idempotencyKey: draftKey, confirmed: true, remoteState: "acknowledged", receiptKind: "public_url", effectiveAt: "2026-11-23T00:00:00.000Z" };
    const draftActionPath = `${api}/${draftId}/actions`;
    const draftForm = draftCard.getByRole("form", { name: zh.submitAction, exact: true });
    await draftForm.getByRole("textbox", { name: zh.idempotencyKey, exact: true }).fill(draftKey);
    await draftForm.getByRole("checkbox", { name: zh.confirmed, exact: true }).check();
    await draftForm.getByRole("combobox", { name: zh.remoteState, exact: true }).selectOption(actionBody.remoteState);
    await draftForm.getByRole("combobox", { name: zh.receiptKind, exact: true }).selectOption(actionBody.receiptKind);
    await draftForm.getByRole("textbox", { name: zh.effectiveAt, exact: true }).fill(actionBody.effectiveAt);
    response = nextResponse(page, draftActionPath);
    await activate(page, draftForm.getByRole("button", { name: zh.submitAction, exact: true }));
    expect((await response).status()).toBe(200);
    const refusedRow = draftCard.getByRole("listitem").filter({ hasText: draftKey });
    await expect(refusedRow).toContainText(zh.reasonManual);
    await expect(refusedRow).toContainText(zh.effectiveEmpty);
    await expect(refusedRow).toContainText(`${zh.countsAsPublic}: ${zh.notPublic}`);
    await expect(refusedRow).toContainText(`${zh.interventionEffective}: ${zh.no}`);
    expect((await stored()).actions).toMatchObject([
      { connection_id: draftId, idempotency_key: draftKey, status: "failed", receipt_kind: null, effective_at: null },
    ]);

    const publishInput = { brandId, label: publishName, canRead: true, canDraft: true, canPublish: true };
    const created = await context.request.post(api, { headers, data: publishInput });
    expect(created.status()).toBe(200);
    const publishId: string = (await created.json()).connection.id;
    expect((await context.request.post(api, { headers, data: { id: publishId, status: "verified" } })).status()).toBe(200);
    const publishPath = `${api}/${publishId}/actions`;
    const unknownBody = { idempotencyKey: unknownKey, confirmed: true, remoteState: "unknown", receiptKind: null, effectiveAt: null };
    const simulatedUnknown = await context.request.post(publishPath, { headers, data: unknownBody });
    expect(simulatedUnknown.status()).toBe(200);
    const unknownId: string = (await simulatedUnknown.json()).connection.actions[0].id;

    await visit(page, "zh-CN", 375);
    const publishCard = main.getByRole("article", { name: publishName, exact: true });
    const unknownRow = publishCard.getByRole("listitem").filter({ hasText: unknownKey });
    await expect(unknownRow).toContainText(zh.statusUnknown);
    const retryPath = `${publishPath}/${unknownId}/retry`;
    response = nextResponse(page, retryPath);
    await activate(page, unknownRow.getByRole("button", { name: zh.retry, exact: true }));
    expect((await response).status()).toBe(200);
    await expect(unknownRow).toContainText(zh.statusReconciled);
    await expect(publishCard.getByRole("heading", { name: publishName, exact: true })).toBeFocused();
    const reconciled = await stored();
    expect(reconciled.actions).toMatchObject([
      { connection_id: draftId, status: "failed" },
      { id: unknownId, connection_id: publishId, status: "reconciled", receipt_kind: null, effective_at: null },
    ]);
    expect((await context.request.post(publishPath, { headers, data: unknownBody })).status()).toBe(200);
    expect((await stored()).actions).toEqual(reconciled.actions);

    for (const locale of locales) {
      const copy = messages[locale].externalConnections;
      await visit(page, locale, 375);
      const revoke = draftCard.getByRole("button", { name: copy.revoke, exact: true });
      await activate(page, revoke);
      const modal = page.getByRole("dialog", { name: copy.revoke, exact: true });
      await expect(modal.getByRole("button", { name: copy.cancel, exact: true })).toBeFocused();
      await expect(modal).toHaveAccessibleDescription(copy.revokeImpact);
      await expect(modal).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/revoke-${locale}-375.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(revoke).toBeFocused();
      expect(await stored()).toEqual(reconciled);
    }

    await visit(page, "zh-CN", 375);
    await activate(page, draftCard.getByRole("button", { name: zh.revoke, exact: true }));
    const dialog = page.getByRole("dialog", { name: zh.revoke, exact: true });
    const confirm = dialog.getByRole("button", { name: zh.confirmRevoke, exact: true });
    await failOnce(page, api);
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await stored()).toEqual(reconciled);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(draftCard.getByText(zh.statusRevoked, { exact: true })).toBeVisible();
    await expect(draftHeading).toBeFocused();
    await expect(draftCard.getByRole("form")).toHaveCount(0);
    expect((await context.request.post(draftActionPath, { headers, data: { ...actionBody, idempotencyKey: "after-revocation" } })).status()).toBe(409);
    expect((await context.request.post(api, { headers, data: { id: publishId, status: "revoked" } })).status()).toBe(200);
    const revoked = await stored();
    expect(revoked.actions).toEqual(reconciled.actions);
    expect(revoked.connections.map(({ status }) => status)).toEqual(["revoked", "revoked"]);

    for (const locale of locales) {
      const copy = messages[locale].externalConnections;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(refusedRow).toContainText(copy.reasonManual);
        await expect(unknownRow).toContainText(copy.statusReconciled);
        await checkLayout(page, main.getByRole("link", { name: copy.reviewHistory, exact: true }), width, `history-${locale}`);
      }

      await visit(page, locale, 375);
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(draftHeading).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      for (const hidden of [brandName, draftName, "Private external connections fixture failure"]) {
        await expect(main).not.toContainText(hidden);
      }
      const reload = main.getByRole("link", { name: copy.reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(refusedRow).toContainText(copy.reasonManual);
      expect(await stored()).toEqual(revoked);
    }

    const otherPage = await outsider.newPage();
    for (const locale of locales) {
      const copy = messages[locale].externalConnections;
      for (const width of widths) {
        const otherMain = await visit(otherPage, locale, width);
        await expect(otherMain.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(otherMain.getByRole("form")).toHaveCount(0);
        await expect(otherMain).not.toContainText(draftName);
        await checkLayout(otherPage, otherMain.getByRole("link", { name: copy.goBrands, exact: true }), width, `no-brand-${locale}`);
      }
    }
    await activate(otherPage, otherPage.getByRole("link", { name: en.externalConnections.goBrands, exact: true }));
    await expect(otherPage).toHaveURL(origin + "/dashboard/brands");
    for (const [endpoint, data] of [
      [api, publishInput],
      [api, { id: draftId, status: "revoked" }],
      [draftActionPath, actionBody],
      [retryPath, { remoteState: null, receiptKind: null, effectiveAt: null }],
    ] as const) {
      expect((await outsider.request.post(endpoint, { headers, data })).status()).toBe(404);
    }
    expect(await stored()).toEqual(revoked);
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
                 exists (select 1 from external_connection where owner_id = ${userId}) as connection,
                 exists (select 1 from external_action where owner_id = ${userId}) as action`;
        expect(remaining).toEqual({ account: false, brand: false, connection: false, action: false });
      }
      if (brandId) expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
