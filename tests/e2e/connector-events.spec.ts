import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";
import type { ConnectorEventList } from "../../src/features/data-connections/event-contracts";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/connector-events";
const api = "/api/reports/connector-events";
const headers = { Origin: origin };
const shots = ".cache/issue-135/connector-events";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const eventKey = `fixture-${"event".repeat(11)}x`;
const digest = "ab".repeat(32);
const otherDigest = "cd".repeat(32);
const probeCookie = "geo-connector-events-read";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const copy = {
  "zh-CN": {
    title: "跨源事件", open: "打开跨源事件", start: "开始导入", goBrands: "前往品牌资料",
    empty: "还没有跨源事件。", noBrands: "当前没有可导入事件的品牌。",
    brand: "品牌", lines: "夹具行", list: "事件记录", reload: "重新载入", loading: "正在加载跨源事件…",
    count: "咨询计数 1", conflict: "冲突", connector: "连接器", notIndexed: "未写成推荐或收录。",
    unavailable: "跨源事件暂时不可用，请稍后重试。",
  },
  en: {
    title: "Cross-source events", open: "Open cross-source events", start: "Start import", goBrands: "Go to brands",
    empty: "There are no cross-source events yet.", noBrands: "There is no brand available for an event import.",
    brand: "Brand", lines: "Fixture rows", list: "Event records", reload: "Reload", loading: "Loading cross-source events…",
    count: "Consultation count 1", conflict: "Conflict", connector: "Connector", notIndexed: "Not recorded as a recommendation or inclusion.",
    unavailable: "Cross-source events are temporarily unavailable. Try again shortly.",
  },
} as const;

