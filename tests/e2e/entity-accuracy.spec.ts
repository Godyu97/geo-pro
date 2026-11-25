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
const brandName = `合成实体核验品牌-${"LongSegment_".repeat(4)}end`;
const longWebsite = `https://entity-accuracy.example.com/${"segment-".repeat(12)}page`;
const longMethod = `随机抽检方法_${"SamplingMethod_".repeat(6)}end`;

const copy = {
  "zh-CN": {
    reviewsTitle: "抽样错误率",
    reviewsLoading: "正在加载抽样错误率…",
    reviewsUnavailable: "暂时无法读取或保存复核，请稍后重试。",
    reviewsInsufficient: "样本不足",
    reviewsInvalid: "复核无效。确认错误数不能大于复核数，过期或冲突事实也不能写成确认错误。",
    appendReview: "追加复核",
    viewSampleSummary: "查看抽样摘要",
    observationId: "观察 ID",
    analysisVersionId: "分析版本 ID",
    population: "总体条数",
    methodLabel: "抽样方法",
    fact: "事实状态",
    confirmed: "确认错误",
    saveReview: "保存复核",
    saving: "正在保存…",
    savedReview: "复核已保存。",
    correctionsTitle: "同名消歧与纠错",
    correctionsLoading: "正在加载同名消歧与纠错…",
    correctionsUnavailable: "暂时无法读取或保存，请稍后重试。",
    emptyDisambiguation: "还没有消歧修订。",
    emptyCorrection: "还没有纠错记录。动作和效果会分开显示。",
    startDisambiguation: "登记同名消歧",
    viewCorrections: "查看纠错记录",
    priorAnalysisId: "当前分析版本 ID",
    sameSurfaceName: "表面同名",
    confirmedDifferentEntity: "人工确认是另一实体",
    saveDisambiguation: "保存消歧修订",
    disambiguationInvalid: "需要同时确认表面同名和另一实体。只勾选同名时不会新增分析版本。",
    disambiguationSaved: "消歧修订已保存。",
    mentionExcluded: "这次提及不算作目标品牌。",
    actionDone: "动作已完成",
    retestStillWrong: "复测仍然错误",
    saveCorrection: "保存纠错状态",
    correctionSaved: "纠错状态已保存。",
    actionActioned: "动作已完成",
    effectUnresolved: "效果未解决",
    reload: "重新载入",
    back: "返回品牌",
    related: "相关入口",
    missing: "找不到这个页面",
  },
  en: {
    reviewsTitle: "Sampled error rate",
    reviewsLoading: "Loading sampled error rate…",
    reviewsUnavailable: "Reviews cannot be read or saved right now. Try again later.",
    reviewsInsufficient: "Insufficient sample",
    reviewsInvalid: "This review is invalid. Confirmed errors cannot exceed reviewed samples, and expired or conflicting facts cannot be stored as confirmed errors.",
    appendReview: "Append a review",
    viewSampleSummary: "View sample summary",
    observationId: "Observation ID",
    analysisVersionId: "Analysis version ID",
    population: "Population count",
    methodLabel: "Sampling method",
    fact: "Fact state",
    confirmed: "Confirmed error",
    saveReview: "Save review",
    saving: "Saving…",
    savedReview: "Review saved.",
    correctionsTitle: "Same-name disambiguation and correction",
    correctionsLoading: "Loading disambiguation and correction…",
    correctionsUnavailable: "This page cannot be read or saved right now. Try again later.",
    emptyDisambiguation: "No disambiguation has been saved.",
    emptyCorrection: "No correction has been saved. Action and effect stay separate.",
    startDisambiguation: "Record disambiguation",
    viewCorrections: "View corrections",
    priorAnalysisId: "Current analysis version ID",
    sameSurfaceName: "Same surface name",
    confirmedDifferentEntity: "A person confirmed this is a different entity",
    saveDisambiguation: "Save disambiguation",
    disambiguationInvalid: "Confirm both the same surface name and a different entity. Checking only the same name does not add an analysis version.",
    disambiguationSaved: "Disambiguation revision saved.",
    mentionExcluded: "This mention does not count as the target brand.",
    actionDone: "Action completed",
    retestStillWrong: "Retest is still wrong",
    saveCorrection: "Save correction status",
    correctionSaved: "Correction status saved.",
    actionActioned: "Action completed",
    effectUnresolved: "Effect unresolved",
    reload: "Reload",
    back: "Back to brand",
    related: "Related entries",
    missing: "Page not found",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Entity accuracy visual test",
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

test("entity reviews and corrections keep visual consistency, guards, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_ENTITY_ACCURACY_SCREENSHOTS || ".cache/issue-135/entity-accuracy";
  const ownerEmail = `entity-accuracy-${randomUUID()}@example.invalid`;
  const outsiderEmail = `entity-accuracy-other-${randomUUID()}@example.invalid`;
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
          description: "合成实体核验与纠错视觉验收资料。",
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

    const seededManual = await context.request.post("/api/monitoring/answers", {
      headers,
      data: {
        action: "submit-manual",
        brandId,
        operationId: randomUUID(),
        questionText: "合成问题：同行业里有哪些工业传感器品牌？",
        answerText: `合成回答文本：${brandName} 是本地同名实体，不是目标企业。`,
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: "unknown",
        entityVersion: 1,
        citationSetState: "complete",
        citations: [],
        locatorRef: "fixture-entity-accuracy-screen",
        collectorId: "fixture-operator",
        contested: false,
        brandName,
        aliases: [],
        officialWebsite: longWebsite,
        mentioned: "true",
        recommended: "false",
        officialSiteCited: "false",
      },
    });
    expect(seededManual.status()).toBe(200);
    const manualBody = await seededManual.json();
    const observationId = manualBody.observation.id as string;
    const priorAnalysisId = manualBody.latestAnalysis.id as string;

    const detailHref = `/dashboard/brands/${brandId}`;
    const reviewsHref = `${detailHref}/entity-reviews`;
    const correctionsHref = `${detailHref}/entity-corrections`;

    // 1. Navigate from brand detail to entity-reviews by keyboard and check empty state across locales & viewports
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(detailHref);
    const reviewsNav = page.getByRole("main").getByRole("link", { name: copy["zh-CN"].reviewsTitle, exact: true });
    await activateFromKeyboard(page, reviewsNav);
    await expect(page).toHaveURL(reviewsHref);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(reviewsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.reviewsTitle, exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.reviewsInsufficient, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        const primary = main.getByRole("link", { name: t.appendReview, exact: true });
        await expect(primary).toBeVisible();
        if (width === 375) {
          await expect(primary).toBeInViewport();
          await capture(page, screenshotDir, `reviews-empty-${locale}-375.png`);
        }
        const mainText = await main.innerText();
        expect(mainText.includes("%")).toBe(false);
        await expectNoOverflow(page);
      }
    }

    // 2. Entity reviews: reject invalid fact+confirmed while preserving inputs, then slow double-Enter guard, then populated layout
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(reviewsHref);
    const zh = copy["zh-CN"];
    await page.getByLabel(zh.observationId, { exact: true }).fill(observationId);
    await page.getByLabel(zh.analysisVersionId, { exact: true }).fill(priorAnalysisId);
    await page.getByLabel(zh.population, { exact: true }).fill("20");
    await page.getByLabel(zh.methodLabel, { exact: true }).fill(longMethod);
    await page.getByLabel(zh.fact, { exact: true }).selectOption("expired");
    await page.getByLabel(zh.confirmed, { exact: true }).check();
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.saveReview, exact: true }));
    await expect(page.getByRole("main").getByRole("alert")).toContainText(zh.reviewsInvalid);
    await expect(page.getByLabel(zh.observationId, { exact: true })).toHaveValue(observationId);
    await expect(page.getByLabel(zh.methodLabel, { exact: true })).toHaveValue(longMethod);

    await page.getByLabel(zh.fact, { exact: true }).selectOption("active");
    let reviewPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith(`/api/brands/${brandId}/entity-reviews`)) reviewPosts += 1;
    });
    await context.addCookies([{ name: "geo-entity-reviews-write", value: "slow", url: origin }]);
    const saveReviewBtn = page.getByRole("button", { name: zh.saveReview, exact: true });
    await saveReviewBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: zh.saving, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("status")).toContainText(zh.savedReview);
    expect(reviewPosts).toBe(1);
    await context.clearCookies({ name: "geo-entity-reviews-write" });

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(reviewsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        const primary = main.getByRole("link", { name: t.viewSampleSummary, exact: true });
        await expect(primary).toBeVisible();
        await expect(main.getByText("1/1").first()).toBeVisible();
        await expect(main.getByText("1/20").first()).toBeVisible();
        await expect(main.getByText(longMethod).first()).toBeVisible();
        const mainText = await main.innerText();
        expect(mainText.includes("%")).toBe(false);
        if (width === 375) {
          await expect(primary).toBeInViewport();
          await capture(page, screenshotDir, `reviews-populated-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 3. Navigate from brand detail to entity-corrections by keyboard and check empty state across locales & viewports
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(detailHref);
    const correctionsNav = page.getByRole("main").getByRole("link", { name: zh.correctionsTitle, exact: true });
    await activateFromKeyboard(page, correctionsNav);
    await expect(page).toHaveURL(correctionsHref);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(correctionsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.correctionsTitle, exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyDisambiguation, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyCorrection, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        const primary = main.getByRole("link", { name: t.startDisambiguation, exact: true });
        await expect(primary).toBeVisible();
        if (width === 375) {
          await expect(primary).toBeInViewport();
          await capture(page, screenshotDir, `corrections-empty-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 4. Entity corrections: same-name only rejection preserves inputs, slow double-Enter disambiguation & correction, populated layout
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(correctionsHref);
    const disambigForm = page.locator("#entity-disambiguation-form");
    await disambigForm.getByLabel(zh.observationId, { exact: true }).fill(observationId);
    await disambigForm.getByLabel(zh.priorAnalysisId, { exact: true }).fill(priorAnalysisId);
    await disambigForm.getByLabel(zh.sameSurfaceName, { exact: true }).check();
    await activateFromKeyboard(page, disambigForm.getByRole("button", { name: zh.saveDisambiguation, exact: true }));
    await expect(page.getByRole("main").getByRole("alert")).toContainText(zh.disambiguationInvalid);
    await expect(disambigForm.getByLabel(zh.observationId, { exact: true })).toHaveValue(observationId);
    await expect(disambigForm.getByLabel(zh.priorAnalysisId, { exact: true })).toHaveValue(priorAnalysisId);

    await disambigForm.getByLabel(zh.confirmedDifferentEntity, { exact: true }).check();
    let disambigPosts = 0;
    let correctionPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith(`/api/brands/${brandId}/entity-disambiguations`)) disambigPosts += 1;
      if (req.method() === "POST" && req.url().endsWith(`/api/brands/${brandId}/entity-corrections`)) correctionPosts += 1;
    });
    await context.addCookies([{ name: "geo-entity-corrections-write", value: "slow", url: origin }]);
    const saveDisambigBtn = disambigForm.getByRole("button", { name: zh.saveDisambiguation, exact: true });
    await saveDisambigBtn.focus();
    await page.keyboard.press("Enter");
    await expect(disambigForm.getByRole("button", { name: zh.saving, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("status").first()).toContainText(zh.disambiguationSaved);
    expect(disambigPosts).toBe(1);

    const correctionForm = page.locator("#entity-correction-form");
    await correctionForm.getByLabel(zh.observationId, { exact: true }).fill(observationId);
    await correctionForm.getByLabel(zh.actionDone, { exact: true }).check();
    await correctionForm.getByLabel(zh.retestStillWrong, { exact: true }).check();
    const saveCorrectionBtn = correctionForm.getByRole("button", { name: zh.saveCorrection, exact: true });
    await saveCorrectionBtn.focus();
    await page.keyboard.press("Enter");
    await expect(correctionForm.getByRole("button", { name: zh.saving, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("status").last()).toContainText(zh.correctionSaved);
    expect(correctionPosts).toBe(1);
    await context.clearCookies({ name: "geo-entity-corrections-write" });

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(correctionsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        const primary = main.getByRole("link", { name: t.viewCorrections, exact: true });
        await expect(primary).toBeVisible();
        await expect(main.getByText(t.mentionExcluded, { exact: true })).toBeVisible();
        const correctionDl = main.locator("#entity-correction-section dl");
        await expect(correctionDl.getByText(t.actionActioned, { exact: true })).toBeVisible();
        await expect(correctionDl.getByText(t.effectUnresolved, { exact: true })).toBeVisible();
        const mainText = await main.innerText();
        expect(mainText.includes("已解决")).toBe(false);
        expect(mainText.includes("Resolved")).toBe(false);
        if (width === 375) {
          await expect(primary).toBeInViewport();
          await capture(page, screenshotDir, `corrections-populated-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 5. Cross-account isolation on both routes
    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    for (const route of [reviewsHref, correctionsHref]) {
      await stranger.goto(route);
      await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
      await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(stranger.getByText(observationId)).toHaveCount(0);
      await expectNoOverflow(stranger);
    }

    // 6. Slow/unavailable read shows loading skeleton, hides brand & sample/revision data, and recovers on keyboard Reload
    for (const spec of [
      {
        href: reviewsHref,
        cookieName: "geo-entity-reviews-read",
        prefix: "reviews",
        titleKey: "reviewsTitle" as const,
        loadingKey: "reviewsLoading" as const,
        unavailableKey: "reviewsUnavailable" as const,
        hiddenText: longMethod,
      },
      {
        href: correctionsHref,
        cookieName: "geo-entity-corrections-read",
        prefix: "corrections",
        titleKey: "correctionsTitle" as const,
        loadingKey: "correctionsLoading" as const,
        unavailableKey: "correctionsUnavailable" as const,
        hiddenText: observationId,
      },
    ]) {
      for (const locale of locales) {
        const t = copy[locale];
        await context.addCookies([
          { name: "geo-locale", value: locale, url: origin },
          { name: spec.cookieName, value: "slow-unavailable", url: origin },
        ]);
        await page.setViewportSize({ width: 375, height: 800 });
        const nav = page.goto(spec.href, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("status", { name: t[spec.loadingKey] })).toBeVisible();
        await capture(page, screenshotDir, `${spec.prefix}-loading-${locale}-375.png`);
        await nav;
        const failed = page.getByRole("main");
        await expect(failed.getByRole("heading", { name: t[spec.titleKey], exact: true })).toBeVisible();
        await expect(failed.getByRole("alert")).toContainText(t[spec.unavailableKey]);
        await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
        await expect(failed.getByText(spec.hiddenText)).toHaveCount(0);
        const reload = failed.getByRole("link", { name: t.reload, exact: true });
        await expect(reload).toBeInViewport();
        await expectNoOverflow(page);
        await capture(page, screenshotDir, `${spec.prefix}-unavailable-${locale}-375.png`);
        await context.clearCookies({ name: spec.cookieName });
        await activateFromKeyboard(page, reload);
        await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
      }
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
