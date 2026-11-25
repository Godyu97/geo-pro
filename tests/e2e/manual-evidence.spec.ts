import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const question = "人工存证验收问题";
const answer = "甲可考虑；乙不适合本需求。";
const firstUrl = "https://manual-evidence.example.com/guide?utm_source=one";
const duplicateUrl = "https://manual-evidence.example.com/guide?gclid=two";
const normalizedUrl = "https://manual-evidence.example.com/guide";

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Manual evidence",
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

test("consumer manual evidence can be drafted, completed, and kept immutable", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const ownerEmail = `manual-owner-${randomUUID()}@example.invalid`;
  const outsiderEmail = `manual-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("合成人工存证");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于人工存证验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://manual-evidence.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照名");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "合成人工存证", exact: true })).toBeVisible();
    const brandId = new URL(page.url()).pathname.split("/").at(-1);
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);

    await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "录入消费者人工存证", exact: true })).toBeVisible();
    await main.getByLabel("问题", { exact: true }).fill(question);
    await main.getByLabel("回答原文", { exact: true }).fill(answer);
    await main.getByLabel("采集人", { exact: true }).fill("collector-1");
    const submit = main.getByRole("button", { name: "保存人工存证", exact: true });
    await submit.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(main.getByText("还缺这些项", { exact: true })).toBeVisible();
    await expect(main.getByText("存证定位符", { exact: true }).last()).toBeVisible();
    await expect(main.getByText("引用状态", { exact: true })).toBeVisible();
    const draftLink = main.getByRole("link", { name: "继续补全这条草稿", exact: true });
    await expect(draftLink).toBeVisible();
    const draftHref = await draftLink.getAttribute("href");
    expect(draftHref).toMatch(/^\/dashboard\/monitoring\/evidence\/[0-9a-f-]{36}$/);
    const observationId = draftHref?.split("/").at(-1);
    expect(observationId).toBeTruthy();

    await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}&sourceMode=consumer_ui`);
    await expect(page.getByRole("main").getByText(question, { exact: true })).toHaveCount(0);
    await page.goto(`/dashboard/monitoring/overview?brandId=${brandId}&sourceMode=consumer_ui`);
    await expect(page.getByRole("main").getByText("暂无有效样本", { exact: true })).toBeVisible();

    await page.goto(draftHref!);
    const detail = page.getByRole("main");
    await expect(detail.getByRole("heading", { name: "补全这条草稿", exact: true })).toBeVisible();
    await detail.getByLabel("引用集合状态", { exact: true }).selectOption("complete");
    await detail.getByLabel("引用 URL", { exact: true }).fill(`${firstUrl}\n${duplicateUrl}`);
    await detail.getByLabel("存证定位符", { exact: true }).fill("fixture://manual/browser");
    await detail.getByRole("button", { name: "补全这条草稿", exact: true }).click();
    await expect(detail.getByText("完整", { exact: true })).toBeVisible();
    await expect(detail.getByText(/版本 1/)).toBeVisible();
    await expect(detail.getByText(`规范化 URL: ${normalizedUrl}`, { exact: true })).toHaveCount(1);
    await expect(detail.getByText(`原 URL: ${firstUrl}`, { exact: true })).toBeVisible();
    await expect(detail.getByText(duplicateUrl)).toHaveCount(0);
    await expect(detail.getByRole("heading", { name: "补全这条草稿" })).toHaveCount(0);

    const rejected = await page.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "complete-manual",
        brandId,
        observationId,
        operationId: randomUUID(),
        questionText: question,
        answerText: "覆盖原文不应成功",
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
        locatorRef: "fixture://manual/browser",
        collectorId: "collector-1",
        contested: false,
        brandName: "合成人工存证",
        aliases: [],
        officialWebsite: "https://manual-evidence.example.com",
      },
    });
    expect(rejected.status()).toBe(409);
    await page.reload();
    await expect(page.getByRole("main").getByText(answer, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("覆盖原文不应成功")).toHaveCount(0);

    await page.goto(`/dashboard/monitoring/overview?brandId=${brandId}&sourceMode=consumer_ui`);
    await expect(page.getByRole("main").getByText(question, { exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "查看回答列表" }).first().click();
    await expect(page).toHaveURL(new RegExp(`sourceMode=consumer_ui`));
    await expect(page.getByRole("main").getByText(question, { exact: true })).toBeVisible();

    await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}`);
    const retry = page.getByRole("main");
    await retry.getByLabel("问题", { exact: true }).fill("凭据拒绝问题");
    await retry.getByLabel("回答原文", { exact: true }).fill("普通回答");
    await retry.getByLabel("引用集合状态", { exact: true }).selectOption("complete");
    await retry.getByLabel("采集人", { exact: true }).fill("collector-1");
    await retry.getByLabel("存证定位符", { exact: true }).fill("session_token=abc");
    await retry.getByRole("button", { name: "保存人工存证", exact: true }).click();
    await expect(retry.getByText("提交内容无效，请检查后重试。", { exact: true })).toBeVisible();
    await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}&sourceMode=consumer_ui`);
    await expect(page.getByRole("main").getByText("凭据拒绝问题", { exact: true })).toHaveCount(0);

    for (const copy of [
      { locale: "zh-CN", heading: "录入消费者人工存证" },
      { locale: "en", heading: "Record a consumer answer" },
    ]) {
      await context.addCookies([{ name: "geo-locale", value: copy.locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}`);
        const surface = page.getByRole("main");
        await expect(surface.getByRole("heading", { name: copy.heading, exact: true })).toBeVisible();
        const questionField = surface.getByLabel(copy.locale === "zh-CN" ? "问题" : "Question", { exact: true });
        await questionField.focus();
        await expect(questionField).toBeFocused();
        await questionField.fill(copy.locale === "zh-CN" ? "键盘可达" : "Keyboard reach");
        const control = surface.getByRole("button", { name: copy.locale === "zh-CN" ? "保存人工存证" : "Save manual evidence", exact: true });
        await control.focus();
        await expect(control).toBeFocused();
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(draftHref!);
    await expect(page.getByRole("main").getByText(answer, { exact: true })).toBeVisible();
    await expectNoOverflow(page);

    const outsiderPage = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(draftHref!);
    await expect(outsiderPage.getByRole("main").getByText("Evidence was not found or does not belong to your brand.", { exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(answer)).toHaveCount(0);
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
