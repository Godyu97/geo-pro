import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/commercial/deliveries";
const endpoint = "/api/commercial/deliveries";
const headers = { Origin: origin };
const readProbe = "geo-deliveries-read";
const shots = ".cache/issue-135/delivery-acceptance";
const brandName = `Fixture-${"brand".repeat(12)}`;
const acceptedTitle = `交付-${"deliverable".repeat(9)}`;
const disputedTitle = "合成交付：来源核对";
const reason = `范围不符\n${"evidence".repeat(32)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const zh: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const messages = { "zh-CN": zh, en };

type Locale = typeof locales[number];

async function register(context: BrowserContext) {
  const email = `delivery-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Synthetic delivery fixture", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { id: (await response.json()).user.id as string, email };
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
    await activate(page, page.getByRole("link", { name: messages[locale].settings.openDeliveries, exact: true }));
  }
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="deliveries"]')).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: messages[locale].deliveries.title })).toBeVisible();
}

async function checkLayout(page: Page, action: string, width: number, shot: string) {
  const link = page.getByRole("main").getByRole("link", { name: action, exact: true });
  await expect(link).toBeInViewport({ ratio: 1 });
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `${shots}/${shot}-${width}.png`, animations: "disabled" });
}

async function failNextWrite(page: Page, url: string) {
  await page.route(`**${url}`, (route) => route.fulfill({
    status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
  }), { times: 1 });
}

