import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/lead-quality";
const api = "/api/reports/lead-quality";
const ruleApi = "/api/reports/lead-rules";
const headers = { Origin: origin };
const shots = ".cache/issue-135/lead-quality";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const copy = {
  "zh-CN": {
    title: "线索有效性", open: "打开线索有效性", start: "设置规则", review: "查看规则版本",
    setup: "去建档", reload: "重新载入", ruleForm: "保存规则版本", ruleHeading: "规则版本",
    empty: "还没有有效性规则。未冻结的规则不会计入合格数。",
    qualified: "合格计数 1", referral: "引荐计数 17", unavailable: "转化率 N/A",
    reason: "缺少可靠的非零会话分母。", crawler: "爬虫访问 4", citations: "回答引用 0",
    inclusion: "这些访问没有被记为 AI 收录。", observed: "转化与访问观察", rate: "转化率 40.0%",
  },
  en: {
    title: "Lead validity", open: "Open lead validity", start: "Set up a rule", review: "View rule versions",
    setup: "Open brands", reload: "Reload", ruleForm: "Save a rule version", ruleHeading: "Rule versions",
    empty: "No validity rule yet. Judgments on an unfrozen rule are not counted as qualified.",
    qualified: "Qualified count 1", referral: "Referral count 17", unavailable: "Conversion rate N/A",
    reason: "A reliable, nonzero session denominator is missing.", crawler: "Crawler visits 4",
    citations: "Answer citations 0", inclusion: "These visits are not recorded as AI inclusion.",
    observed: "Conversion and visit observations", rate: "Conversion rate 40.0%",
  },
} as const;

