import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const bodyUrl = "https://body.example/only-in-text";
const searchUrl = "https://reference-link.example.com/guide?utm_source=browser";
const normalizedSearch = "https://reference-link.example.com/guide";
const nativeUrl = "https://third.example/a?utm_source=native";
const sameSearchUrl = "https://third.example/a?fbclid=search";
const normalizedNative = "https://third.example/a";

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Reference links",
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

test("search candidates stay visible without becoming native citations", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const ownerEmail = `reference-owner-${randomUUID()}@example.invalid`;
  const outsiderEmail = `reference-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("合成核对链接");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于核对链接验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://reference-link.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照名");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "合成核对链接", exact: true })).toBeVisible();
    const brandId = new URL(page.url()).pathname.split("/").at(-1);
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);

    const empty = await page.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "submit-manual",
        brandId,
        operationId: randomUUID(),
        questionText: "空引用旁的搜索候选",
        answerText: `正文有 ${bodyUrl}，没有加入链接表。`,
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: "unknown",
        targetRegion: "CN",
        observedRegion: "unknown",
        newSession: "unknown",
        productMode: "unknown",
        entityVersion: 1,
        citationSetState: "complete",
        citations: [],
        locatorRef: "fixture://reference/empty",
        collectorId: "collector-1",
        brandName: "合成核对链接",
        aliases: [],
        officialWebsite: "https://reference-link.example.com",
      },
    });
    expect(empty.status()).toBe(200);
    const emptyBody = await empty.json();
    const emptyId = emptyBody.observation.id as string;
    expect(emptyBody.citations).toEqual([]);
    expect(emptyBody.latestAnalysis.officialSiteCited).toBe("false");

    await page.goto(`/dashboard/monitoring/evidence/${emptyId}`);
    const detail = page.getByRole("main");
    await expect(detail.getByText("没有原生引用", { exact: true })).toBeVisible();
    await expect(detail.getByText("完整空引用（未引用）", { exact: true })).toBeVisible();
    await expect(detail.getByText("官网引用: 否", { exact: true })).toBeVisible();
    await expect(detail.getByText(`正文有 ${bodyUrl}，没有加入链接表。`, { exact: true })).toBeVisible();
    await expect(detail.getByText(`原 URL: ${bodyUrl}`)).toHaveCount(0);

    const save = detail.getByRole("button", { name: "保存这条链接", exact: true });
    await detail.getByLabel("链接", { exact: true }).fill(searchUrl);
    await save.focus();
    await expect(save).toBeFocused();
    await save.click();
    await expect(detail.getByText("已保存。原文、引用集合状态和官网引用判定没有变化。", { exact: true })).toBeVisible();
    await expect(detail.getByText("没有原生引用", { exact: true })).toBeVisible();
    await expect(detail.locator("p").filter({ hasText: /^搜索候选$/ })).toBeVisible();
    await expect(detail.getByText(`规范化 URL: ${normalizedSearch}`, { exact: true })).toBeVisible();
    await expect(detail.getByText("官网引用: 否", { exact: true })).toBeVisible();
    await expect(detail.getByText("完整空引用（未引用）", { exact: true })).toBeVisible();
    await expect(detail.getByText(`原 URL: ${bodyUrl}`)).toHaveCount(0);

    const paired = await page.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "submit-manual",
        brandId,
        operationId: randomUUID(),
        questionText: "同一地址的原生引用",
        answerText: `这里也有 ${bodyUrl}，链接表只有原生引用。`,
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: "unknown",
        targetRegion: "CN",
        observedRegion: "unknown",
        newSession: "unknown",
        productMode: "unknown",
        entityVersion: 1,
        citationSetState: "complete",
        citations: [{ rawUrl: nativeUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "unknown" }],
        locatorRef: "fixture://reference/native",
        collectorId: "collector-1",
        brandName: "合成核对链接",
        aliases: [],
        officialWebsite: "https://reference-link.example.com",
      },
    });
    expect(paired.status()).toBe(200);
    const pairedBody = await paired.json();
    const pairedId = pairedBody.observation.id as string;
    await page.goto(`/dashboard/monitoring/evidence/${pairedId}`);
    const pairedDetail = page.getByRole("main");
    await expect(pairedDetail.locator("p").filter({ hasText: /^消费者可见引用$/ })).toBeVisible();
    await expect(pairedDetail.getByText(`原 URL: ${bodyUrl}`)).toHaveCount(0);
    await pairedDetail.getByLabel("链接", { exact: true }).fill(sameSearchUrl);
    await pairedDetail.getByRole("button", { name: "保存这条链接", exact: true }).click();
    await expect(pairedDetail.locator("p").filter({ hasText: /^搜索候选$/ })).toBeVisible();
    await expect(pairedDetail.getByText(`规范化 URL: ${normalizedNative}`, { exact: true })).toHaveCount(2);
    await expect(pairedDetail.locator("p").filter({ hasText: /^消费者可见引用$/ })).toBeVisible();

    await page.goto(`/dashboard/monitoring/competitors?brandId=${brandId}`);
    const sources = page.getByRole("main");
    await expect(sources.getByText("搜索候选和分析师找到的页面会带来源类别列出，不计入正向第三方支持。", { exact: true })).toBeVisible();
    await expect(sources.locator("p").filter({ hasText: /^搜索候选$/ }).first()).toBeVisible();
    await expect(sources.locator("p").filter({ hasText: /^消费者可见引用$/ })).toBeVisible();
    const citationSelect = sources.locator("select[name='citationId']");
    await citationSelect.selectOption({ label: nativeUrl });
    for (const name of ["pageLive", "readable", "authorKnown", "supportsBrand"]) {
      await sources.locator(`input[name="${name}"]`).check();
    }
    await sources.getByRole("button", { name: "保存复核", exact: true }).click();
    await citationSelect.selectOption({ label: sameSearchUrl });
    for (const name of ["pageLive", "readable", "authorKnown", "supportsBrand"]) {
      await sources.locator(`input[name="${name}"]`).check();
    }
    await sources.getByRole("button", { name: "保存复核", exact: true }).click();
    await expect(sources.getByText(/支持率：.+\(1\/1\)/)).toBeVisible();
    await expect(sources.getByText("(2/2)")).toHaveCount(0);

    await context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/dashboard/monitoring/evidence/${emptyId}`);
      const english = page.getByRole("main");
      await expect(english.getByRole("heading", { name: "Keep a search candidate or analyst link", exact: true })).toBeVisible();
      await expect(english.getByText("No native citations", { exact: true })).toBeVisible();
      await expect(english.locator("p").filter({ hasText: /^Search candidate$/ })).toBeVisible();
      await english.getByLabel("Link", { exact: true }).focus();
      await expect(english.getByLabel("Link", { exact: true })).toBeFocused();
      await expectNoOverflow(page);
    }

    const outsiderPage = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(`/dashboard/monitoring/evidence/${emptyId}`);
    await expect(outsiderPage.getByRole("main").getByText("Evidence was not found or does not belong to your brand.", { exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(bodyUrl)).toHaveCount(0);
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId: account.userId, email: account.email }),
      ], { stdio: "inherit" });
    }
  }
});
