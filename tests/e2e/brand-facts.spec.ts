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
const brandName = `合成事实品牌-${"LongSegment_".repeat(4)}end`;
const longSourceUrl = `https://brand-facts.example.com/spec/${"segment-".repeat(16)}doc`;
const longClaim = `合成设备每分钟可完成 120 次高频校准验证，${"仅用于隔离视觉走查的长文本声明。".repeat(4)}END`;
const originalMaterial = `${longClaim}\n第二条合成规格说明`;

const copy = {
  "zh-CN": {
    title: "事实与材料",
    loading: "正在加载事实与材料…",
    unavailable: "暂时无法读取或保存。请刷新核对结果后重试。",
    reload: "重新载入",
    back: "返回品牌资料",
    related: "相关入口",
    startPaste: "粘贴并切分材料",
    newFactAction: "录入事实",
    browseFacts: "查看事实版本",
    reviewCurrentFact: "核对当前事实",
    emptyFacts: "还没有事实记录。可填写下方表单，或从原文拆卡。",
    originalLabel: "粘贴或编辑材料原文",
    preview: "按行预览候选",
    savePaste: "保存原文",
    useCandidate: "用此片段建卡",
    factTitle: "简称",
    saveDraft: "保存草稿",
    submit: "提交待确认",
    pendingConfirmation: "待确认",
    evidenceToComplete: "需要补齐的证据",
    sourceType: "来源类型",
    sourceReference: "来源网址或材料说明",
    sourceLocator: "出处位置（页码、段落或章节）",
    sourceDate: "来源日期",
    permission: "主张公开许可",
    validity: "有效期",
    saveEdits: "保存候选修改",
    acknowledge: "我已逐条核对主张、来源和公开许可。",
    approve: "确认此版本",
    approved: "已批准",
    acknowledgeRevoke: "我确认撤销此版本，并已核对相关影响。",
    revoke: "撤销此版本",
    revoked: "已撤销",
    saving: "正在保存…",
    saved: "已保存。",
    missing: "找不到这个页面",
  },
  en: {
    title: "Facts and materials",
    loading: "Loading facts and materials…",
    unavailable: "Reading or saving is temporarily unavailable. Refresh to check the result before trying again.",
    reload: "Reload",
    back: "Back to brand details",
    related: "Related entries",
    startPaste: "Paste source text",
    newFactAction: "Enter a fact",
    browseFacts: "View fact versions",
    reviewCurrentFact: "Review current fact",
    emptyFacts: "No facts yet. Fill in the form below or make a candidate from pasted material.",
    originalLabel: "Paste or edit source text",
    preview: "Preview candidates by line",
    savePaste: "Save original",
    useCandidate: "Use this segment",
    factTitle: "Short name",
    saveDraft: "Save draft",
    submit: "Submit for confirmation",
    pendingConfirmation: "Pending confirmation",
    evidenceToComplete: "Evidence to complete",
    sourceType: "Source type",
    sourceReference: "Source URL or material description",
    sourceLocator: "Location (page, paragraph, or section)",
    sourceDate: "Source date",
    permission: "Permission to publish the claim",
    validity: "Validity",
    saveEdits: "Save candidate changes",
    acknowledge: "I reviewed this claim, its evidence, and its publication permission.",
    approve: "Approve this version",
    approved: "Approved",
    acknowledgeRevoke: "I reviewed the impact and confirm revocation of this version.",
    revoke: "Revoke this version",
    revoked: "Revoked",
    saving: "Saving…",
    saved: "Saved.",
    missing: "Page not found",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Brand facts visual test",
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

test("brand facts keeps visual consistency, double-submit guard, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_BRAND_FACTS_SCREENSHOTS || ".cache/issue-135/brand-facts";
  const ownerEmail = `brand-facts-${randomUUID()}@example.invalid`;
  const outsiderEmail = `brand-facts-other-${randomUUID()}@example.invalid`;
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
          description: "合成品牌事实视觉与交互验收资料。",
          website: longSourceUrl,
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
    const factsHref = `${detailHref}/facts`;

    // 1. Empty state across zh-CN / en and 375 / 768 / 1440px, navigated from brand detail
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(detailHref);
    const navLink = page.getByRole("main").getByRole("link", { name: copy["zh-CN"].title, exact: true });
    await activateFromKeyboard(page, navLink);
    await expect(page).toHaveURL(factsHref);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(factsHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyFacts, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        const startPaste = main.getByRole("link", { name: t.startPaste, exact: true });
        await expect(startPaste).toBeVisible();
        if (width === 375) {
          await expect(startPaste).toBeInViewport();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // 2. Paste, preview, save original, split candidate, save draft, submit, complete evidence, slow approve guard, revoke
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(factsHref);
    const zh = copy["zh-CN"];
    await page.getByLabel(zh.originalLabel, { exact: true }).fill(originalMaterial);
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.preview, exact: true }));
    await expect(page.getByText(longClaim, { exact: true })).toBeVisible();
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.savePaste, exact: true }));
    await expect(page).toHaveURL(/paste=/);
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.useCandidate, exact: true }).first());
    const shortTitle = "高频校准规格长名称测试";
    await page.getByLabel(zh.factTitle, { exact: true }).fill(shortTitle);
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.saveDraft, exact: true }));
    await expect(page).toHaveURL(/fact=/);

    await activateFromKeyboard(page, page.getByRole("button", { name: zh.submit, exact: true }));
    await expect(page.getByRole("heading", { name: zh.evidenceToComplete, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: zh.approve, exact: true })).toBeDisabled();

    // Header primary action adapts to pending confirmation fact
    await page.goto(page.url());
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole("main").getByRole("link", { name: zh.reviewCurrentFact, exact: true })).toBeInViewport();

    // Complete evidence with a very long URL to verify wrapping at 375px
    await page.getByRole("combobox", { name: zh.sourceType, exact: true }).selectOption("url");
    await page.getByLabel(zh.sourceReference, { exact: true }).fill(longSourceUrl);
    await page.getByLabel(zh.sourceLocator, { exact: true }).fill("第 3 章 · 校准表");
    await page.getByLabel(zh.sourceDate, { exact: true }).fill("2026-11-20");
    await page.getByRole("combobox", { name: zh.permission, exact: true }).selectOption("public");
    await page.getByRole("combobox", { name: zh.validity, exact: true }).selectOption("longTerm");
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.saveEdits, exact: true }));
    await expect(page.getByRole("heading", { name: zh.evidenceToComplete, exact: true })).toHaveCount(0);

    // Slow write + rapid double-Enter must send only 1 POST request
    let factPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith(`/api/brands/${brandId}/facts`)) factPosts += 1;
    });
    await page.getByLabel(zh.acknowledge, { exact: true }).check();
    await context.addCookies([{ name: "geo-brand-facts-write", value: "slow", url: origin }]);
    const approveButton = page.getByRole("button", { name: zh.approve, exact: true });
    await approveButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: zh.saving, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByText(zh.approved, { exact: true }).first()).toBeVisible();
    expect(factPosts).toBe(1);
    await context.clearCookies({ name: "geo-brand-facts-write" });

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
        await expect(main.getByRole("link", { name: t.browseFacts, exact: true })).toBeVisible();
        await expect(main.getByText(t.approved, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(longClaim, { exact: true }).first()).toBeVisible();
        if (width === 375) {
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
        }
        await expectNoOverflow(page);
      }
    }

    // Revoke works via keyboard
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(populatedUrl);
    await page.getByLabel(zh.acknowledgeRevoke, { exact: true }).check();
    await activateFromKeyboard(page, page.getByRole("button", { name: zh.revoke, exact: true }));
    await expect(page.getByText(zh.revoked, { exact: true }).first()).toBeVisible();

    // 3. Cross-account isolation
    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(populatedUrl);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(longClaim)).toHaveCount(0);
    await expectNoOverflow(stranger);

    // 4. Slow/unavailable read shows loading skeleton, hides brand & fact data, and recovers on keyboard Reload
    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-brand-facts-read", value: "slow-unavailable", url: origin },
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
      await expect(failed.getByText(longClaim)).toHaveCount(0);
      await expect(failed.getByText(shortTitle)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-brand-facts-read" });
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
