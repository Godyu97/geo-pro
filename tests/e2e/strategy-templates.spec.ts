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
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const stamp = "2026-11-25T10:00:00.000Z";
const brandName = `合成策略品牌-${"LongBrand_".repeat(5)}end`;
const industryName = `合成策略行业-${"LongIndustry_".repeat(6)}end`;
const failureText = `上次失败记录-${"LongFailure_".repeat(8)}end`;
const samplingText = "目标城市上海，实际采样未声明定位";
const keptExplanation = "先按采样条件记录一次观察。";
const mixedExplanation = `${keptExplanation}高胜率必有效。`;
const keptIndustry = "保留这段行业";

const copy = {
  "zh-CN": {
    assistantNav: "每周行动",
    toggle: "切换侧边导航",
    strategies: "策略模板",
    title: "策略模板",
    noBrand: "先完成一个活跃品牌的建档，再保存策略模板。",
    openBrand: "去建档",
    emptyTask: "还没有模板。下一步是填写观察条件并保存。",
    savedTask: "已有模板。下一步是查看已保存的观察。",
    fillTemplate: "填写模板",
    viewTemplates: "查看模板",
    related: "相关入口",
    industry: "适用行业",
    sampling: "采样条件",
    successes: "成功观察次数",
    strength: "证据强度",
    failure: "失败案例",
    explanation: "模板说明",
    materials: "起草材料",
    save: "保存模板",
    draft: "起草并保存",
    listHeading: "已保存模板",
    observation: "观察案例",
    notGuaranteed: "不保证收益",
    successLine: "成功观察 1 次",
    invalid: "模板无效。一次成功只能保存为单次观察，并且必须填写失败案例。",
    saving: "正在保存…",
    savedNotice: "观察模板已保存。不保证收益，也没有生成每周行动。",
    loading: "正在读取策略模板…",
    unavailable: "暂时无法读取或保存策略模板，请稍后重试。",
    reload: "重新载入",
    privateFailure: "Private strategy fixture failure",
  },
  en: {
    assistantNav: "Weekly actions",
    toggle: "Toggle sidebar navigation",
    strategies: "Strategy templates",
    title: "Strategy templates",
    noBrand: "Finish an active brand profile before saving a strategy template.",
    openBrand: "Open brands",
    emptyTask: "No template yet. The next step is to enter the observation and save it.",
    savedTask: "A template is already saved. The next step is to review that observation.",
    fillTemplate: "Fill in the template",
    viewTemplates: "View templates",
    related: "Related entries",
    industry: "Industry",
    sampling: "Sampling condition",
    successes: "Successful observations",
    strength: "Evidence strength",
    failure: "Failure case",
    explanation: "Template note",
    materials: "Draft material",
    save: "Save template",
    draft: "Draft and save",
    listHeading: "Saved templates",
    observation: "Observation case",
    notGuaranteed: "No guaranteed return",
    successLine: "1 successful observations",
    invalid: "The template is invalid. One success can only be saved as a single observation, and a failure case is required.",
    saving: "Saving…",
    savedNotice: "The observation template is saved. It does not guarantee a return, and no weekly action was created.",
    loading: "Loading strategy templates…",
    unavailable: "Strategy templates cannot be read or saved right now. Try again later.",
    reload: "Reload",
    privateFailure: "Private strategy fixture failure",
  },
} as const;

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Strategy templates visual test",
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

