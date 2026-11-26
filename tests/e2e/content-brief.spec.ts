import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const title = "合成巡检说明";
const longPage = `https://content-brief.example.com/${"w".repeat(180)}`;

const copy = {
  "zh-CN": {
    gaps: "先补齐缺失项。确认前不会生成正文。",
    ready: "补证已齐。确认后才能按已记录事实生成待审草稿。",
    confirmed: "Brief 已确认。可以按仍有效的事实生成待审草稿。",
    fill: "补齐受众",
    confirm: "确认 Brief",
    generate: "生成草稿",
    related: "相关入口",
    unavailableTitle: "Brief 详情",
    unavailable: "暂时无法读取这份 Brief。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
    rawGap: "audienceMissing",
  },
  en: {
    gaps: "Fill the missing items first. Nothing is generated before you confirm.",
    ready: "The evidence gaps are filled. Confirm the brief before a draft is generated from the recorded facts.",
    confirmed: "This brief is confirmed. You can generate a draft that still needs review from facts that remain approved.",
    fill: "Fill in the audience",
    confirm: "Confirm brief",
    generate: "Generate draft",
    related: "Related entries",
    unavailableTitle: "Brief detail",
    unavailable: "This brief could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
    rawGap: "audienceMissing",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content brief visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

test("content brief keeps the next action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/content-brief";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-brief-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-brief-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: "合成内容品牌", description: "仅用于内容 Brief 隔离验收的合成品牌。",
          website: "https://content-brief.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(savedBrand.ok(), savedBrand.status() === 200 ? "" : await savedBrand.text()).toBeTruthy();
    const brandId = (await savedBrand.json()).id as string;
    const factVersionId = randomUUID();
    async function saveBrief(audience: string) {
      const response = await context.request.post("/api/content", {
        headers: { Origin: origin },
        data: {
          action: "save-brief-draft",
          brandId,
          operationId: randomUUID(),
          questionCluster: "合成巡检",
          fields: {
            audience,
            targetGap: "FAQ 缺少可核验说明",
            applicableBoundary: "仅合成验收，不用于真实营销",
            primaryPage: longPage,
            conversionAction: "阅读合成说明",
            templateKind: "fact_faq",
            titleCandidates: [title],
            factVersionIds: [factVersionId],
            competitorSource: null,
          },
        },
      });
      expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
      return (await response.json()).briefId as string;
    }
    const gapHref = `/dashboard/content/briefs/${await saveBrief("")}`;
    const readyHref = `/dashboard/content/briefs/${await saveBrief("连锁门店设备负责人")}`;

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(gapHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const gapMain = page.getByRole("main");
        await expect(gapMain).toHaveCount(1);
        await expect(gapMain.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(gapMain.getByText(current.gaps, { exact: true })).toBeVisible();
        await expect(gapMain.getByText(current.rawGap, { exact: true })).toHaveCount(0);
        const fill = gapMain.getByRole("link", { name: current.fill, exact: true });
        await expect(fill).toHaveCount(1);
        await expect(fill).toHaveAttribute("href", "#brief-audience");
        await expect(gapMain.getByRole("button", { name: current.confirm, exact: true })).toHaveCount(0);
        if (width === 375) {
          await expect(fill).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-brief-gaps-${locale}-375.png`, fullPage: false });
        }
        await expect(gapMain.getByRole("navigation", { name: current.related })).toBeVisible();
        await expect(gapMain.getByText(longPage, { exact: true })).toBeVisible();
        await expect(gapMain.getByText("draft", { exact: true })).toBeVisible();
        await expectNoOverflow(page);

        await page.goto(readyHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const ready = page.getByRole("main");
        await expect(ready).toHaveCount(1);
        await expect(ready.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(ready.getByText(current.ready, { exact: true })).toBeVisible();
        const confirm = ready.getByRole("button", { name: current.confirm, exact: true });
        await expect(confirm).toHaveCount(1);
        if (width === 375) {
          await expect(confirm).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-brief-ready-${locale}-375.png`, fullPage: false });
        }
        await expect(ready.getByText(longPage, { exact: true })).toBeVisible();
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(gapHref);
    const audience = page.locator("#brief-audience");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].fill, exact: true }));
    await expect(audience).toBeFocused();

    await page.goto(readyHref);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].confirm, exact: true }));
    await expect(page.getByText("confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText(copy["zh-CN"].confirmed, { exact: true })).toBeVisible();
    const generate = page.getByRole("button", { name: copy["zh-CN"].generate, exact: true });
    await expect(generate).toBeInViewport();
    await expect(page.getByRole("button", { name: copy["zh-CN"].confirm, exact: true })).toHaveCount(0);

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-brief-unavailable", value: "1", url: origin },
    ]);
    await page.goto(readyHref);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.unavailableTitle, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(title, { exact: true })).toHaveCount(0);
    await expect(failed.getByText(longPage)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-brief-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-brief-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("confirmed", { exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(readyHref);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(title, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(longPage)).toHaveCount(0);
    await expectNoOverflow(stranger);
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

test("content plan groups confirmed existing pages, planned targets, unverified history, updates, and gaps in both languages", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-173/content-plans";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-plan-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-plan-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string; brandId?: string }> = [];
  try {
    const ownerId = await register(context, ownerEmail);
    const outsiderId = await register(outsider, outsiderEmail);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    const createBrand = async (ctx: BrowserContext, userId: string, name: string, website: string) => {
      const response = await ctx.request.post("/api/brands", {
        headers: { Origin: origin },
        data: {
          action: "submit", actorId: userId, operationId: randomUUID(), target: null, expectedDraft: null,
          acceptedPolicyVersion: publishedRetentionVersion(),
          fields: {
            name, description: "仅用于内容计划双语隔离验收的合成品牌。",
            website, aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
          },
        },
      });
      expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
      return (await response.json()).id as string;
    };

    const brandA = await createBrand(context, ownerId, "合成计划品牌甲", "https://plan-a.example.com");
    accounts.push({ userId: ownerId, email: ownerEmail, brandId: brandA });
    const brandB = await createBrand(outsider, outsiderId, "合成计划品牌乙", "https://plan-b.example.com");
    accounts.push({ userId: outsiderId, email: outsiderEmail, brandId: brandB });

    const existingUrl = "https://plan-a.example.com/pricing";
    const plannedUrl = "https://plan-a.example.com/planned-guide";
    const legacyUrl = "https://plan-a.example.com/legacy-unverified";
    const foreignUrl = "https://plan-b.example.com/foreign-only";
    const mainCluster = "购买价格簇";
    const plannedCluster = "待发布计划簇";
    const legacyCluster = "历史记录簇";

    execFileSync(process.execPath, [
      "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "content-plan-fixture",
      JSON.stringify({ userId: ownerId, brandId: brandA, ownedUrl: existingUrl, legacyCluster, legacyUrl }),
    ], { stdio: "inherit" });

    const factId = randomUUID();
    const postBrief = async (
      ctx: BrowserContext,
      brandId: string,
      questionCluster: string,
      titleCandidate: string,
      primaryPage: string,
      factVersionIds: string[],
      briefId?: string,
    ) => {
      const response = await ctx.request.post("/api/content", {
        headers: { Origin: origin },
        data: {
          action: "save-brief-draft",
          brandId,
          operationId: randomUUID(),
          ...(briefId ? { briefId } : {}),
          questionCluster,
          fields: {
            audience: "采购决策人",
            targetGap: "补充价格口径说明",
            applicableBoundary: "仅合成验收",
            primaryPage,
            conversionAction: "查看合成说明",
            templateKind: "fact_faq",
            titleCandidates: [titleCandidate],
            factVersionIds,
            competitorSource: null,
          },
        },
      });
      expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
      return (await response.json()).briefId as string;
    };

    const updateBriefTitle = "更新定价页 Brief";
    const gapBriefTitle = "缺承接页 Brief";
    const plannedBriefTitle = "待发布计划 Brief";
    const foreignBriefTitle = "品牌乙私有 Brief";

    const updateBriefId = await postBrief(context, brandA, mainCluster, updateBriefTitle, existingUrl, [factId]);
    const gapBriefId = await postBrief(context, brandA, mainCluster, gapBriefTitle, "", [factId]);
    // Repeat save of the same brief must keep updateBriefId readable without duplicate entries.
    await postBrief(context, brandA, mainCluster, gapBriefTitle, "", [factId], gapBriefId);
    await postBrief(context, brandA, plannedCluster, plannedBriefTitle, plannedUrl, [factId]);
    await postBrief(outsider, brandB, mainCluster, foreignBriefTitle, foreignUrl, [randomUUID()]);

    const planCopy = {
      "zh-CN": {
        plansHeading: "问题簇覆盖",
        existingBadge: "现有页",
        basisOwned: "依据：已确认自有域名引用",
        plannedBadge: "计划",
        needsCheckBadge: "待核对",
        missingPage: "缺少主页面",
        updateLink: `更新现有页 Brief：${updateBriefTitle}`,
        gapLink: `补齐缺口 Brief：${gapBriefTitle}`,
      },
      en: {
        plansHeading: "Question-cluster coverage",
        existingBadge: "Existing page",
        basisOwned: "Basis: confirmed owned-domain citation",
        plannedBadge: "Planned",
        needsCheckBadge: "Needs verification",
        missingPage: "The primary page is missing",
        updateLink: `Update via brief: ${updateBriefTitle}`,
        gapLink: `Complete gap brief: ${gapBriefTitle}`,
      },
    } as const;

    for (const locale of ["zh-CN", "en"] as const) {
      const current = planCopy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/dashboard/content?brandId=${encodeURIComponent(brandA)}`);
        const plans = page.locator("section", { has: page.getByRole("heading", { name: current.plansHeading, exact: true }) });
        await expect(plans).toBeVisible();
        await expect(plans.getByRole("heading", { name: mainCluster, exact: true })).toBeVisible();
        await expect(plans.getByText(existingUrl, { exact: true })).toHaveCount(1);
        await expect(plans.getByText(current.existingBadge, { exact: true })).toHaveCount(1);
        await expect(plans.getByText(current.basisOwned, { exact: true })).toBeVisible();
        await expect(plans.getByRole("link", { name: current.updateLink, exact: true })).toHaveAttribute(
          "href",
          `/dashboard/content/briefs/${updateBriefId}`,
        );
        await expect(plans.getByRole("link", { name: current.gapLink, exact: true })).toHaveAttribute(
          "href",
          `/dashboard/content/briefs/${gapBriefId}`,
        );
        await expect(plans.getByText(current.missingPage, { exact: true })).toBeVisible();
        await expect(plans.getByText(plannedUrl, { exact: true })).toHaveCount(1);
        await expect(plans.getByText(current.plannedBadge, { exact: true })).toBeVisible();
        await expect(plans.getByText(legacyUrl, { exact: true })).toHaveCount(1);
        await expect(plans.getByText(current.needsCheckBadge, { exact: true })).toBeVisible();
        await expect(plans.getByText(foreignUrl)).toHaveCount(0);
        await expect(plans.getByText(foreignBriefTitle)).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await page.screenshot({ path: `${shots}/content-plans-${locale}-375.png`, fullPage: false });
        }
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(`/dashboard/content?brandId=${encodeURIComponent(brandA)}`);
    const updateEntry = page.getByRole("link", { name: planCopy["zh-CN"].updateLink, exact: true });
    await activateFromKeyboard(page, updateEntry);
    await expect(page).toHaveURL(`/dashboard/content/briefs/${updateBriefId}`);
  } finally {
    await outsider.close();
    for (const { userId, email, brandId } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId, email, ...(brandId ? { brandId } : {}) }),
      ], { stdio: "inherit" });
    }
  }
});
