import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/commercial/entitlements";
const endpoint = "/api/commercial/entitlements";
const headers = { Origin: origin };
const probe = "geo-entitlements-read";
const shots = ".cache/issue-135/entitlements";
const brandName = `Fixture-${"entitlement".repeat(6)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
type Locale = typeof locales[number];
type Messages = typeof import("../../src/lib/i18n/messages/zh-CN.json");
const zh: Messages = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const en: Messages = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const messages = { "zh-CN": zh, en };

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Synthetic entitlement fixture", email, password: randomBytes(24).toString("base64url"),
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
  if (viaSettings) await activate(page, page.getByRole("link", { name: messages[locale].settings.openEntitlements, exact: true }));
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="entitlements"]')).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: messages[locale].entitlements.title })).toBeVisible();
}

async function checkLayout(page: Page, action: string, width: number, shot: string) {
  const link = page.getByRole("main").getByRole("link", { name: action, exact: true });
  await expect(link).toBeInViewport({ ratio: 1 });
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `${shots}/${shot}-${width}.png`, animations: "disabled" });
}

function cardTitle(locale: Locale, version: number, kind: "kindTrial" | "kindQuote" = "kindTrial") {
  const copy = messages[locale].entitlements;
  return copy.versionTitle.replace("{kind}", copy[kind]).replace("{version}", String(version));
}

async function expectStoredValue(card: Locator, label: string, value: number) {
  const row = card.locator("dl > div").filter({ has: card.page().getByText(label, { exact: true }) });
  await expect(row.locator("dd")).toHaveText(String(value));
}

async function writeWithKeyboard(page: Page, control: Locator, url: string, status = 200) {
  const result = page.waitForResponse((response) => response.url() === origin + url && response.request().method() === "POST");
  await activate(page, control);
  expect((await result).status()).toBe(status);
}

test("brand owners can register entitlements and keep usage on its original version", async ({ context, page, browser }) => {
  test.setTimeout(150_000);
  const database = process.env.DATABASE_URL;
  if (!database || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
    throw new Error("Entitlement browser tests require loopback PostgreSQL");
  }
  const sql = postgres(database, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const emails = [`entitlement-owner-${randomUUID()}@example.invalid`, `entitlement-outsider-${randomUUID()}@example.invalid`];
  const main = page.getByRole("main");
  const card = (locale: Locale, version: number, kind?: "kindQuote") => main.getByRole("article", { name: cardTitle(locale, version, kind), exact: true });
  let brandId: string | undefined;
  let entitlementIds: string[] = [];

  try {
    const ownerId = await register(context, emails[0]);
    const versions = () => sql`
      select id, brand_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at
      from service_entitlement where owner_id = ${ownerId} order by kind, version`;
    const usage = () => sql`
      select u.id, u.entitlement_id, u.kind, u.quantity
      from entitlement_usage u join service_entitlement e on e.id = u.entitlement_id
      where e.owner_id = ${ownerId} order by u.created_at, u.id`;

    for (const locale of locales) {
      const copy = messages[locale].entitlements;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.empty, { exact: true })).toBeVisible();
        await checkLayout(page, copy.openBrands, width, `no-brand-${locale}`);
      }
    }

    const brand = await context.request.post("/api/brands", { headers, data: {
      action: "submit", actorId: ownerId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName, description: "Synthetic package entitlement fixture.",
        website: "https://entitlement.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    } });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;

    for (const locale of locales) {
      const copy = messages[locale].entitlements;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form", { name: copy.registerTitle })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `ready-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const registration = main.getByRole("form", { name: zh.entitlements.registerTitle });
    await activate(page, main.getByRole("link", { name: zh.entitlements.startRegistration }));
    const brandField = registration.getByRole("combobox", { name: zh.entitlements.brand });
    await expect(brandField).toBeFocused();
    await expect(brandField).toHaveValue(brandId);
    await page.keyboard.press("Tab");
    await expect(registration.getByRole("combobox", { name: zh.entitlements.kind })).toBeFocused();
    await page.keyboard.press("Tab");
    const monitoring = registration.getByRole("textbox", { name: zh.entitlements.monitoringQuota });
    await expect(monitoring).toBeFocused();
    await monitoring.fill("-1");
    const registerButton = registration.getByRole("button", { name: zh.entitlements.registerEntitlement, exact: true });
    await writeWithKeyboard(page, registerButton, endpoint, 400);
    await expect(registration.getByRole("status")).toHaveText(zh.entitlements.INVALID_INPUT);
    expect(await versions()).toHaveLength(0);

    await monitoring.fill("1200");
    await registration.getByRole("textbox", { name: zh.entitlements.contentQuota }).fill("20");
    const release = Promise.withResolvers<void>();
    let writes = 0;
    const countWrite = (request: import("@playwright/test").Request) => {
      if (request.url() === origin + endpoint && request.method() === "POST") writes++;
    };
    page.on("request", countWrite);
    await page.route(`**${endpoint}`, async (route) => {
      await release.promise;
      await route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } });
    }, { times: 1 });
    try {
      await activate(page, registerButton);
      const saving = registration.getByRole("button", { name: zh.entitlements.saving });
      await expect(saving).toBeFocused();
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect.poll(() => writes).toBe(1);
    } finally {
      release.resolve();
    }
    await expect(registration.getByRole("status")).toHaveText(zh.entitlements.SERVICE_UNAVAILABLE);
    page.off("request", countWrite);
    expect(writes).toBe(1);
    await expect(registerButton).toBeFocused();
    expect(await versions()).toHaveLength(0);

    await page.getByRole("combobox", { name: zh.common.language, exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishRegistration = main.getByRole("form", { name: en.entitlements.registerTitle });
    await expect(englishRegistration.getByRole("status")).toHaveText(en.entitlements.SERVICE_UNAVAILABLE);
    await expect(englishRegistration.getByRole("textbox", { name: en.entitlements.monitoringQuota })).toHaveValue("1200");
    await writeWithKeyboard(page, englishRegistration.getByRole("button", { name: en.entitlements.registerEntitlement, exact: true }), endpoint);
    await expect(englishRegistration.getByRole("status")).toHaveText(en.entitlements.saved);
    await expect(englishRegistration.getByRole("textbox", { name: en.entitlements.monitoringQuota })).toHaveValue("0");

    const [first] = await versions();
    entitlementIds = [first.id];
    expect(first).toMatchObject({ brand_id: brandId, version: 1, kind: "trial", monitoring_quota: 1200, content_quota: 20, labor_quota: 0 });
    const original = card("en", 1);
    await expect(original).toBeVisible();
    await activate(page, original.locator("summary").filter({ hasText: en.entitlements.usageTitle }));
    const usageForm = original.getByRole("form", { name: en.entitlements.usageTitle });
    const quantity = usageForm.getByRole("textbox", { name: en.entitlements.usageQuantity });
    const usageButton = usageForm.getByRole("button", { name: en.entitlements.recordUsage, exact: true });
    const usageUrl = `${endpoint}/${first.id}/usage`;
    await quantity.fill("0");
    await writeWithKeyboard(page, usageButton, usageUrl, 400);
    await expect(usageForm.getByRole("status")).toHaveText(en.entitlements.invalidUsage);
    expect(await usage()).toHaveLength(0);

    await quantity.fill("3");
    await page.route(`**${usageUrl}`, (route) => route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } }), { times: 1 });
    await writeWithKeyboard(page, usageButton, usageUrl, 503);
    await expect(usageForm.getByRole("status")).toHaveText(en.entitlements.SERVICE_UNAVAILABLE);
    await expect(usageButton).toBeFocused();
    await expect(quantity).toHaveValue("3");
    expect(await usage()).toHaveLength(0);

    await writeWithKeyboard(page, usageButton, usageUrl);
    await expect(usageForm.getByRole("status")).toHaveText(en.entitlements.usageSaved);
    await expectStoredValue(original, en.entitlements.usageMonitoring, 3);
    const persistedUsage = await usage();
    expect(persistedUsage).toMatchObject([{ entitlement_id: first.id, kind: "monitoring", quantity: 3 }]);

    await activate(page, original.locator("summary").filter({ hasText: en.entitlements.reviseTitle }));
    const revisionForm = original.getByRole("form", { name: en.entitlements.reviseTitle });
    await revisionForm.getByRole("textbox", { name: en.entitlements.monitoringQuota }).fill("1100");
    await writeWithKeyboard(page, revisionForm.getByRole("button", { name: en.entitlements.reviseEntitlement }), `${endpoint}/${first.id}/revise`);
    await expect(revisionForm.getByRole("status")).toHaveText(en.entitlements.revised);
    const [, revised] = await versions();
    entitlementIds.push(revised.id);
    expect(revised).toMatchObject({ brand_id: brandId, version: 2, kind: "trial", monitoring_quota: 1100 });
    expect(revised.id).not.toBe(first.id);

    await englishRegistration.getByRole("combobox", { name: en.entitlements.kind }).selectOption("quote");
    await englishRegistration.getByRole("textbox", { name: en.entitlements.contentQuota }).fill("30");
    await writeWithKeyboard(page, englishRegistration.getByRole("button", { name: en.entitlements.registerEntitlement, exact: true }), endpoint);
    const saved = await versions();
    const [quote] = saved;
    entitlementIds.push(quote.id);
    expect(saved).toHaveLength(3);
    expect(saved[1]).toEqual(first);
    expect(quote).toMatchObject({ brand_id: brandId, kind: "quote", version: 1, content_quota: 30 });
    expect(await usage()).toEqual(persistedUsage);

    const registrationData = { brandId, kind: "trial", monitoringQuota: 1, contentQuota: 0, laborQuota: 0 };
    expect((await context.request.post(endpoint, { headers, data: { ...registrationData, paid: true } })).status()).toBe(400);
    const before = await context.request.get(`${endpoint}?id=${first.id}`, { headers });
    expect(before.status()).toBe(200);
    expect((await before.json()).entitlement.usageTotals).toEqual({ monitoring: 3, content: 0, labor: 0 });

    await register(outsider, emails[1]);
    expect((await outsider.request.get(`${endpoint}?id=${first.id}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(endpoint, { headers, data: registrationData })).status()).toBe(404);
    expect((await outsider.request.post(`${endpoint}/${first.id}/revise`, {
      headers, data: { kind: "trial", monitoringQuota: 1, contentQuota: 0, laborQuota: 0 },
    })).status()).toBe(404);
    expect((await outsider.request.post(usageUrl, { headers, data: { kind: "monitoring", quantity: 1 } })).status()).toBe(404);
    const outsiderPage = await outsider.newPage();
    await visit(outsiderPage, "en", 375);
    await expect(outsiderPage.getByRole("main").getByRole("article")).toHaveCount(0);

    for (const locale of locales) {
      const copy = messages[locale].entitlements;
      for (const width of widths) {
        await visit(page, locale, width);
        await checkLayout(page, copy.viewVersions, width, `versions-${locale}`);
        await activate(page, main.getByRole("link", { name: copy.viewVersions }));
        await expect(main.getByRole("heading", { name: copy.myEntitlements })).toBeFocused();
        const trial = card(locale, 1);
        const trialRevision = card(locale, 2);
        const quoteCard = card(locale, 1, "kindQuote");
        await expect(trial.getByText(brandName, { exact: true })).toBeVisible();
        await expect(trial.locator("time")).toHaveAttribute("datetime", first.created_at);
        await expect(trial.locator("time")).toContainText("UTC");
        await expectStoredValue(trial, copy.monitoringQuota, 1200);
        await expectStoredValue(trial, copy.usageMonitoring, 3);
        await expectStoredValue(trialRevision, copy.monitoringQuota, 1100);
        await expectStoredValue(trialRevision, copy.usageMonitoring, 0);
        await expectStoredValue(quoteCard, copy.contentQuota, 30);
        for (const item of [trial, trialRevision, quoteCard]) {
          await expect(item.getByText(copy.uncollected, { exact: true })).toBeVisible();
          expect(await item.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        if (width === 375) await trial.screenshot({ path: `${shots}/version-${locale}-375.png` });
      }

      await visit(page, locale, 375);
      await context.addCookies([{ name: probe, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(card(locale, 1)).toBeVisible();
      await context.addCookies([{ name: probe, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("article")).toHaveCount(0);
      await expect(main).not.toContainText("Private entitlements fixture failure");
      await checkLayout(page, copy.reload, 375, `read-failure-${locale}`);
      await context.clearCookies({ name: probe });
      await activate(page, main.getByRole("link", { name: copy.reload }));
      await expect(card(locale, 1)).toBeVisible();
    }

    const archive = await context.request.post("/api/brands", { headers, data: {
      action: "archive", actorId: ownerId, operationId: randomUUID(), brandId, expectedBrandRevision: 1,
    } });
    expect(archive.status()).toBe(200);
    expect((await context.request.post(endpoint, { headers, data: registrationData })).status()).toBe(404);
    for (const locale of locales) {
      const copy = messages[locale].entitlements;
      await visit(page, locale, 375);
      await expect(main.getByRole("form", { name: copy.registerTitle })).toHaveCount(0);
      await expect(card(locale, 1).getByText(brandId, { exact: true })).toBeVisible();
      await checkLayout(page, copy.viewVersions, 375, `archived-${locale}`);
    }
    expect(await versions()).toEqual(saved);
    expect(await usage()).toEqual(persistedUsage);
  } finally {
    try {
      await outsider.close();
      for (const email of emails) {
        const [deleted] = await sql`delete from "user" where email = ${email} returning id`;
        expect(await sql`select 1 from "user" where email = ${email}`).toHaveLength(0);
        if (deleted) expect(await sql`select 1 from brand where owner_id = ${deleted.id}`).toHaveLength(0);
      }
      if (brandId) {
        expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select 1 from service_entitlement where brand_id = ${brandId}`).toHaveLength(0);
      }
      if (entitlementIds.length) {
        expect(await sql`select 1 from entitlement_usage where entitlement_id in ${sql(entitlementIds)}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
