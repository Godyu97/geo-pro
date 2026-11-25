import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/commercial/orders";
const endpoint = "/api/commercial/orders";
const shots = ".cache/issue-135/orders";
const readProbe = "geo-orders-read";
const headers = { Origin: origin };
const brandName = `Fixture-${"order".repeat(13)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const zh: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const messages = { "zh-CN": zh, en };

type Locale = typeof locales[number];

async function register(context: BrowserContext) {
  const email = `quote-order-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Quote order fixture", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function addBrand(context: BrowserContext, userId: string) {
  const response = await context.request.post("/api/brands", {
    headers,
    data: {
      action: "submit", actorId: userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName, description: "Synthetic brand for quote order testing.",
        website: "https://quote-order.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
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
  if (viaSettings) {
    await activate(page, page.getByRole("link", { name: messages[locale].settings.openServiceOrders, exact: true }));
  }
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="orders"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: messages[locale].orders.title, exact: true })).toBeVisible();
}

async function checkLayout(page: Page, actionName: string, width: number, shot: string) {
  const action = page.getByRole("main").getByRole("link", { name: actionName, exact: true });
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `${shots}/${shot}-${width}.png`, animations: "disabled" });
}

test("brand owners can register and review unpaid quote orders from account settings", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Quote order browser tests require a loopback PostgreSQL database");
  }
  const sql = postgres(url, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  let createdBrandId: string | undefined;
  const main = page.getByRole("main");

  try {
    const owner = await register(context);
    accounts.push(owner);
    const stored = () => sql`
      select id, brand_id, quoted, status, paid, amount, currency, created_at
      from service_order where owner_id = ${owner.userId} order by created_at, id`;

    for (const locale of locales) {
      const copy = messages[locale].orders;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.empty, { exact: true })).toBeVisible();
        await checkLayout(page, copy.openBrands, width, `no-brands-${locale}`);
      }
    }

    const brandId = await addBrand(context, owner.userId);
    createdBrandId = brandId;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    const quote = { brandId, quoted: true, amount: 1200, currency: "CNY" };
    for (const locale of locales) {
      const copy = messages[locale].orders;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form", { name: copy.orderTitle, exact: true })).toBeVisible();
        await expect(main.getByText(copy.empty, { exact: true })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `ready-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const zhForm = main.getByRole("form", { name: zh.orders.orderTitle, exact: true });
    const zhBrand = zhForm.getByRole("combobox", { name: zh.orders.brand, exact: true });
    const zhQuoted = zhForm.getByRole("checkbox", { name: zh.orders.quoted, exact: true });
    const zhAmount = zhForm.getByRole("textbox", { name: zh.orders.amount, exact: true });
    const zhCurrency = zhForm.getByRole("textbox", { name: zh.orders.currency, exact: true });
    const zhSubmit = zhForm.getByRole("button", { name: zh.orders.registerOrder, exact: true });
    await activate(page, main.getByRole("link", { name: zh.orders.startRegistration, exact: true }));
    await expect(zhBrand).toBeFocused();
    await expect(zhBrand).toHaveValue(brandId);
    await page.keyboard.press("Tab");
    await expect(zhQuoted).toBeFocused();
    await page.keyboard.press("Space");
    await expect(zhQuoted).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(zhAmount).toBeFocused();
    await page.keyboard.insertText("-1");
    await page.keyboard.press("Tab");
    await expect(zhCurrency).toBeFocused();
    await page.keyboard.insertText("cny");
    await page.keyboard.press("Tab");
    await expect(zhSubmit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(zhForm.getByRole("status")).toHaveText(zh.orders.INVALID_INPUT);
    expect(await stored()).toHaveLength(0);

    await zhAmount.fill("1200");
    const failure = Promise.withResolvers<void>();
    let requests = 0;
    const recordPost = (request: import("@playwright/test").Request) => {
      if (request.url() === origin + endpoint && request.method() === "POST") requests++;
    };
    page.on("request", recordPost);
    await page.route(`**${endpoint}`, async (route) => {
      await failure.promise;
      await route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } });
    }, { times: 1 });
    try {
      await activate(page, zhSubmit);
      const saving = zhForm.getByRole("button", { name: zh.orders.saving, exact: true });
      await expect(saving).toBeFocused();
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect.poll(() => requests).toBe(1);
    } finally {
      failure.resolve();
    }
    await expect(zhForm.getByRole("status")).toHaveText(zh.orders.SERVICE_UNAVAILABLE);
    page.off("request", recordPost);
    expect(requests).toBe(1);
    await expect(zhSubmit).toBeFocused();
    expect(await stored()).toHaveLength(0);

    await page.getByRole("combobox", { name: zh.common.language, exact: true }).selectOption("en");
    const enForm = main.getByRole("form", { name: en.orders.orderTitle, exact: true });
    const enBrand = enForm.getByRole("combobox", { name: en.orders.brand, exact: true });
    const enQuoted = enForm.getByRole("checkbox", { name: en.orders.quoted, exact: true });
    const enAmount = enForm.getByRole("textbox", { name: en.orders.amount, exact: true });
    const enCurrency = enForm.getByRole("textbox", { name: en.orders.currency, exact: true });
    const enSubmit = enForm.getByRole("button", { name: en.orders.registerOrder, exact: true });
    await expect(enForm.getByRole("status")).toHaveText(en.orders.SERVICE_UNAVAILABLE);
    await expect(enBrand).toHaveValue(brandId);
    await expect(enQuoted).toBeChecked();
    await expect(enAmount).toHaveValue("1200");
    await expect(enCurrency).toHaveValue("cny");
    await activate(page, enSubmit);
    await expect(enForm.getByRole("status")).toHaveText(en.orders.saved);
    await expect(enSubmit).toBeFocused();
    await expect(enAmount).toHaveValue("");
    await expect(enCurrency).toHaveValue("");
    await expect(enQuoted).not.toBeChecked();

    const ordersLink = main.getByRole("link", { name: en.orders.viewOrders, exact: true });
    await activate(page, ordersLink);
    await expect(main.getByRole("heading", { name: en.orders.myOrders, exact: true })).toBeFocused();
    const orders = main.getByRole("region", { name: en.orders.myOrders, exact: true });
    await expect(orders.getByText(en.orders.statusAwaitingPayment, { exact: true })).toBeVisible();
    const [registeredQuote] = await stored();
    expect(registeredQuote).toMatchObject({ brand_id: brandId, quoted: 1, status: "awaiting_payment", paid: 0, amount: 1200, currency: "CNY" });

    await enAmount.fill("50");
    await enCurrency.fill("USD");
    await activate(page, enSubmit);
    await expect(enForm.getByRole("status")).toHaveText(en.orders.saved);
    await expect(orders.getByText(en.orders.statusDraft, { exact: true })).toBeVisible();
    const saved = await stored();
    expect(saved).toMatchObject([
      { id: registeredQuote.id, brand_id: brandId, quoted: 1, status: "awaiting_payment", paid: 0, amount: 1200, currency: "CNY" },
      { brand_id: brandId, quoted: 0, status: "draft", paid: 0, amount: 50, currency: "USD" },
    ]);

    const own = await context.request.get(`${endpoint}?id=${registeredQuote.id}`, { headers });
    expect(own.status()).toBe(200);
    expect((await own.json()).order).toMatchObject({ ...quote, quoted: 1, status: "awaiting_payment", paid: 0 });
    const paymentClaim = await context.request.post(endpoint, { headers, data: { ...quote, paid: 1 } });
    expect(paymentClaim.status()).toBe(400);
    accounts.push(await register(outsider));
    const foreignRead = await outsider.request.get(`${endpoint}?id=${registeredQuote.id}`, { headers });
    const foreignWrite = await outsider.request.post(endpoint, { headers, data: quote });
    expect(foreignRead.status()).toBe(404);
    expect(foreignWrite.status()).toBe(404);
    const foreignList = await outsider.request.get(endpoint, { headers });
    expect(foreignList.status()).toBe(200);
    expect(await foreignList.json()).toEqual({ orders: [] });

    for (const locale of locales) {
      const copy = messages[locale].orders;
      for (const width of widths) {
        await visit(page, locale, width);
        const list = main.getByRole("region", { name: copy.myOrders, exact: true });
        for (const [index, amount, status] of [[0, "1200 CNY", copy.statusAwaitingPayment], [1, "50 USD", copy.statusDraft]] as const) {
          const card = list.getByRole("listitem").filter({ hasText: amount });
          await expect(card.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
          await expect(card.getByText(status, { exact: true })).toBeVisible();
          await expect(card.locator("time")).toHaveAttribute("datetime", saved[index].created_at);
          await expect(card.locator("time")).toContainText("UTC");
          expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        await checkLayout(page, copy.startRegistration, width, `registered-${locale}`);
        if (width === 375) {
          await activate(page, main.getByRole("link", { name: copy.viewOrders, exact: true }));
          await expect(main.getByRole("heading", { name: copy.myOrders, exact: true })).toBeFocused();
          await list.screenshot({ path: `${shots}/order-list-${locale}-375.png`, animations: "disabled" });
        }
      }

      await visit(page, locale, 375);
      await context.addCookies([{ name: readProbe, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png`, animations: "disabled" });
      await expect(main.getByText("1200 CNY", { exact: true })).toBeVisible();
      await context.addCookies([{ name: readProbe, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      for (const text of [brandName, "1200 CNY", "Private quote orders fixture failure"]) await expect(main).not.toContainText(text);
      await checkLayout(page, copy.reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: readProbe });
      await activate(page, main.getByRole("link", { name: copy.reload, exact: true }));
      await expect(main.getByText("1200 CNY", { exact: true })).toBeVisible();
    }

    const archived = await context.request.post("/api/brands", {
      headers,
      data: { action: "archive", actorId: owner.userId, operationId: randomUUID(), brandId, expectedBrandRevision: 1 },
    });
    expect(archived.status()).toBe(200);
    expect((await context.request.post(endpoint, { headers, data: quote })).status()).toBe(404);
    for (const locale of locales) {
      const copy = messages[locale].orders;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await checkLayout(page, copy.viewOrders, width, `archived-${locale}`);
        await activate(page, main.getByRole("link", { name: copy.viewOrders, exact: true }));
        await expect(main.getByRole("heading", { name: copy.myOrders, exact: true })).toBeFocused();
        await expect(main.getByRole("heading", { name: brandId, exact: true })).toHaveCount(2);
      }
    }
    expect(await stored()).toEqual(saved);
  } finally {
    await outsider.close();
    try {
      for (const { userId, email } of accounts) {
        await sql`delete from "user" where id = ${userId} and email = ${email}`;
        const [remaining] = await sql`
          select exists (select 1 from "user" where id = ${userId}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from service_order where owner_id = ${userId}) as service_order`;
        expect(remaining).toEqual({ account: false, brand: false, service_order: false });
      }
      if (createdBrandId) expect(await sql`select 1 from brand_version where brand_id = ${createdBrandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