async function register(context: BrowserContext) {
  const email = `lead-quality-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Lead quality test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator, key = "Enter") {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press(key);
}

async function visit(page: Page, locale: keyof typeof copy, width: number, viaReports = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaReports ? "/dashboard/reports" : path);
  if (viaReports) await activate(page, page.getByRole("link", { name: copy[locale].open, exact: true }));
  await expect(page).toHaveURL((url) => url.pathname === path && url.searchParams.has("brandId") === viaReports);
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

test("lead validity exposes a keyboard action and reads back frozen rules and observations", async ({ page, context, browser }) => {
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
          name: brandName, description: "Synthetic brand for lead validity acceptance.",
          website: "https://quality.example.com", aliases: [],
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
    expect(await list()).toEqual({ rules: [], qualifications: [], observations: [], qualifiedCount: 0 });

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const main = await visit(page, locale, width, locale === "zh-CN" && width === 375);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start, exact: true }), width, `empty-${locale}`);
        await expect(main.getByText(brandName, { exact: true })).toBeInViewport();
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
      }
    }

    const main = await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].start, exact: true }));
    const createRule = main.getByRole("form", { name: copy["zh-CN"].ruleForm });
    const need = createRule.getByRole("checkbox", { name: "真实需求" });
    await expect(need).toBeFocused();
    expect(await need.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    const saveRule = createRule.getByRole("button", { name: "保存规则版本", exact: true });
    await page.keyboard.press("Tab");
    await expect(saveRule).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(createRule.getByRole("status")).toHaveText("已保存。");
    await expect(saveRule).toBeFocused();
    const version = main.getByRole("article").filter({ has: page.getByRole("heading", { name: "版本 1", exact: true }) });
    await expect(version.getByText("未冻结", { exact: true })).toBeVisible();
    const created = await list();
    expect(created.rules).toHaveLength(1);
    const ruleId = created.rules[0].id;
    expect(created.rules[0]).toMatchObject({
      version: 1, frozen: false, requiresRealNeed: true, requiresIndustry: true, requiresFollowUp: true,
    });

    const recordJudgment = version.getByRole("button", { name: "记录判定" });
    const freeze = version.getByRole("button", { name: "冻结此版本" });
    await activate(page, recordJudgment);
    await expect(version.getByText("版本 1：未冻结，不计入合格数", { exact: true })).toBeVisible();
    expect((await list()).qualifiedCount).toBe(0);

    await activate(page, freeze);
    const judgmentNeed = version.getByRole("checkbox", { name: "真实需求" });
    await expect(judgmentNeed).toBeFocused();
    await expect(version.getByText("已冻结", { exact: true })).toBeVisible();
    await activate(page, recordJudgment);
    await expect(version.getByText("版本 1：不合格", { exact: true })).toBeVisible();
    for (const criterion of ["真实需求", "目标行业", "可跟进"]) {
      await activate(page, version.getByRole("checkbox", { name: criterion }), "Space");
    }
    await activate(page, recordJudgment);
    await expect(version.getByText("版本 1：合格", { exact: true })).toBeVisible();
    await expect(main.getByText(copy["zh-CN"].qualified, { exact: true })).toBeVisible();
    await expect(recordJudgment).toBeFocused();

    await activate(page, createRule.getByRole("checkbox", { name: "目标行业" }), "Space");
    await activate(page, saveRule);
    await expect(main.getByRole("heading", { name: "版本 2", exact: true })).toBeVisible();
    const revised = await list();
    expect(revised.rules).toMatchObject([
      { id: ruleId, version: 1, frozen: true, requiresIndustry: true },
      { version: 2, frozen: false, requiresIndustry: false },
    ]);
    expect(revised.rules[1].id).not.toBe(ruleId);
    expect(revised.qualifications).toHaveLength(3);
    expect(revised.qualifications).toEqual(expect.arrayContaining(
      ["unfrozen", "disqualified", "qualified"].map((status) => expect.objectContaining({ ruleId, ruleVersion: 1, status })),
    ));

    const counts = main.getByRole("form", { name: "记录一轮计数" });
    const denominator = counts.getByRole("spinbutton", { name: "会话分母", exact: true });
    const saveCounts = counts.getByRole("button", { name: "保存计数" });
    await expect(denominator).toHaveAccessibleDescription(/没有可靠分母/);
    for (const [name, value] of [
      ["可识别引荐数", "17"], ["自报线索数", "5"], ["爬虫访问数", "4"], ["回答引用数", "0"],
    ]) {
      await counts.getByRole("spinbutton", { name, exact: true }).fill(value);
    }
    await denominator.fill("-1");
    await activate(page, saveCounts);
    expect(await denominator.evaluate((node: HTMLInputElement) => node.validity.rangeUnderflow)).toBe(true);
    expect((await list()).observations).toEqual([]);
    await denominator.fill("");
    await activate(page, saveCounts);
    await expect(counts.getByRole("status")).toHaveText("已保存。");
    await expect(saveCounts).toBeFocused();
    await expect(main.getByText(copy["zh-CN"].unavailable, { exact: true })).toBeVisible();
    const observed = await list();
    expect(observed.observations).toHaveLength(1);
    expect(observed.observations[0]).toMatchObject({
      identified: { count: 17, rate: null }, sessionDenominator: null, selfReported: 5,
      selfReportedOverVisits: null, crawlerVisits: 4, answerCitations: 0, calledIncluded: false,
    });

    const record = async (identifiedReferrals: number, sessionDenominator: number) => {
      const response = await context.request.post("/api/reports/lead-observations", {
        headers, data: { brandId, identifiedReferrals, sessionDenominator, selfReported: 0, crawlerVisits: 0, answerCitations: 0 },
      });
      expect(response.status()).toBe(200);
    };
    await record(3, 0);
    await record(4, 10);
    const stored = await list();
    expect(stored.observations).toHaveLength(3);
    expect(stored.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionDenominator: 0, identified: { count: 3, rate: null } }),
      expect.objectContaining({ sessionDenominator: 10, identified: { count: 4, rate: 0.4 } }),
    ]));

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const entries = await visit(page, locale, width);
        const labels = copy[locale];
        const review = entries.getByRole("link", { name: labels.review, exact: true });
        await checkLayout(page, review, width, `saved-${locale}`);
        await expect(entries.getByText(labels.qualified, { exact: true })).toBeVisible();
        const observations = entries.getByRole("region", { name: labels.observed });
        const missing = observations.getByRole("article").filter({ hasText: labels.referral });
        for (const value of [labels.unavailable, labels.reason, labels.crawler, labels.citations, labels.inclusion]) {
          await expect(missing.getByText(value, { exact: true })).toBeVisible();
        }
        await expect(observations.getByText(labels.reason, { exact: true })).toHaveCount(2);
        await expect(observations.getByText(labels.rate, { exact: true })).toBeVisible();
        if (width === 375) {
          await activate(page, review);
          await expect(entries.getByRole("heading", { name: labels.ruleHeading, exact: true })).toBeFocused();
          await missing.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${shots}/counts-${locale}.png` });
        }
      }
    }
    expect(await list()).toEqual(stored);

    for (const locale of ["zh-CN", "en"] as const) {
      await context.addCookies([{ name: "geo-lead-quality-unavailable", value: "1", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toBeVisible();
      for (const value of [brandName, copy[locale].qualified, copy[locale].referral, "Private lead quality fixture failure"]) {
        await expect(main).not.toContainText(value);
      }
      await expect(main.getByRole("form")).toHaveCount(0);
      const reload = main.getByRole("link", { name: copy[locale].reload, exact: true });
      await checkLayout(page, reload, 375, `read-failure-${locale}`);
      await context.clearCookies({ name: "geo-lead-quality-unavailable" });
      await activate(page, reload);
      await expect(main.getByText(copy[locale].qualified, { exact: true })).toBeVisible();
    }
    expect(await list()).toEqual(stored);

    const stranger = await outsider.newPage();
    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        const strangerMain = await visit(stranger, locale, width);
        await expect(strangerMain).not.toContainText(brandName);
        await expect(strangerMain.getByRole("form")).toHaveCount(0);
        await checkLayout(stranger, strangerMain.getByRole("link", { name: copy[locale].setup }), width, `no-brand-${locale}`);
      }
    }
    const denied = await outsider.request.get(`${api}?brandId=${brandId}`, { headers });
    expect(denied.status()).toBe(404);
    const deniedWrite = await outsider.request.post(ruleApi, {
      headers, data: { brandId, requiresRealNeed: true, requiresIndustry: true, requiresFollowUp: true },
    });
    const deniedFreeze = await outsider.request.post(`${ruleApi}/${ruleId}/freeze`, { headers, data: {} });
    expect(deniedWrite.status()).toBe(404);
    expect(deniedFreeze.status()).toBe(404);
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
                 exists (select 1 from lead_validity_rule where owner_id = ${userId}) as rule,
                 exists (select 1 from lead_qualification where owner_id = ${userId}) as judgment,
                 exists (select 1 from lead_observation where owner_id = ${userId}) as observation`;
        expect(remaining).toEqual({ account: false, brand: false, rule: false, judgment: false, observation: false });
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
