import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const longTitle = `w${"w".repeat(179)}`;
const longPage = `https://content-version.example.com/${"w".repeat(180)}`;

const copy = {
  "zh-CN": {
    title: "稿件详情",
    draftTask: "这篇稿件仍是待审草稿。先提交审核；生成不会自动批准。",
    reviewTask: "这篇稿件正在审核。批准或拒绝都会留下记录，批准不等于公开发布。",
    submit: "提交审核",
    approve: "批准（自审）",
    reject: "拒绝",
    related: "相关入口",
    unavailable: "暂时无法读取这篇稿件。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
    fingerprint: "批准指纹",
    body: "正文（Markdown）",
    titleField: "标题",
  },
  en: {
    title: "Version detail",
    draftTask: "This draft still needs review. Submit it before approval. Generation does not approve it.",
    reviewTask: "This draft is in review. Approval and rejection are both recorded. Approval is not publication.",
    submit: "Submit for review",
    approve: "Approve (self-review)",
    reject: "Reject",
    related: "Related entries",
    unavailable: "This draft could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
    fingerprint: "Approval fingerprint",
    body: "Body (Markdown)",
    titleField: "Title",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content version visual test", email, password: randomBytes(24).toString("base64url"),
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

test("content version keeps the next review action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/content-version";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-version-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-version-other-${randomUUID()}@example.invalid`;
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
          name: "合成稿件品牌", description: "仅用于稿件版本隔离验收的合成品牌。",
          website: "https://content-version.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(savedBrand.ok(), savedBrand.ok() ? "" : await savedBrand.text()).toBeTruthy();
    const brandId = (await savedBrand.json()).id as string;
    const factId = randomUUID();
    const factFields = {
      category: "price", title: "合成报价", claim: "合成说明售价 100 CNY",
      sourceType: "internal", sourceReference: "合成附件说明", sourceLocator: "第 1 节",
      sourceExcerpt: "仅用于隔离验收的报价摘录", sourceDate: "2026-11-20",
      permission: "public", validity: "dated", validThrough: "2027-06-30",
      pasteId: null, pasteSpan: null,
    };
    for (const command of [
      { action: "create", id: factId, previousId: null, fields: factFields },
      { action: "submit", id: factId, revision: 1 },
      { action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false },
    ]) {
      const saved = await context.request.post(`/api/brands/${brandId}/facts`, {
        headers: { Origin: origin }, data: command,
      });
      expect(saved.ok(), saved.ok() ? "" : await saved.text()).toBeTruthy();
    }
    const brief = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: {
        action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: "稿件版本",
        fields: {
          audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
          applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: longPage,
          conversionAction: "阅读合成说明", templateKind: "fact_faq",
          titleCandidates: [longTitle], factVersionIds: [factId], competitorSource: null,
        },
      },
    });
    expect(brief.ok(), brief.ok() ? "" : await brief.text()).toBeTruthy();
    const briefId = (await brief.json()).briefId as string;
    const confirmed = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "confirm-brief", brandId, briefId, operationId: randomUUID() },
    });
    expect(confirmed.ok(), confirmed.ok() ? "" : await confirmed.text()).toBeTruthy();
    const generated = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "generate-batch", brandId, operationId: randomUUID(), briefIds: [briefId] },
    });
    expect(generated.ok(), generated.ok() ? "" : await generated.text()).toBeTruthy();
    const generatedBody = await generated.json();
    const versionId = (generatedBody.units as Array<{ contentVersionId: string | null }>)
      .find((unit) => unit.contentVersionId)?.contentVersionId ?? "";
    expect(versionId).toMatch(/^[0-9a-f-]{36}$/);
    const href = `/dashboard/content/versions/${versionId}`;

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByText(current.draftTask, { exact: true })).toBeVisible();
        const submit = main.getByRole("button", { name: current.submit, exact: true });
        await expect(submit).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.approve, exact: true })).toHaveCount(0);
        await expect(main.getByRole("button", { name: current.reject, exact: true })).toHaveCount(0);
        await expect(main.getByText("draft", { exact: true })).toBeVisible();
        await expect(main.locator("section").filter({ has: page.getByRole("heading", { name: current.titleField, exact: true }) }).getByText(longTitle, { exact: true })).toBeVisible();
        await expect(main.getByText(current.fingerprint, { exact: false }).first()).toBeVisible();
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        expect(await main.getByRole("textbox", { name: current.body, exact: true }).inputValue()).toContain(longPage);
        if (width === 375) {
          await expect(submit).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-version-draft-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].submit, exact: true }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole("main").getByText("in_review", { exact: true })).toBeVisible();

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByText(current.reviewTask, { exact: true })).toBeVisible();
        const approve = main.getByRole("button", { name: current.approve, exact: true });
        await expect(approve).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.submit, exact: true })).toHaveCount(0);
        await expect(main.getByRole("button", { name: current.reject, exact: true })).toHaveCount(1);
        await expect(main.getByText("in_review", { exact: true })).toBeVisible();
        await expect(main.locator("section").filter({ has: page.getByRole("heading", { name: current.titleField, exact: true }) }).getByText(longTitle, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(approve).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-version-review-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-version-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(longTitle)).toHaveCount(0);
    await expect(failed.getByText(copy.en.fingerprint)).toHaveCount(0);
    await expect(failed.getByRole("textbox", { name: copy.en.body, exact: true })).toHaveCount(0);
    await expect(failed.getByText(longPage)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-version-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-version-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText("in_review", { exact: true })).toBeVisible();
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: copy.en.titleField, exact: true }) }).getByText(longTitle, { exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(longTitle)).toHaveCount(0);
    await expect(stranger.getByText(versionId)).toHaveCount(0);
    await expect(stranger.getByText(longPage)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/content-version-hidden-en-375.png`, fullPage: false });
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
