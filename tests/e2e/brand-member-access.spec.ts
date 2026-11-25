import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const locales = ["zh-CN", "en"] as const;

const copy = {
  "zh-CN": {
    overviewTitle: "可解释概览",
    overviewMissing: "找不到该证据，或不属于你的品牌。",
    contentTitle: "内容计划与草稿",
    contentReady: "确认 Brief 后，用隔离模板生成有事实绑定的待审草稿；不调用付费模型。",
    contentMissing: "未找到资源或无权访问。",
    reportsTitle: "复测与报告",
    reportsReady: "按同口径比较前后窗口，下载不可变 HTML/JSON 快照。探索结论不声称因果。",
    reportsMissing: "找不到该品牌或报告资源。",
  },
  en: {
    overviewTitle: "Explainable overview",
    overviewMissing: "Evidence was not found or does not belong to your brand.",
    contentTitle: "Content plans and drafts",
    contentReady: "Confirm briefs, then fill isolated templates into fact-bound drafts for review—no paid model calls.",
    contentMissing: "Resource not found or not accessible.",
    reportsTitle: "Retest & reports",
    reportsReady: "Compare before/after windows on a shared scope and download immutable HTML/JSON snapshots. Exploratory conclusions do not claim causality.",
    reportsMissing: "Brand or report resource was not found.",
  },
} as const;

