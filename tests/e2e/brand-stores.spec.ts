import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const entryPath = "/dashboard/brands/stores";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成门店品牌-${"LongBrand_".repeat(6)}end`;
const westName = `合成西湖店-${"WestStore_".repeat(4)}end`;
const riverName = `合成滨江店-${"RiverStore_".repeat(4)}end`;
const westArea = "西湖";
const riverArea = "滨江";

const copy = {
  "zh-CN": {
    brandsNav: "品牌资料",
    brandsEntry: "登记门店范围",
    title: "门店服务范围",
    noBrand: "还没有活跃品牌。下一步是先建立品牌，再登记门店服务范围。",
    openBrand: "去建档",
    emptyTask: "还没有门店。下一步是填写门店名称和只属于这家店的服务范围。",
    savedTask: "已有门店。下一步是查看各店服务范围，并只按本店已保存的范围核对。",
    fill: "填写门店",
    view: "查看门店",
    related: "相关入口",
    storeName: "门店名称",
    serviceArea: "服务范围",
    save: "保存门店",
    saving: "正在保存…",
    saved: "已保存这家门店的服务范围。",
    invalid: "请检查品牌、门店名称和服务范围。",
    listTitle: "已保存门店",
    check: "保存核对",
    checked: "已按本店范围保存核对。",
    otherStore: "不能把其他门店的服务范围写入这家门店的核对记录。",
    useEmpty: "这家门店还没有核对记录。",
    ownStore: "只使用本店范围，没有混用其他门店。",
    loading: "正在加载门店…",
    unavailable: "门店范围暂时不可用，请稍后重试。",
    reload: "重新载入",
    privateFailure: "Private brand stores fixture failure",
  },
  en: {
    brandsNav: "Brand information",
    brandsEntry: "Record store service areas",
    title: "Store service areas",
    noBrand: "No active brand yet. The next step is to set up a brand before recording store service areas.",
    openBrand: "Open brands",
    emptyTask: "No store yet. The next step is to enter a store name and the service area that belongs only to that store.",
    savedTask: "Stores are saved. The next step is to review each service area and check a store only with its own saved area.",
    fill: "Enter a store",
    view: "View stores",
    related: "Related entries",
    storeName: "Store name",
    serviceArea: "Service area",
    save: "Save store",
    saving: "Saving…",
    saved: "Saved this store's service area.",
    invalid: "Check the brand, store name, and service area.",
    listTitle: "Saved stores",
    check: "Save check",
    checked: "Saved a check using this store's area.",
    otherStore: "Another store's service area cannot be written into this store's check.",
    useEmpty: "This store has no check yet.",
    ownStore: "Only this store's area is used. Another store was not mixed in.",
    loading: "Loading stores…",
    unavailable: "Store service areas are temporarily unavailable. Try again shortly.",
    reload: "Reload",
    privateFailure: "Private brand stores fixture failure",
  },
} as const;

function areaLine(locale: "zh-CN" | "en", area: string) {
  return locale === "zh-CN" ? `服务范围 ${area}` : `Service area ${area}`;
}

function checkedAreaLine(locale: "zh-CN" | "en", area: string) {
  return locale === "zh-CN" ? `核对使用的范围 ${area}` : `Checked area ${area}`;
}

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Brand stores visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function capture(page: Page, dir: string | undefined, name: string) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false });
}

function storeCard(page: Page, name: string) {
  return page.locator("#brand-store-list").locator("[data-slot=card]").filter({
    has: page.getByRole("heading", { level: 3, name, exact: true }),
  });
}

test("brand stores keep separate service areas, the next action, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_BRAND_STORE_SCREENSHOTS || ".cache/issue-135/brand-stores";
  const ownerEmail = `brand-stores-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-stores-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  const sql = openTestDatabase();
  let ownerId = "";
  let brandId = "";

  try {
    ownerId = await register(context, ownerEmail);
    accounts.push({ userId: ownerId, email: ownerEmail });
    accounts.push({
      userId: await register(outsider, outsiderEmail),
      email: outsiderEmail,
    });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/brands");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].brandsEntry, exact: true }));
    await expect(page).toHaveURL(entryPath);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=brands]")).toContainText(t.brandsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toBeVisible();
        const openBrand = main.getByRole("link", { name: t.openBrand, exact: true });
        await expect(openBrand).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByLabel(t.storeName)).toHaveCount(0);
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
        await expect(main.getByText(westName, { exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(openBrand).toBeInViewport();
          await capture(page, screenshotDir, `nobrand-${locale}-375.png`);
        }
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].openBrand, exact: true }));
    await expect(page).toHaveURL("/dashboard/brands");

    const createdBrand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: ownerId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "合成门店范围视觉验收资料。",
          website: "https://brand-stores.example.com/guide",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(createdBrand.status()).toBe(200);
    brandId = (await createdBrand.json()).id as string;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        if (locale === "zh-CN" && width === 375) {
          await page.goto("/dashboard/brands");
          await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: t.brandsEntry, exact: true }));
          await expect(page).toHaveURL(entryPath);
        } else {
          await page.goto(entryPath);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=brands]")).toContainText(t.brandsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(1);
        await expect(main.getByText(t.noBrand, { exact: true })).toHaveCount(0);
        const fill = main.getByRole("link", { name: t.fill, exact: true });
        await expect(fill).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(fill).toBeInViewport();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
          await activateFromKeyboard(page, fill);
          await expect(page.locator("#brand-store-name")).toBeFocused();
        }
      }
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    const saveForm = page.locator("#brand-store-form");
    await saveForm.getByLabel(tZh.storeName, { exact: true }).fill("   ");
    await saveForm.getByLabel(tZh.serviceArea, { exact: true }).fill("保留这段范围");
    let rejectedPosts = 0;
    const countRejected = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/brands/stores") {
        rejectedPosts += 1;
      }
    };
    page.on("request", countRejected);
    await saveForm.getByRole("button", { name: tZh.save, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(tZh.invalid);
    await expect(saveForm.getByLabel(tZh.storeName, { exact: true })).toHaveValue("   ");
    await expect(saveForm.getByLabel(tZh.serviceArea, { exact: true })).toHaveValue("保留这段范围");
    expect(rejectedPosts).toBe(0);
    page.off("request", countRejected);

    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-brand-stores-write", value: "slow", url: origin },
    ]);
    await page.goto(entryPath);
    const slowSave = page.locator("#brand-store-form");
    await slowSave.getByLabel(tZh.storeName, { exact: true }).fill(westName);
    await slowSave.getByLabel(tZh.serviceArea, { exact: true }).fill(westArea);
    let slowPosts = 0;
    const countSlow = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/brands/stores") {
        slowPosts += 1;
      }
    };
    page.on("request", countSlow);
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/brands/stores" && response.request().method() === "POST"
    ));
    const saveButton = slowSave.getByRole("button", { name: tZh.save, exact: true });
    await saveButton.focus();
    await page.keyboard.press("Enter");
    const saving = slowSave.getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("main").getByText(tZh.saved, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(areaLine("zh-CN", westArea), { exact: true })).toBeVisible();
    await expect(slowSave.getByLabel(tZh.storeName, { exact: true })).toHaveValue("");
    expect(slowPosts).toBe(1);
    page.off("request", countSlow);
    await context.clearCookies({ name: "geo-brand-stores-write" });

    const createdRiver = await context.request.post("/api/brands/stores", {
      headers,
      data: { brandId, name: riverName, serviceArea: riverArea },
    });
    expect(createdRiver.status()).toBe(200);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(t.savedTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true }).first()).toBeVisible();
        await expect(main.getByRole("heading", { level: 2, name: t.listTitle, exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { level: 3, name: westName, exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { level: 3, name: riverName, exact: true })).toBeVisible();
        await expect(main.getByText(areaLine(locale, westArea), { exact: true })).toBeVisible();
        await expect(main.getByText(areaLine(locale, riverArea), { exact: true })).toBeVisible();
        await expect(storeCard(page, westName).getByText(areaLine(locale, riverArea), { exact: true })).toHaveCount(0);
        await expect(storeCard(page, riverName).getByText(areaLine(locale, westArea), { exact: true })).toHaveCount(0);
        const view = main.getByRole("link", { name: t.view, exact: true });
        await expect(view).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(view).toBeInViewport();
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
          await activateFromKeyboard(page, view);
          await expect(page.locator("#main-content #brand-store-list")).toBeFocused();
        }
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    const westCard = storeCard(page, westName);
    await westCard.getByLabel(tZh.serviceArea, { exact: true }).fill(riverArea);
    let mixedPosts = 0;
    const countMixed = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && /\/api\/brands\/stores\/[^/]+\/uses$/.test(new URL(request.url()).pathname)) {
        mixedPosts += 1;
      }
    };
    page.on("request", countMixed);
    await westCard.getByRole("button", { name: tZh.check, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(westCard.getByRole("alert")).toContainText(tZh.otherStore);
    await expect(westCard.getByLabel(tZh.serviceArea, { exact: true })).toHaveValue(riverArea);
    await expect(page.getByText(checkedAreaLine("zh-CN", riverArea), { exact: true })).toHaveCount(0);
    await expect(page.getByText(checkedAreaLine("zh-CN", westArea), { exact: true })).toHaveCount(0);
    expect(mixedPosts).toBe(1);
    page.off("request", countMixed);
    const rejectedUses = await sql`
      SELECT service_area FROM store_fact_use WHERE owner_id = ${ownerId}
    `;
    expect(rejectedUses).toHaveLength(0);
    await capture(page, screenshotDir, "rejected-zh-CN-375.png");

    const accepted = page.waitForResponse((response) => (
      /\/api\/brands\/stores\/[^/]+\/uses$/.test(new URL(response.url()).pathname) && response.request().method() === "POST"
    ));
    await westCard.getByLabel(tZh.serviceArea, { exact: true }).fill(westArea);
    await westCard.getByRole("button", { name: tZh.check, exact: true }).focus();
    await page.keyboard.press("Enter");
    expect((await accepted).ok()).toBe(true);
    await expect(page.getByRole("main").getByText(tZh.checked, { exact: true })).toBeVisible();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const west = storeCard(page, westName);
        const river = storeCard(page, riverName);
        await expect(west.getByText(areaLine(locale, westArea), { exact: true })).toBeVisible();
        await expect(west.getByText(checkedAreaLine(locale, westArea), { exact: true })).toBeVisible();
        await expect(west.getByText(t.ownStore, { exact: true })).toBeVisible();
        await expect(west.getByText(areaLine(locale, riverArea), { exact: true })).toHaveCount(0);
        await expect(west.getByText(checkedAreaLine(locale, riverArea), { exact: true })).toHaveCount(0);
        await expect(river.getByText(areaLine(locale, riverArea), { exact: true })).toBeVisible();
        await expect(river.getByText(t.useEmpty, { exact: true })).toBeVisible();
        await expect(river.getByText(checkedAreaLine(locale, westArea), { exact: true })).toHaveCount(0);
        await expect(river.getByText(checkedAreaLine(locale, riverArea), { exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) await capture(page, screenshotDir, `checked-${locale}-375.png`);
      }
    }

    const stored = await sql`
      SELECT name, service_area AS "serviceArea"
      FROM brand_store
      WHERE brand_id = ${brandId}
    `;
    expect(stored).toHaveLength(2);
    const areas = new Map(stored.map((row) => [row.name, row.serviceArea]));
    expect(areas.get(westName)).toBe(westArea);
    expect(areas.get(riverName)).toBe(riverArea);
    const uses = await sql`
      SELECT service_area AS "serviceArea", used_other_store AS "usedOtherStore"
      FROM store_fact_use
      WHERE owner_id = ${ownerId}
    `;
    expect(uses).toHaveLength(1);
    expect(uses[0]?.serviceArea).toBe(westArea);
    expect(Number(uses[0]?.usedOtherStore)).toBe(0);

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(entryPath);
    await expect(stranger.getByRole("main").getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(westName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(riverName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(areaLine("en", westArea), { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(areaLine("en", riverArea), { exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-stores-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(entryPath, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(westName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(riverName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(areaLine(locale, westArea), { exact: true })).toHaveCount(0);
      await expect(failed.getByText(areaLine(locale, riverArea), { exact: true })).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      await expect(failed.getByLabel(t.storeName)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-stores-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("main").getByText(areaLine(locale, westArea), { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(areaLine(locale, riverArea), { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(checkedAreaLine(locale, westArea), { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify(account),
      ], { stdio: "inherit" });
    }
    if (accounts.length > 0) {
      const users = accounts.map((account) => account.userId);
      expect(await sql`SELECT id FROM "user" WHERE id IN ${sql(users)}`).toHaveLength(0);
      expect(await sql`SELECT id FROM brand_store WHERE owner_id = ${ownerId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM store_fact_use WHERE owner_id = ${ownerId}`).toHaveLength(0);
    }
    await sql.end();
  }
});
