import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/leads";
const api = "/api/reports/leads";
const headers = { Origin: origin };
const shots = ".cache/issue-135/business-leads";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const eventId = `lead-${"x".repeat(59)}`;
const rejectedId = "unapproved-lead";
const batch = [
  `${eventId},self_report,false`,
  `${eventId},referral,false`,
  `${rejectedId},unknown,true`,
  ",landing_page,false",
].join("\n");
const copy = {
  "zh-CN": {
    title: "脱敏线索", open: "打开脱敏线索", next: "开始导入", setup: "去建档",
    empty: "还没有脱敏线索。被拒绝的行不会出现在台账里。",
    count: "这条咨询计 1 次。", primary: "主分类：可识别引荐",
    evidence: ["用户自报", "可识别引荐"], ledger: "去重台账",
  },
  en: {
    title: "De-identified leads", open: "Open de-identified leads", next: "Start import", setup: "Open brands",
    empty: "No de-identified leads yet. Rejected rows do not appear in the ledger.",
    count: "This inquiry counts as 1.", primary: "Primary class: Identified referral",
    evidence: ["Self-reported", "Identified referral"], ledger: "Deduplicated ledger",
  },
} as const;

async function register(context: BrowserContext) {
  const email = `business-leads-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Lead visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
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
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375) await page.screenshot({ path: `${shots}/${shot}.png` });
}

test("lead import is reachable by keyboard and keeps the deduplicated evidence on reload", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Array<{ userId: string; email: string }> = [];
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
          name: brandName, description: "Synthetic brand for lead import acceptance.",
          website: "https://leads.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    const list = async () => {
      const response = await context.request.get(`${api}?brandId=${brandId}`, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const main = await visit(page, locale, width, locale === "zh-CN" && width === 375);
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: copy[locale].next, exact: true }), width, `empty-${locale}`);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeInViewport();
      }
    }

    const main = await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].next }));
    const rows = main.getByRole("textbox", { name: "线索行", exact: true });
    await expect(rows).toBeFocused();
    const submit = main.getByRole("button", { name: "导入", exact: true });
    await rows.fill(`${eventId},referral`);
    await activate(page, submit);
    await expect(main.getByRole("alert")).toContainText("线索行无效");
    await expect(rows).toHaveValue(`${eventId},referral`);
    expect(await list()).toEqual({ leads: [] });

    await rows.fill(batch);
    await activate(page, submit);
    await expect(main.getByRole("status").filter({ hasText: "本次结果" })).toBeVisible();
    await expect(main.getByText("第 3 行：含直接身份信息，未入库。")).toBeVisible();
    await expect(main.getByText("第 4 行：缺少事件 ID，未入库。")).toBeVisible();
    await expect(main).not.toContainText(rejectedId);
    await expect(main.getByText(copy["zh-CN"].empty, { exact: true })).toHaveCount(0);
    await expect(submit).toBeFocused();
    await page.screenshot({ path: `${shots}/import-zh-CN.png`, fullPage: true });
    const stored = await list();
    expect(stored.leads).toHaveLength(1);
    expect(stored.leads[0]).toMatchObject({ eventId, count: 1, primary: "referral", evidence: ["self_report", "referral"] });

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const entries = await visit(page, locale, width);
        const ledger = entries.getByRole("region", { name: copy[locale].ledger });
        await expect(ledger.getByRole("article")).toHaveCount(1);
        await expect(ledger.getByRole("heading", { level: 3 })).toContainText(eventId);
        await expect(ledger.getByText(copy[locale].count, { exact: true })).toBeVisible();
        await expect(ledger.getByText(copy[locale].primary, { exact: true })).toBeVisible();
        await expect(ledger.getByRole("listitem")).toHaveText([...copy[locale].evidence]);
        await checkLayout(page, entries.getByRole("link", { name: copy[locale].next }), width, `saved-${locale}`);
      }
    }
    await context.addCookies([{ name: "geo-leads-unavailable", value: "1", url: origin }]);
    await visit(page, "en", 375);
    await expect(main.getByRole("alert")).toHaveText("Leads cannot be read or saved right now. Try again later.");
    for (const value of [brandName, eventId, copy.en.empty, "Private leads fixture failure"]) {
      await expect(main).not.toContainText(value);
    }
    await expect(main.getByRole("textbox")).toHaveCount(0);
    const reload = main.getByRole("link", { name: "Reload", exact: true });
    await checkLayout(page, reload, 375, "read-failure-en");
    await context.clearCookies({ name: "geo-leads-unavailable" });
    await activate(page, reload);
    await expect(main.getByRole("region", { name: copy.en.ledger }).getByRole("heading", { level: 3 })).toContainText(eventId);
    expect(await list()).toEqual(stored);

    const stranger = await outsider.newPage();
    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const strangerMain = await visit(stranger, locale, width);
        await expect(strangerMain).not.toContainText(brandName);
        await expect(strangerMain).not.toContainText(eventId);
        await expect(strangerMain.getByRole("textbox")).toHaveCount(0);
        await checkLayout(stranger, strangerMain.getByRole("link", { name: copy[locale].setup }), width, `no-brand-${locale}`);
      }
    }
    const refused = await outsider.request.get(`${api}?brandId=${brandId}`, { headers });
    expect(refused.status()).toBe(404);
    const refusedWrite = await outsider.request.post(api, {
      headers, data: { brandId, rows: [{ eventId, evidence: "landing_page", directIdentifier: false }] },
    });
    expect(refusedWrite.status()).toBe(404);
    expect(await list()).toEqual(stored);
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
    const sql = postgres(databaseURL, { max: 1 });
    try {
      for (const { userId, email } of accounts) {
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from business_lead where owner_id = ${userId}) as lead,
                 exists (select 1 from business_lead_evidence where owner_id = ${userId}) as evidence`;
        expect(remaining).toEqual({ account: false, brand: false, lead: false, evidence: false });
      }
      if (brandId) {
        const versions = await sql`select 1 from brand_version where brand_id = ${brandId}`;
        expect(versions).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