async function register(context: BrowserContext) {
  const email = `connector-events-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Connector events visual test", email, password: randomBytes(24).toString("base64url"),
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

async function visit(page: Page, locale: keyof typeof copy, width: number, viaReports = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaReports ? "/dashboard/reports" : path);
  if (viaReports) await activate(page, page.getByRole("link", { name: copy[locale].open, exact: true }));
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="reports"]')).toBeVisible();
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

test("cross-source event imports have a keyboard path and keep one count with both sources", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local PostgreSQL database");
  }
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
          name: brandName, description: "Synthetic brand for cross-source event acceptance.",
          website: "https://connector-events.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    const list = async (): Promise<ConnectorEventList> => {
      const response = await context.request.get(api, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width, locale === "zh-CN" && width === 375);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start, exact: true }), width, `empty-${locale}`);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expect(main.getByRole("combobox", { name: copy[locale].brand, exact: true })).toHaveValue(brandId);
      }
    }

    const main = await visit(page, "zh-CN", 375);
    const start = main.getByRole("link", { name: copy["zh-CN"].start, exact: true });
    const rows = main.getByRole("textbox", { name: copy["zh-CN"].lines, exact: true });
    const notice = main.getByRole("form", { name: "导入夹具行" }).getByRole("status");
    const save = main.getByRole("button", { name: "导入事件", exact: true });
    await activate(page, start);
    await expect(rows).toBeFocused();
    expect(await rows.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.screenshot({ path: `${shots}/focus-zh-CN.png` });

    await rows.fill(`${eventKey},csv,not-a-digest`);
    await activate(page, save);
    await expect(notice).toContainText("检查事件键");
    await expect(rows).toHaveAttribute("aria-invalid", "true");
    await expect(rows).toHaveValue(`${eventKey},csv,not-a-digest`);
    expect((await list()).events).toEqual([]);

    async function importRow(source: "csv" | "connector", payloadDigest = digest) {
      await rows.fill(`${eventKey},${source},${payloadDigest}`);
      await activate(page, save);
      await expect(notice).toHaveText("已保存。相同事件键仍只计一条咨询。");
      await expect(rows).toHaveValue("");
      await expect(save).toBeFocused();
    }

    await importRow("csv");
    const csvOnly = await list();
    expect(csvOnly.events).toHaveLength(1);
    const [first] = csvOnly.events;
    expect(first).toMatchObject({ eventKey, brandId, count: 1, conflict: false, sources: [{ source: "csv", payloadDigest: digest }] });

    const connectorRow = `${eventKey},connector,${digest}`;
    await rows.fill(connectorRow);
    await page.route(`**${api}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Private connector save fixture failure" } },
    }), { times: 1 });
    await activate(page, save);
    await expect(notice).toHaveText(copy["zh-CN"].unavailable);
    await expect(rows).toHaveValue(connectorRow);
    await expect(save).toBeFocused();
    await expect(main).not.toContainText("Private connector save fixture failure");
    expect(await list()).toEqual(csvOnly);

    await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(main.getByRole("form", { name: "Import fixture rows" }).getByRole("status")).toHaveText(copy.en.unavailable);
    await expect(main.getByRole("textbox", { name: copy.en.lines, exact: true })).toHaveValue(connectorRow);
    expect(await list()).toEqual(csvOnly);
    await page.getByRole("combobox", { name: "Interface language", exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    await activate(page, save);
    await expect(notice).toHaveText("已保存。相同事件键仍只计一条咨询。");
    await expect(rows).toHaveValue("");
    const combined = await list();
    expect(combined.events).toHaveLength(1);
    expect(combined.events[0]).toMatchObject({
      id: first.id, count: 1, conflict: false,
      sources: [{ source: "connector", payloadDigest: digest }, { source: "csv", payloadDigest: digest }],
    });
    await importRow("connector");
    expect(await list()).toEqual(combined);
    await importRow("connector", otherDigest);
    const stored = await list();
    const [conflicted] = stored.events;
    expect(stored.events).toHaveLength(1);
    expect(conflicted).toMatchObject({ id: first.id, count: 1, conflict: true, sources: combined.events[0].sources });
    const exact = await context.request.get(`${api}?id=${first.id}`, { headers });
    expect(exact.status()).toBe(200);
    expect(await exact.json()).toEqual({ event: conflicted });

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width);
        const records = main.getByRole("region", { name: copy[locale].list });
        const record = records.getByRole("listitem").filter({ has: page.getByRole("heading", { name: eventKey, exact: true }) });
        await expect(record.getByText(brandName, { exact: true })).toBeVisible();
        await expect(record.getByText(copy[locale].count, { exact: true })).toBeVisible();
        await expect(record.getByText(copy[locale].conflict, { exact: true })).toBeVisible();
        await expect(record.getByText(copy[locale].notIndexed, { exact: true })).toBeVisible();
        await expect(record.getByText(`CSV · ${digest}`, { exact: true })).toBeVisible();
        await expect(record.getByText(`${copy[locale].connector} · ${digest}`, { exact: true })).toBeVisible();
        await expect(record).not.toContainText(otherDigest);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start }), width, `saved-${locale}`);
        if (width === 375) await record.screenshot({ path: `${shots}/record-${locale}.png` });
      }
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy[locale].loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(main.getByRole("heading", { name: eventKey, exact: true })).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      const failed = await visit(page, locale, 375);
      await expect(failed.getByRole("alert")).toHaveText(copy[locale].unavailable);
      await expect(failed.getByRole("form")).toHaveCount(0);
      await expect(failed.getByRole("region", { name: copy[locale].list })).toHaveCount(0);
      await expect(failed).not.toContainText(brandName);
      await expect(failed).not.toContainText(eventKey);
      await expect(failed).not.toContainText("Private connector events fixture failure");
      const reload = failed.getByRole("link", { name: copy[locale].reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(main.getByRole("heading", { name: eventKey, exact: true })).toBeVisible();
      expect(await list()).toEqual(stored);
    }

    const stranger = await outsider.newPage();
    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(stranger, locale, width);
        await expect(main.getByText(copy[locale].noBrands, { exact: true })).toBeVisible();
        await expect(main.getByRole("form")).toHaveCount(0);
        await expect(main).not.toContainText(eventKey);
        const goBrands = main.getByRole("link", { name: copy[locale].goBrands });
        await expect(goBrands).toHaveAttribute("href", "/dashboard/brands");
        await checkLayout(stranger, goBrands, width, `no-brand-${locale}`);
      }
    }
    await activate(stranger, stranger.getByRole("link", { name: copy.en.goBrands, exact: true }));
    await expect(stranger).toHaveURL(`${origin}/dashboard/brands`);
    expect((await outsider.request.get(`${api}?id=${first.id}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(api, {
      headers, data: { brandId, rows: [{ eventKey, source: "csv", payloadDigest: digest }] },
    })).status()).toBe(404);
    const outsideList = await outsider.request.get(api, { headers });
    expect(outsideList.status()).toBe(200);
    expect(await outsideList.json()).toEqual({ brands: [], events: [] });
    expect(await list()).toEqual(stored);
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
      ], { stdio: "inherit" });
    }
    const sql = postgres(databaseURL, { max: 1 });
    try {
      for (const { userId, email } of accounts) {
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from connector_event where owner_id = ${userId}) as event,
                 exists (select 1 from connector_event_source where owner_id = ${userId}) as source`;
        expect(remaining).toEqual({ account: false, brand: false, event: false, source: false });
      }
      if (brandId) {
        expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