type LocaleCopy = (typeof copy)[typeof locales[number]];

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [] }),
  ], { stdio: "inherit" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordId(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} was not returned`);
  const id = value[label];
  if (typeof id !== "string" || id.length === 0) throw new Error(`${label} was not returned`);
  return id;
}

async function register(context: BrowserContext, email: string, name: string) {
  const response = await registerTestAccount(context, {
    name, email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("user" in body)) throw new Error("Registration did not return a user");
  return recordId(body.user, "id");
}

async function createBrand(context: BrowserContext, userId: string, name: string) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: origin },
    data: {
      action: "submit", actorId: userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name, description: "合成成员授权隔离说明", website: "https://member-access.example.com",
        aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const parsed: unknown = JSON.parse(body);
  return recordId(parsed, "id");
}

async function provision(browser: Browser, email: string, name: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 900 } });
  const userId = await register(context, email, name);
  return { context, userId, email };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
      ? null
      : { scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }
  ));
  expect(overflow).toBeNull();
}

async function openBrand(page: Page, locale: typeof locales[number], path: string) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByRole("main")).toHaveCount(1);
}

test("granted members do not see the other brand after changing brandId", async ({ browser }) => {
  test.setTimeout(240_000);
  const token = randomUUID().slice(0, 8);
  const nameA = `合成甲岸授权${token}`;
  const nameB = `合成乙岸授权${token}`;
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const accounts: Array<{ userId: string; email: string; context: BrowserContext }> = [];
  let brandA = "";
  let brandB = "";
  try {
    const ownerA = await provision(browser, `brand-access-owner-a-${token}@example.invalid`, "负责人甲");
    accounts.push(ownerA);
    const ownerB = await provision(browser, `brand-access-owner-b-${token}@example.invalid`, "负责人乙");
    accounts.push(ownerB);
    const memberA = await provision(browser, `brand-access-member-a-${token}@example.invalid`, "成员甲");
    accounts.push(memberA);
    const memberB = await provision(browser, `brand-access-member-b-${token}@example.invalid`, "成员乙");
    accounts.push(memberB);
    brandA = await createBrand(ownerA.context, ownerA.userId, nameA);
    brandB = await createBrand(ownerB.context, ownerB.userId, nameB);
    const time = new Date().toISOString();
    await sql`
      insert into brand_member_grant (id, brand_id, user_id, role, active, created_at)
      values (${randomUUID()}, ${brandA}, ${memberA.userId}, ${"member"}, ${1}, ${time})`;
    await sql`
      insert into brand_member_grant (id, brand_id, user_id, role, active, created_at)
      values (${randomUUID()}, ${brandB}, ${memberB.userId}, ${"member"}, ${1}, ${time})`;

    const pageA = await memberA.context.newPage();
    const pageB = await memberB.context.newPage();
    for (const locale of locales) {
      const words = copy[locale];
      await expectGrantedSwap(pageA, locale, words, brandA, nameA, brandB, nameB);
      await expectGrantedSwap(pageB, locale, words, brandB, nameB, brandA, nameA);
    }
  } finally {
    for (const account of accounts) {
      try {
        cleanupAccount(account.userId, account.email);
      } finally {
        await account.context.close();
      }
    }
    try {
      const userIds = accounts.map((account) => account.userId);
      if (userIds.length > 0) {
        expect(await sql`select id from "user" where id in ${sql(userIds)}`).toHaveLength(0);
      }
      if (brandA && brandB) {
        expect(await sql`select id from brand where id in (${brandA}, ${brandB})`).toHaveLength(0);
        expect(await sql`select id from brand_member_grant where brand_id in (${brandA}, ${brandB})`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});

async function expectGrantedSwap(
  page: Page,
  locale: typeof locales[number],
  words: LocaleCopy,
  ownBrandId: string,
  ownName: string,
  otherBrandId: string,
  otherName: string,
) {
  const main = page.locator("#main-content");
  await openBrand(page, locale, `/dashboard/monitoring/overview?brandId=${ownBrandId}`);
  await expect(main.getByRole("heading", { name: words.overviewTitle, exact: true })).toBeVisible();
  await expect(main.getByText(ownName, { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain(otherName);
  await expectNoOverflow(page);

  await openBrand(page, locale, `/dashboard/monitoring/overview?brandId=${otherBrandId}`);
  await expect(main.getByRole("heading", { name: words.overviewTitle, exact: true })).toBeVisible();
  await expect(main.getByText(words.overviewMissing, { exact: true })).toBeVisible();
  await expect(main.getByText(ownName, { exact: true })).toHaveCount(0);
  const deniedOverview = await page.content();
  expect(deniedOverview).not.toContain(ownName);
  expect(deniedOverview).not.toContain(otherName);
  await expectNoOverflow(page);

  await openBrand(page, locale, `/dashboard/content?brandId=${ownBrandId}`);
  await expect(main.getByRole("heading", { name: words.contentTitle, exact: true })).toBeVisible();
  await expect(main.getByText(words.contentReady, { exact: true })).toBeVisible();
  await expect(main.getByText(words.contentMissing, { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain(otherName);
  await expectNoOverflow(page);

  await openBrand(page, locale, `/dashboard/content?brandId=${otherBrandId}`);
  await expect(main.getByRole("heading", { name: words.contentTitle, exact: true })).toBeVisible();
  await expect(main.getByText(words.contentMissing, { exact: true })).toBeVisible();
  const deniedContent = await page.content();
  expect(deniedContent).not.toContain(ownName);
  expect(deniedContent).not.toContain(otherName);
  await expectNoOverflow(page);

  await openBrand(page, locale, `/dashboard/reports?brandId=${ownBrandId}`);
  await expect(main.getByRole("heading", { name: words.reportsTitle, exact: true })).toBeVisible();
  await expect(main.getByText(words.reportsReady, { exact: true })).toBeVisible();
  await expect(main.getByText(words.reportsMissing, { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain(otherName);
  await expectNoOverflow(page);

  await openBrand(page, locale, `/dashboard/reports?brandId=${otherBrandId}`);
  await expect(main.getByRole("heading", { name: words.reportsTitle, exact: true })).toBeVisible();
  await expect(main.getByText(words.reportsMissing, { exact: true })).toBeVisible();
  const deniedReports = await page.content();
  expect(deniedReports).not.toContain(ownName);
  expect(deniedReports).not.toContain(otherName);
  await expectNoOverflow(page);
}