test("brand owners can register, accept and dispute their own deliveries", async ({ context, page, browser }) => {
  test.setTimeout(150_000);
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Delivery acceptance tests require loopback PostgreSQL");
  }
  const sql = postgres(url, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  let brandId: string | undefined;
  const main = page.getByRole("main");
  const card = (title: string) => main.getByRole("article", { name: title, exact: true });

  try {
    const owner = await register(context);
    accounts.push(owner);
    const rows = () => sql`
      select id, brand_id, title, status, dispute_reason, created_at
      from brand_delivery where owner_id = ${owner.id} order by created_at, id`;

    for (const locale of locales) {
      const copy = messages[locale].deliveries;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.empty, { exact: true })).toBeVisible();
        await checkLayout(page, copy.openBrands, width, `no-brand-${locale}`);
      }
    }

    const brand = await context.request.post("/api/brands", { headers, data: {
      action: "submit", actorId: owner.id, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName, description: "Synthetic delivery acceptance fixture.",
        website: "https://delivery.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    } });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;

    for (const locale of locales) {
      const copy = messages[locale].deliveries;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(main.getByRole("form", { name: copy.registerTitle })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `ready-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const zhForm = main.getByRole("form", { name: zh.deliveries.registerTitle });
    const field = zhForm.getByRole("combobox", { name: zh.deliveries.brand });
    const title = zhForm.getByRole("textbox", { name: zh.deliveries.deliveryTitle });
    const submit = zhForm.getByRole("button", { name: zh.deliveries.registerDelivery });
    await activate(page, main.getByRole("link", { name: zh.deliveries.startRegistration }));
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(brandId);
    await page.keyboard.press("Tab");
    await expect(title).toBeFocused();
    await page.keyboard.insertText(" ");
    await page.keyboard.press("Enter");
    await expect(zhForm.getByRole("status")).toHaveText(zh.deliveries.INVALID_INPUT);
    expect(await rows()).toHaveLength(0);

    await title.fill(acceptedTitle);
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
      await activate(page, submit);
      const saving = zhForm.getByRole("button", { name: zh.deliveries.saving });
      await expect(saving).toBeFocused();
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect.poll(() => writes).toBe(1);
    } finally {
      release.resolve();
    }
    await expect(zhForm.getByRole("status")).toHaveText(zh.deliveries.SERVICE_UNAVAILABLE);
    page.off("request", countWrite);
    expect(writes).toBe(1);
    await expect(submit).toBeFocused();
    expect(await rows()).toHaveLength(0);

    await page.getByRole("combobox", { name: zh.common.language, exact: true }).selectOption("en");
    const enForm = main.getByRole("form", { name: en.deliveries.registerTitle });
    const enTitle = enForm.getByRole("textbox", { name: en.deliveries.deliveryTitle });
    await expect(enForm.getByRole("status")).toHaveText(en.deliveries.SERVICE_UNAVAILABLE);
    await expect(enTitle).toHaveValue(acceptedTitle);
    await activate(page, enForm.getByRole("button", { name: en.deliveries.registerDelivery }));
    await expect(enForm.getByRole("status")).toHaveText(en.deliveries.saved);
    await expect(enTitle).toHaveValue("");
    await expect(card(acceptedTitle).getByText(en.deliveries.statusPending, { exact: true })).toBeVisible();

    const [pending] = await rows();
    expect(pending).toMatchObject({ title: acceptedTitle, brand_id: brandId, status: "pending", dispute_reason: null });

    for (const locale of locales) {
      const copy = messages[locale].deliveries;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(card(acceptedTitle).getByText(copy.statusPending, { exact: true })).toBeVisible();
        await checkLayout(page, copy.reviewPending, width, `pending-${locale}`);
        await activate(page, main.getByRole("link", { name: copy.reviewPending }));
        await expect(card(acceptedTitle).getByRole("heading")).toBeFocused();
        if (width === 375) {
          const trigger = card(acceptedTitle).getByRole("button", { name: copy.accept, exact: true });
          await page.keyboard.press("Tab");
          await expect(trigger).toBeFocused();
          await page.keyboard.press("Enter");
          const dialog = page.getByRole("dialog", { name: copy.confirmAcceptance });
          await expect(dialog.getByRole("button", { name: copy.cancel })).toBeFocused();
          await expect(dialog.getByText(copy.acceptanceImpact)).toBeVisible();
          await dialog.screenshot({ path: `${shots}/confirmation-${locale}.png` });
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await expect(trigger).toBeFocused();
          expect(await rows()).toEqual([pending]);
        }
      }
    }

    await visit(page, "zh-CN", 375);
    const firstCard = card(acceptedTitle);
    await activate(page, firstCard.getByRole("button", { name: zh.deliveries.accept, exact: true }));
    const dialog = page.getByRole("dialog", { name: zh.deliveries.confirmAcceptance });
    const confirm = dialog.getByRole("button", { name: zh.deliveries.confirmAcceptance });
    await failNextWrite(page, `${endpoint}/${pending.id}/accept`);
    await activate(page, confirm);
    await expect(dialog.getByRole("status")).toHaveText(zh.deliveries.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await rows()).toEqual([pending]);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(firstCard.getByRole("heading")).toBeFocused();
    await expect(firstCard.getByText(zh.deliveries.statusAccepted, { exact: true })).toBeVisible();
    await expect(firstCard.getByText(zh.deliveries.acceptanceNote)).toBeVisible();
    expect(await rows()).toEqual([{ ...pending, status: "accepted" }]);

    const second = await context.request.post(endpoint, { headers, data: { brandId, title: disputedTitle } });
    expect(second.status()).toBe(200);
    const disputeId = (await second.json()).delivery.id;
    await visit(page, "en", 375);
    const secondCard = card(disputedTitle);
    const reasonInput = secondCard.getByRole("textbox", { name: en.deliveries.disputeReason });
    const disputeButton = secondCard.getByRole("button", { name: en.deliveries.dispute });
    await activate(page, main.getByRole("link", { name: en.deliveries.reviewPending }));
    await expect(secondCard.getByRole("heading")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(reasonInput).toBeFocused();
    await page.keyboard.insertText(reason);
    await page.keyboard.press("Tab");
    await expect(disputeButton).toBeFocused();
    await failNextWrite(page, `${endpoint}/${disputeId}/dispute`);
    await page.keyboard.press("Enter");
    await expect(secondCard.getByRole("status")).toHaveText(en.deliveries.SERVICE_UNAVAILABLE);
    await expect(disputeButton).toBeFocused();
    await expect(reasonInput).toHaveValue(reason);
    expect((await rows()).find((row) => row.id === disputeId)).toMatchObject({ status: "pending", dispute_reason: null });
    await page.keyboard.press("Enter");
    await expect(secondCard.getByRole("heading")).toBeFocused();
    await expect(secondCard.getByText(en.deliveries.statusDisputed, { exact: true })).toBeVisible();
    await expect(secondCard.getByRole("button")).toHaveCount(0);

    const saved = await rows();
    const disputed = saved.find((row) => row.id === disputeId);
    expect(disputed).toMatchObject({ title: disputedTitle, brand_id: brandId, status: "disputed", dispute_reason: reason });
    for (const id of [pending.id, disputeId]) {
      expect((await context.request.post(`${endpoint}/${id}/accept`, { headers, data: {} })).status()).toBe(409);
      expect((await context.request.post(`${endpoint}/${id}/dispute`, { headers, data: { reason: "Replacement reason" } })).status()).toBe(409);
    }
    expect((await context.request.post(endpoint, { headers, data: { brandId, title: "Invalid", paid: true } })).status()).toBe(400);

    accounts.push(await register(outsider));
    expect((await outsider.request.post(endpoint, { headers, data: { brandId, title: "Foreign" } })).status()).toBe(404);
    expect((await outsider.request.post(`${endpoint}/${pending.id}/accept`, { headers, data: {} })).status()).toBe(404);
    expect((await outsider.request.post(`${endpoint}/${disputeId}/dispute`, { headers, data: { reason } })).status()).toBe(404);
    const outsiderPage = await outsider.newPage();
    await visit(outsiderPage, "en", 375);
    await expect(outsiderPage.getByRole("main").getByRole("article")).toHaveCount(0);
    await expect(outsiderPage.getByRole("main")).not.toContainText(disputedTitle);

    for (const locale of locales) {
      const copy = messages[locale].deliveries;
      for (const width of widths) {
        await visit(page, locale, width);
        await checkLayout(page, copy.viewDeliveries, width, `history-${locale}`);
        await activate(page, main.getByRole("link", { name: copy.viewDeliveries }));
        await expect(main.getByRole("heading", { name: copy.myDeliveries })).toBeFocused();
        await expect(firstCard.getByText(copy.statusAccepted, { exact: true })).toBeVisible();
        await expect(secondCard.getByText(copy.statusDisputed, { exact: true })).toBeVisible();
        await expect(secondCard.getByText(reason, { exact: true })).toBeVisible();
        await expect(firstCard.locator("time")).toHaveAttribute("datetime", pending.created_at);
        await expect(firstCard.locator("time")).toContainText("UTC");
        for (const item of [firstCard, secondCard]) {
          await expect(item.getByRole("button")).toHaveCount(0);
          expect(await item.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        if (width === 375) await secondCard.screenshot({ path: `${shots}/disputed-${locale}-375.png` });
      }

      await visit(page, locale, 375);
      await context.addCookies([{ name: readProbe, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(firstCard).toBeVisible();
      await context.addCookies([{ name: readProbe, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("article")).toHaveCount(0);
      await expect(main).not.toContainText("Private delivery fixture failure");
      await checkLayout(page, copy.reload, 375, `read-failure-${locale}`);
      await context.clearCookies({ name: readProbe });
      await activate(page, main.getByRole("link", { name: copy.reload }));
      await expect(secondCard).toBeVisible();
    }

    const archive = await context.request.post("/api/brands", { headers, data: {
      action: "archive", actorId: owner.id, operationId: randomUUID(), brandId, expectedBrandRevision: 1,
    } });
    expect(archive.status()).toBe(200);
    expect((await context.request.post(endpoint, { headers, data: { brandId, title: "Archived" } })).status()).toBe(404);
    for (const locale of locales) {
      const copy = messages[locale].deliveries;
      await visit(page, locale, 375);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(secondCard.getByText(brandId, { exact: true })).toBeVisible();
      await checkLayout(page, copy.viewDeliveries, 375, `archived-${locale}`);
    }
    expect(await rows()).toEqual(saved);
  } finally {
    await outsider.close();
    try {
      for (const { id, email } of accounts) {
        await sql`delete from "user" where id = ${id} and email = ${email}`;
        const [remaining] = await sql`
          select exists (select 1 from "user" where id = ${id}) as account,
                 exists (select 1 from brand where owner_id = ${id}) as brand,
                 exists (select 1 from brand_delivery where owner_id = ${id}) as delivery`;
        expect(remaining).toEqual({ account: false, brand: false, delivery: false });
      }
      if (brandId) expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
