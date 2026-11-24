import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/settings/notifications";
const api = "/api/settings/notifications";
const headers = { Origin: origin };
const shots = ".cache/issue-135/notification-endpoints";
const probeCookie = "geo-notification-endpoints-read";
const brandName = `Fixture-${"brand".repeat(14)}`;
const endpointName = `Fixture-${"desk".repeat(17)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];

const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const zhCN: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const messages = { "zh-CN": zhCN, en };
const zh = zhCN.notificationEndpoints;

async function register(context: BrowserContext) {
  const email = `notification-endpoints-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Notification endpoint visual test", email, password: randomBytes(24).toString("base64url"),
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
    await activate(page, page.getByRole("link", { name: messages[locale].settings.openNotificationEndpoints, exact: true }));
  }
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  const title = messages[locale].notificationEndpoints.title;
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

function simulateUnavailable(page: Page, apiPath: string) {
  return page.route(`**${apiPath}`, (route) => route.fulfill({
    status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
  }), { times: 1 });
}

function hash(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

test("notification endpoints have a keyboard workflow and keep local delivery history after revoking", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Notification endpoint browser tests require a loopback PostgreSQL database");
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
          name: brandName, description: "Synthetic brand for notification endpoints.",
          website: "https://notifications.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const createdBrand: string = (await brand.json()).id;
    expect(createdBrand).toMatch(/^[0-9a-f-]{36}$/);
    brandId = createdBrand;
    const readStored = async () => ({
      endpoints: await sql`select id, brand_id, label, status, updated_at from notification_endpoint where owner_id = ${owner.userId}`,
      deliveries: await sql`
        select id, endpoint_id, sent, body_has_customer_text, body_hash, created_at
        from notification_delivery where owner_id = ${owner.userId} order by created_at, id`,
    });
    const main = page.getByRole("main");
    const card = main.getByRole("article", { name: endpointName, exact: true });
    const heading = card.getByRole("heading", { name: endpointName, exact: true });

    for (const locale of locales) {
      const copy = messages[locale].notificationEndpoints;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByText(copy.emptyEndpoints, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.fixtureNote, { exact: true })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: copy.startRegistration, exact: true }), width, `empty-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.register, exact: true });
    const brandField = form.getByRole("combobox", { name: zh.brand, exact: true });
    await activate(page, main.getByRole("link", { name: zh.startRegistration, exact: true }));
    await expect(brandField).toBeFocused();
    await expect(brandField).toHaveValue(createdBrand);
    await page.keyboard.press("Tab");
    const label = form.getByRole("textbox", { name: zh.label, exact: true });
    await expect(label).toBeFocused();
    await label.fill(endpointName);
    await page.keyboard.press("Tab");
    const registerButton = form.getByRole("button", { name: zh.register, exact: true });
    await expect(registerButton).toBeFocused();
    await simulateUnavailable(page, api);
    await page.keyboard.press("Enter");
    await expect(form.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(registerButton).toBeFocused();
    await expect(label).toHaveValue(endpointName);
    expect(await readStored()).toEqual({ endpoints: [], deliveries: [] });

    await page.getByRole("combobox", { name: zhCN.common.language, exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishForm = main.getByRole("form", { name: en.notificationEndpoints.register, exact: true });
    await expect(englishForm.getByRole("status")).toHaveText(en.notificationEndpoints.SERVICE_UNAVAILABLE);
    await expect(englishForm.getByRole("textbox", { name: en.notificationEndpoints.label, exact: true })).toHaveValue(endpointName);
    await page.getByRole("combobox", { name: en.common.language, exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    const registration = nextResponse(page, api);
    await activate(page, registerButton);
    expect((await registration).status()).toBe(200);
    await expect(form.getByRole("status")).toHaveText(zh.saved);
    await expect(label).toHaveValue("");
    await expect(heading).toBeVisible();
    const saved = await readStored();
    expect(saved.endpoints).toMatchObject([{ brand_id: brandId, label: endpointName, status: "verified" }]);
    const { id } = saved.endpoints[0];
    const deliveriesPath = `${api}/${id}/deliveries`;
    const revokePath = `${api}/${id}/revoke`;

    async function checkRecord(revoked: boolean) {
      for (const locale of locales) {
        const copy = messages[locale].notificationEndpoints;
        for (const width of widths) {
          await visit(page, locale, width);
          await expect(card.getByText(copy[revoked ? "statusRevoked" : "statusVerified"], { exact: true })).toBeVisible();
          const action = main.getByRole("link", { name: copy[revoked ? "reviewHistory" : "reviewEndpoint"], exact: true });
          await checkLayout(page, action, width, `${revoked ? "revoked" : "active"}-${locale}`);
          if (width === 375) {
            await activate(page, action);
            await expect(heading).toBeFocused();
            await expect(heading).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await page.screenshot({ path: `${shots}/${revoked ? "history" : "record"}-${locale}-375.png` });
          }
        }
      }
    }

    await checkRecord(false);
    await visit(page, "zh-CN", 375);
    const bodyField = card.getByRole("textbox", { name: zh.body, exact: true });
    const send = card.getByRole("button", { name: zh.requestDelivery, exact: true });
    async function checkReminder(body: string, result: string) {
      await bodyField.fill(body);
      await page.keyboard.press("Tab");
      await expect(send).toBeFocused();
      const response = nextResponse(page, deliveriesPath);
      await page.keyboard.press("Enter");
      expect((await response).status()).toBe(200);
      await expect(card.getByRole("status")).toHaveText(result);
      await expect(bodyField).toHaveValue("");
      await expect(card.getByText(hash(body), { exact: true })).toBeVisible();
      await expect(card).not.toContainText(body);
    }

    const firstBody = "Synthetic weekly test reminder";
    const privateBody = "客户原文 synthetic visual test";
    await checkReminder(firstBody, zh.sent);
    await checkReminder(privateBody, zh.notSent);
    const before = await readStored();
    expect(before.deliveries).toMatchObject([
      { endpoint_id: id, sent: 1, body_has_customer_text: 0, body_hash: hash(firstBody) },
      { endpoint_id: id, sent: 0, body_has_customer_text: 1, body_hash: hash(privateBody) },
    ]);

    for (const locale of locales) {
      const copy = messages[locale].notificationEndpoints;
      await visit(page, locale, 375);
      const revoke = card.getByRole("button", { name: copy.revoke, exact: true });
      await activate(page, revoke);
      const dialog = page.getByRole("dialog", { name: copy.revoke, exact: true });
      await expect(dialog).toHaveAccessibleDescription(copy.confirmDescription.replace("{endpoint}", endpointName));
      await expect(dialog.getByRole("button", { name: copy.cancel, exact: true })).toBeFocused();
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/confirm-${locale}-375.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(revoke).toBeFocused();
      expect(await readStored()).toEqual(before);
    }

    await visit(page, "zh-CN", 375);
    await activate(page, card.getByRole("button", { name: zh.revoke, exact: true }));
    const dialog = page.getByRole("dialog", { name: zh.revoke, exact: true });
    await expect(dialog.getByRole("button", { name: zh.cancel, exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    const confirm = dialog.getByRole("button", { name: zh.confirmRevoke, exact: true });
    await expect(confirm).toBeFocused();
    await simulateUnavailable(page, revokePath);
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await readStored()).toEqual(before);
    const revocation = nextResponse(page, revokePath);
    await page.keyboard.press("Enter");
    expect((await revocation).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(heading).toBeFocused();
    await expect(card.getByText(zh.statusRevoked, { exact: true })).toBeVisible();
    await expect(card.getByRole("status")).toHaveText(zh.revokedSaved);
    await expect(card.getByRole("button", { name: zh.revoke, exact: true })).toHaveCount(0);
    const afterRevoke = await readStored();
    expect(afterRevoke.endpoints).toMatchObject([{ id, status: "revoked" }]);
    expect(afterRevoke.deliveries).toEqual(before.deliveries);

    await page.keyboard.press("Tab");
    await expect(bodyField).toBeFocused();
    const revokedBody = "Synthetic reminder after revocation";
    await checkReminder(revokedBody, zh.notSent);
    const stored = await readStored();
    expect(stored.deliveries).toEqual([
      ...before.deliveries, expect.objectContaining({ endpoint_id: id, sent: 0, body_has_customer_text: 0, body_hash: hash(revokedBody) }),
    ]);
    expect((await context.request.post(revokePath, { headers, data: {} })).status()).toBe(200);
    expect(await readStored()).toEqual(stored);
    await checkRecord(true);

    for (const locale of locales) {
      const copy = messages[locale].notificationEndpoints;
      await visit(page, locale, 375);
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(heading).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("region", { name: copy.recordsTitle })).toHaveCount(0);
      for (const hidden of [brandName, endpointName, "Private notification endpoints fixture failure"]) {
        await expect(main).not.toContainText(hidden);
      }
      const reload = main.getByRole("link", { name: copy.reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(heading).toBeVisible();
      await expect(card.getByText(hash(firstBody), { exact: true })).toBeVisible();
      expect(await readStored()).toEqual(stored);
    }

    const otherPage = await outsider.newPage();
    for (const locale of locales) {
      const copy = messages[locale].notificationEndpoints;
      for (const width of widths) {
        const otherMain = await visit(otherPage, locale, width);
        await expect(otherMain.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(otherMain.getByRole("form")).toHaveCount(0);
        await expect(otherMain).not.toContainText(endpointName);
        await checkLayout(otherPage, otherMain.getByRole("link", { name: copy.goBrands, exact: true }), width, `no-brand-${locale}`);
      }
    }
    await activate(otherPage, otherPage.getByRole("link", { name: en.notificationEndpoints.goBrands, exact: true }));
    await expect(otherPage).toHaveURL(`${origin}/dashboard/brands`);
    expect((await outsider.request.post(api, { headers, data: { brandId, label: endpointName } })).status()).toBe(404);
    expect((await outsider.request.get(`${api}/${id}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(revokePath, { headers, data: {} })).status()).toBe(404);
    expect((await outsider.request.post(deliveriesPath, { headers, data: { body: "Denied fixture" } })).status()).toBe(404);
    expect(await readStored()).toEqual(stored);
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
                 exists (select 1 from notification_endpoint where owner_id = ${userId}) as endpoint,
                 exists (select 1 from notification_delivery where owner_id = ${userId}) as delivery`;
        expect(remaining).toEqual({ account: false, brand: false, endpoint: false, delivery: false });
      }
      if (brandId) expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
