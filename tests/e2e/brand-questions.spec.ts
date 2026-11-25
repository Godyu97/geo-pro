import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成问题品牌-${"LongSegment_".repeat(4)}end`;
const longWebsite = `https://brand-questions.example.com/guide/${"segment-".repeat(16)}page`;
const longComparisonQuestion = `${brandName} 与另一方案相比有哪些长期边界_${"LongQuestionToken_".repeat(4)}end`;
const longEditedQuestion = `长期维护边界与售后条件确认_${"LongEditedToken_".repeat(4)}end`;

const copy = {
  "zh-CN": {
    title: "监测问题",
    loading: "正在加载监测问题…",
    unavailable: "暂时无法读取或保存。请刷新核对结果后重试。",
    reload: "重新载入",
    back: "返回品牌资料",
    related: "相关入口",
    browseCandidates: "浏览默认候选",
    browseVersions: "查看已冻结版本",
    addCandidate: "加入草稿",
    addQuestion: "手工加题",
    audience1: "问题簇 1 受众",
    intent1: "问题簇 1 意图",
    primaryPage: "主页面（可待补）",
    questionType: "题型",
    pasteLines: "逐行粘贴题目",
    addPaste: "加入粘贴的题目",
    remove: "移除",
    save: "保存草稿",
    saving: "正在保存…",
    saved: "已保存。",
    freeze: "冻结题集",
    duplicate: "规范化空白后完全相同的题目不能保存。",
    exclusion: "复测需排除的变更题",
    emptyQuestions: "还没有题目。可使用候选、逐行粘贴或手工输入。",
    emptyVersions: "还没有冻结版本。",
    missing: "找不到这个页面",
  },
  en: {
    title: "Monitoring questions",
    loading: "Loading monitoring questions…",
    unavailable: "The questions could not be read or saved. Refresh and check the result before trying again.",
    reload: "Reload",
    back: "Back to brand details",
    related: "Related entries",
    browseCandidates: "Browse default candidates",
    browseVersions: "View frozen versions",
    addCandidate: "Add to draft",
    addQuestion: "Add a question manually",
    audience1: "Cluster 1 audience",
    intent1: "Cluster 1 intent",
    primaryPage: "Primary page (can be added later)",
    questionType: "Question type",
    pasteLines: "Paste questions one per line",
    addPaste: "Add pasted lines",
    remove: "Remove",
    save: "Save draft",
    saving: "Saving…",
    saved: "Saved.",
    freeze: "Freeze question set",
    duplicate: "Questions that match after whitespace normalization cannot be saved.",
    exclusion: "Changed questions excluded from a comparable retest",
    emptyQuestions: "No questions yet. Use a candidate, paste lines, or type one.",
    emptyVersions: "No frozen version yet.",
    missing: "Page not found",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Brand questions visual test",
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

test("brand questions keeps visual consistency, double-submit guard, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_BRAND_QUESTIONS_SCREENSHOTS || ".cache/issue-135/brand-questions";
  const ownerEmail = `brand-questions-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-questions-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];

  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    const createdBrand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: accounts[0].userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "合成品牌监测问题视觉与交互验收资料。",
          website: longWebsite,
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(createdBrand.status()).toBe(200);
    const { id: brandId } = await createdBrand.json();
    const detailHref = `/dashboard/brands/${brandId}`;
    const questionsHref = `${detailHref}/questions`;

    // 1. Empty state across zh-CN / en and 375 / 768 / 1440px, navigated from brand detail
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(detailHref);
    const navLink = page.getByRole("main").getByRole("link", { name: copy["zh-CN"].title, exact: true });
    await activateFromKeyboard(page, navLink);
    await expect(page).toHaveURL(questionsHref);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(questionsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyQuestions, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyVersions, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        const browseCandidates = main.getByRole("link", { name: t.browseCandidates, exact: true });
        await expect(browseCandidates).toBeVisible();
        if (width === 375) {
          await expect(browseCandidates).toBeInViewport();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 2. Add candidates, cluster, manual long comparison question, duplicate check, slow double-Enter guard, freeze v1 & v2
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(questionsHref);
    const zh = copy["zh-CN"];
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole("button", { name: zh.addCandidate, exact: true }).nth(index).click();
    }
    await page.getByLabel(zh.audience1, { exact: true }).fill("合成受众");
    await page.getByLabel(zh.intent1, { exact: true }).fill("比较长期维护与成本限制");
    await page.getByLabel(zh.primaryPage, { exact: true }).fill(longWebsite);
    for (const label of ["题目 1 状态", "题目 2 状态", "题目 3 状态"]) {
      await page.getByLabel(label, { exact: true }).selectOption("confirmed");
    }
    await page.getByRole("button", { name: zh.addQuestion, exact: true }).click();
    await page.getByLabel("题目 4 文本", { exact: true }).fill(longComparisonQuestion);
    const question4 = page.getByRole("group", { name: "题目 4 文本" });
    await question4.getByRole("combobox", { name: zh.questionType, exact: true }).selectOption("comparison");
    await question4.getByRole("combobox", { name: "题目 4 状态", exact: true }).selectOption("confirmed");

    // Verify duplicate whitespace check before slow save
    const firstQuestion = await page.getByLabel("题目 1 文本", { exact: true }).inputValue();
    await page.getByLabel(zh.pasteLines, { exact: true }).fill(`  ${firstQuestion}  `);
    await page.getByRole("button", { name: zh.addPaste, exact: true }).click();
    await expect(page.getByLabel("题目 5 文本", { exact: true })).toHaveValue(firstQuestion.trim());
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.save, exact: true }));
    await expect(page.getByText(zh.duplicate, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: zh.remove, exact: true }).last().click();
    await expect(page.getByLabel("题目 5 文本", { exact: true })).toHaveCount(0);

    // Slow write + rapid double-Enter must send only 1 POST request
    let questionPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith(`/api/brands/${brandId}/questions`)) questionPosts += 1;
    });
    await context.addCookies([{ name: "geo-brand-questions-write", value: "slow", url: origin }]);
    const saveButton = page.getByRole("button", { name: zh.save, exact: true });
    await saveButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: zh.saving, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByText(zh.saved, { exact: true })).toBeVisible();
    expect(questionPosts).toBe(1);
    await context.clearCookies({ name: "geo-brand-questions-write" });

    // Freeze v1 and then edit question 1 and freeze v2 to verify exclusion list
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.freeze, exact: true }));
    await expect(page).toHaveURL(/version=/);
    await page.getByLabel("题目 1 文本", { exact: true }).fill(longEditedQuestion);
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.freeze, exact: true }));
    await expect(page.getByRole("heading", { name: zh.exclusion, exact: true })).toBeVisible();
    const exclusion = page.getByRole("heading", { name: zh.exclusion, exact: true }).locator("xpath=following-sibling::ul[1]");
    await expect(exclusion.getByRole("listitem")).toHaveCount(1);
    await expect(exclusion.getByRole("listitem")).toHaveText(longEditedQuestion);

    // Populated layout across zh-CN / en and 375 / 768 / 1440px
    const populatedUrl = page.url();
    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(populatedUrl);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        const browseVersions = main.getByRole("link", { name: t.browseVersions, exact: true });
        await expect(browseVersions).toBeVisible();
        await expect(main.getByText(longEditedQuestion, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(longComparisonQuestion, { exact: true }).first()).toBeVisible();
        if (width === 375) {
          await expect(browseVersions).toBeInViewport();
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 3. Cross-account isolation
    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(populatedUrl);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(longEditedQuestion)).toHaveCount(0);
    await expectNoOverflow(stranger);

    // 4. Slow/unavailable read shows loading skeleton, hides brand & question data, and recovers on keyboard Reload
    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-questions-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(populatedUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(longEditedQuestion)).toHaveCount(0);
      await expect(failed.getByText(longComparisonQuestion)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-questions-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
  }
});