test("strategy templates keep the next action, one observation, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_STRATEGY_SCREENSHOTS || ".cache/issue-135/strategy-templates";
  const ownerEmail = `strategy-templates-${randomUUID()}@example.invalid`;
  const outsiderEmail = `strategy-templates-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  const sql = openTestDatabase();
  const templateId = randomUUID();
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
    await page.goto("/dashboard");
    await page.getByRole("button", { name: copy["zh-CN"].toggle, exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await activateFromKeyboard(page, dialog.getByRole("link", { name: copy["zh-CN"].assistantNav, exact: true }));
    await expect(page).toHaveURL("/dashboard/assistant");
    await page.goto("/dashboard/assistant/strategies");

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant/strategies");
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toBeVisible();
        const openBrand = main.getByRole("link", { name: t.openBrand, exact: true });
        await expect(openBrand).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByLabel(t.industry)).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(openBrand).toBeInViewport();
          await capture(page, screenshotDir, `nobrand-${locale}-375.png`);
        }
      }
    }

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
          description: "合成策略模板视觉验收资料。",
          website: "https://strategy-templates.example.com/guide",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(createdBrand.status()).toBe(200);
    const created = await createdBrand.json();
    brandId = created.id as string;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        if (locale === "zh-CN" && width === 375) {
          await page.goto("/dashboard/assistant");
          const entry = page.getByRole("main").getByRole("link", { name: t.strategies, exact: true }).first();
          await activateFromKeyboard(page, entry);
          await expect(page).toHaveURL("/dashboard/assistant/strategies");
        } else {
          await page.goto("/dashboard/assistant/strategies");
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toHaveCount(0);
        const fill = main.getByRole("link", { name: t.fillTemplate, exact: true });
        await expect(fill).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(fill).toBeInViewport();
          await activateFromKeyboard(page, fill);
          await expect(page.locator("#strategy-industry")).toBeFocused();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
        }
      }
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/assistant/strategies");
    const saveForm = page.locator("#strategy-save");
    await saveForm.getByLabel(tZh.industry, { exact: true }).fill(keptIndustry);
    await saveForm.getByLabel(tZh.sampling, { exact: true }).fill(samplingText);
    await saveForm.getByLabel(tZh.successes, { exact: true }).fill("1");
    await saveForm.getByLabel(tZh.strength, { exact: true }).selectOption("repeated_observation");
    await saveForm.getByLabel(tZh.failure, { exact: true }).fill("保留失败案例");
    await saveForm.getByLabel(tZh.explanation, { exact: true }).fill("保留说明");
    let savePosts = 0;
    const countSaves = (request: { method: () => string; url: () => string }) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path === "/api/assistant/strategy-templates") savePosts += 1;
    };
    page.on("request", countSaves);
    await saveForm.getByRole("button", { name: tZh.save, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(tZh.invalid);
    await expect(saveForm.getByLabel(tZh.industry, { exact: true })).toHaveValue(keptIndustry);
    expect(savePosts).toBe(0);
    page.off("request", countSaves);

    const draftForm = page.locator("#strategy-draft");
    await draftForm.getByLabel(tZh.industry, { exact: true }).fill("保留起草行业");
    let draftPosts = 0;
    const countDrafts = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assistant/strategy-templates/draft") {
        draftPosts += 1;
      }
    };
    page.on("request", countDrafts);
    await draftForm.getByRole("button", { name: tZh.draft, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(tZh.invalid);
    await expect(draftForm.getByLabel(tZh.industry, { exact: true })).toHaveValue("保留起草行业");
    expect(draftPosts).toBe(0);
    page.off("request", countDrafts);

    await sql`
      INSERT INTO strategy_template (
        id, brand_id, owner_id, industry, sampling_condition, evidence_strength,
        failure_case, explanation, strategy_label, guaranteed, successes, created_at, updated_at
      ) VALUES (
        ${templateId}, ${brandId}, ${ownerId}, ${industryName}, ${samplingText}, 'single_observation',
        ${failureText}, ${keptExplanation}, 'observation', 0, 1, ${stamp}, ${stamp}
      )
    `;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant/strategies");
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(t.savedTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { level: 2, name: t.listHeading, exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { level: 3, name: industryName, exact: true })).toBeVisible();
        await expect(main.getByText(failureText, { exact: true })).toBeVisible();
        await expect(main.getByText(t.observation, { exact: true })).toBeVisible();
        await expect(main.getByText(t.notGuaranteed, { exact: true })).toBeVisible();
        await expect(main.getByText(t.successLine, { exact: true })).toBeVisible();
        const view = main.getByRole("link", { name: t.viewTemplates, exact: true });
        await expect(view).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(view).toBeInViewport();
          await activateFromKeyboard(page, view);
          await expect(page.locator("#main-content #strategy-list")).toBeFocused();
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
        }
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-strategy-write", value: "slow", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/assistant/strategies");
    const slowSave = page.locator("#strategy-save");
    await slowSave.getByLabel(tZh.industry, { exact: true }).fill("合成餐饮观察");
    await slowSave.getByLabel(tZh.sampling, { exact: true }).fill(samplingText);
    await slowSave.getByLabel(tZh.successes, { exact: true }).fill("1");
    await slowSave.getByLabel(tZh.strength, { exact: true }).selectOption("single_observation");
    await slowSave.getByLabel(tZh.failure, { exact: true }).fill("上次只记录了一次成功，样本不足以重复观察。");
    await slowSave.getByLabel(tZh.explanation, { exact: true }).fill(mixedExplanation);
    let slowPosts = 0;
    const countSlow = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assistant/strategy-templates") {
        slowPosts += 1;
      }
    };
    page.on("request", countSlow);
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/assistant/strategy-templates" && response.request().method() === "POST"
    ));
    const saveButton = slowSave.getByRole("button", { name: tZh.save, exact: true });
    await saveButton.focus();
    await page.keyboard.press("Enter");
    const saving = slowSave.getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("main").getByText(tZh.savedNotice, { exact: true })).toBeVisible();
    await expect(page.locator("#strategy-list").getByText(keptExplanation, { exact: true })).toHaveCount(2);
    await expect(page.locator("#strategy-list").getByText("高胜率")).toHaveCount(0);
    await expect(slowSave.getByLabel(tZh.explanation, { exact: true })).toHaveValue("");
    expect(slowPosts).toBe(1);
    page.off("request", countSlow);
    const stored = await sql`
      SELECT strategy_label, guaranteed, successes, evidence_strength, explanation
      FROM strategy_template
      WHERE brand_id = ${brandId} AND industry = '合成餐饮观察'
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.strategy_label).toBe("observation");
    expect(Number(stored[0]?.guaranteed)).toBe(0);
    expect(Number(stored[0]?.successes)).toBe(1);
    expect(stored[0]?.evidence_strength).toBe("single_observation");
    expect(stored[0]?.explanation).toBe(keptExplanation);
    const plans = await sql`SELECT id FROM assistant_plan WHERE brand_id = ${brandId}`;
    expect(plans).toHaveLength(0);
    const leaked = await sql`
      SELECT id FROM strategy_template WHERE brand_id = ${brandId} AND explanation LIKE '%高胜率%'
    `;
    expect(leaked).toHaveLength(0);
    await context.clearCookies({ name: "geo-strategy-write" });

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto("/dashboard/assistant/strategies");
    await expect(stranger.getByRole("main").getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(industryName)).toHaveCount(0);
    await expect(stranger.getByText(failureText)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-strategy-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto("/dashboard/assistant/strategies", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(industryName)).toHaveCount(0);
      await expect(failed.getByText(failureText)).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-strategy-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(industryName, { exact: true })).toBeVisible();
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
      expect(await sql`SELECT id FROM strategy_template WHERE id = ${templateId}`).toHaveLength(0);
    }
    await sql.end();
  }
});
