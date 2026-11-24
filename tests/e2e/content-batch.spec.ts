import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const longPage = `https://content-batch.example.com/${"w".repeat(180)}`;

const copy = {
  "zh-CN": {
    title: "批次详情",
    retryTask: "有稿件没有生成。只重试失败项，已成功的版本保持不变。",
    pausedTask: "这一批已暂停。继续会处理仍排队、失败或阻塞的项，已成功的稿件不会重写。",
    completedTask: "本批稿件已生成，仍是待审草稿。",
    retry: "仅重试失败项",
    resume: "继续",
    pause: "暂停",
    open: "查看稿件",
    related: "相关入口",
    units: "批次单元",
    unavailable: "暂时无法读取这个批次。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
    pendingCost: "费用待核对",
    attempts: "尝试 1",
    retried: "尝试 2",
  },
  en: {
    title: "Batch detail",
    retryTask: "Some drafts were not generated. Retry only the failed items. Versions that already succeeded stay the same.",
    pausedTask: "This batch is paused. Resume continues queued, failed, or blocked items and does not rewrite drafts that already succeeded.",
    completedTask: "The drafts in this batch are generated and still need review.",
    retry: "Retry failed only",
    resume: "Resume",
    pause: "Pause",
    open: "View draft",
    related: "Related entries",
    units: "Batch units",
    unavailable: "This batch could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
    pendingCost: "Cost still needs reconciliation",
    attempts: "Attempts 1",
    retried: "Attempts 2",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content batch visual test", email, password: randomBytes(24).toString("base64url"),
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

test("content batch keeps the next action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/content-batch";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-batch-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-batch-other-${randomUUID()}@example.invalid`;
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
          name: "合成批次品牌", description: "仅用于内容批次隔离验收的合成品牌。",
          website: "https://content-batch.example.com", aliases: [],
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

    async function saveBrief(cluster: string) {
      const response = await context.request.post("/api/content", {
        headers: { Origin: origin },
        data: {
          action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: cluster,
          fields: {
            audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
            applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: longPage,
            conversionAction: "阅读合成说明", templateKind: "fact_faq",
            titleCandidates: [`合成批次 ${cluster}`], factVersionIds: [factId], competitorSource: null,
          },
        },
      });
      expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
      const briefId = (await response.json()).briefId as string;
      const confirmed = await context.request.post("/api/content", {
        headers: { Origin: origin },
        data: { action: "confirm-brief", brandId, briefId, operationId: randomUUID() },
      });
      expect(confirmed.ok(), confirmed.ok() ? "" : await confirmed.text()).toBeTruthy();
      return briefId;
    }

    const briefs = await Promise.all(["甲", "乙", "丙", "丁"].map((name) => saveBrief(name)));
    const failedBrief = briefs[2] ?? "";
    const partial = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: {
        action: "generate-batch", brandId, operationId: randomUUID(),
        briefIds: briefs.slice(0, 3), fixtures: { failBriefIds: [failedBrief] },
      },
    });
    expect(partial.ok(), partial.ok() ? "" : await partial.text()).toBeTruthy();
    const partialBody = await partial.json();
    expect(partialBody.batch.status).toBe("partial");
    const succeededVersions = (partialBody.units as Array<{ status: string; contentVersionId: string | null }>)
      .filter((unit) => unit.status === "succeeded" && unit.contentVersionId)
      .map((unit) => `/dashboard/content/versions/${unit.contentVersionId}`);
    expect(succeededVersions).toHaveLength(2);
    const partialHref = `/dashboard/content/batches/${partialBody.batch.id as string}`;
    const paused = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: {
        action: "generate-batch", brandId, operationId: randomUUID(),
        briefIds: briefs.slice(3), fixtures: { pauseAfter: 0 },
      },
    });
    expect(paused.ok(), paused.ok() ? "" : await paused.text()).toBeTruthy();
    const pausedBody = await paused.json();
    expect(pausedBody.batch.status).toBe("paused");
    const pausedHref = `/dashboard/content/batches/${pausedBody.batch.id as string}`;

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(partialHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByText(current.retryTask, { exact: true })).toBeVisible();
        const retry = main.getByRole("button", { name: current.retry, exact: true });
        await expect(retry).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.pause, exact: true })).toHaveCount(0);
        await expect(main.getByRole("button", { name: current.resume, exact: true })).toHaveCount(0);
        await expect(main.getByText("partial", { exact: true })).toBeVisible();
        await expect(main.getByText("fixture_forced_failure", { exact: true })).toBeVisible();
        await expect(main.getByText(current.attempts, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(/attempts=/)).toHaveCount(0);
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        const units = main.locator("section").filter({ has: page.getByRole("heading", { name: current.units, exact: true }) });
        await expect(units.locator("li").filter({ hasText: "succeeded" })).toHaveCount(2);
        await expect(units.locator("li").filter({ hasText: "fixture_forced_failure" })).toHaveCount(1);
        await expect(main.getByText(current.pendingCost, { exact: true })).toBeVisible();
        await expect(main.getByText("CNY").first()).toBeVisible();
        await expect(main.getByText(longPage)).toHaveCount(0);
        if (width === 375) {
          await expect(retry).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-batch-partial-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);

        await page.goto(pausedHref);
        await page.evaluate(() => window.scrollTo(0, 0));
        const pausedMain = page.getByRole("main");
        await expect(pausedMain).toHaveCount(1);
        await expect(pausedMain.getByText(current.pausedTask, { exact: true })).toBeVisible();
        const resume = pausedMain.getByRole("button", { name: current.resume, exact: true });
        await expect(resume).toHaveCount(1);
        await expect(pausedMain.getByRole("button", { name: current.pause, exact: true })).toHaveCount(0);
        await expect(pausedMain.getByRole("button", { name: current.retry, exact: true })).toHaveCount(0);
        await expect(pausedMain.getByText("paused", { exact: true })).toBeVisible();
        await expect(pausedMain.getByText("queued", { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(resume).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-batch-paused-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(partialHref);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].retry, exact: true }));
    await page.evaluate(() => window.scrollTo(0, 0));
    const completed = page.getByRole("main");
    await expect(completed.getByText("completed", { exact: true })).toBeVisible();
    await expect(completed.getByText(copy["zh-CN"].completedTask, { exact: true })).toBeVisible();
    await expect(completed.getByText("fixture_forced_failure")).toHaveCount(0);
    await expect(completed.getByText(copy["zh-CN"].retried, { exact: true })).toBeVisible();
    await expect(completed.getByRole("button", { name: copy["zh-CN"].retry, exact: true })).toHaveCount(0);
    const open = completed.getByRole("link", { name: copy["zh-CN"].open, exact: true }).first();
    await expect(open).toBeInViewport();
    for (const href of succeededVersions) {
      await expect(completed.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
    const units = completed.locator("section").filter({ has: page.getByRole("heading", { name: copy["zh-CN"].units, exact: true }) });
    await expect(units.locator("li").filter({ hasText: "succeeded" })).toHaveCount(3);
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-batch-completed-zh-CN-375.png`, fullPage: false });

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-batch-unavailable", value: "1", url: origin },
    ]);
    await page.goto(partialHref);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText("fixture_forced_failure")).toHaveCount(0);
    await expect(failed.getByText(failedBrief)).toHaveCount(0);
    await expect(failed.getByText("CNY")).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-batch-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-batch-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
    await expect(page.getByText("fixture_forced_failure")).toHaveCount(0);

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(partialHref);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText("fixture_forced_failure")).toHaveCount(0);
    await expect(stranger.getByText(failedBrief)).toHaveCount(0);
    await expect(stranger.getByText(partialBody.batch.id as string)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/content-batch-hidden-en-375.png`, fullPage: false });
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
