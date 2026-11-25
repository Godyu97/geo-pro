import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const longName = "丙".repeat(40);
const shortName = "甲品牌";
const rawUrl = `https://citation.example.com/${"a".repeat(160)}`;
const question = "采购时怎么比较这类设备？";

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Competitor visual test", email, password: randomBytes(24).toString("base64url"),
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

test("competitor analysis stays readable for long names, citations and a missing version", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(240_000);
  const ownerEmail = `competitor-owner-${randomUUID()}@example.invalid`;
  const outsiderEmail = `competitor-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("合成竞品验收");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于竞品与来源验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://competitors.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("建档时跳过的对照名");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${publishedRetentionVersion()}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "合成竞品验收", exact: true })).toBeVisible();
    const brandId = new URL(page.url()).pathname.split("/").at(-1);
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);

    const saved = await context.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "submit-manual", brandId, operationId: randomUUID(),
        questionText: question,
        answerText: "回答同时提到甲品牌，并引用了一个受限页面。这是合成证据。",
        region: "CN", language: "zh-CN", requestedNetworkMode: "unknown", entityVersion: 1,
        citationSetState: "partial",
        citations: [{ rawUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "restricted" }],
        locatorRef: "fixture://competitors/restricted", collectorId: "fixture-operator",
        contested: false, brandName: "合成竞品验收", aliases: [], officialWebsite: "https://competitors.example.com",
        mentioned: "false", recommended: "unknown", officialSiteCited: "unknown",
      },
    });
    expect(saved.status()).toBe(200);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dashboard/monitoring/answers?brandId=${brandId}`);
    const main = page.getByRole("main");
    await activateFromKeyboard(page, main.getByRole("link", { name: "竞品与来源", exact: true }));
    await expect(page).toHaveURL(new RegExp(`/dashboard/monitoring/competitors\\?brandId=${brandId}$`));
    await expect(main).toHaveCount(1);
    await expect(main.getByRole("heading", { name: "竞品与来源", exact: true })).toBeVisible();
    await expect(main.getByText("合成竞品验收", { exact: true })).toBeVisible();
    await expect(main.getByText("这些提及没有明确顺序，不显示排名。", { exact: true })).toHaveCount(0);
    const saveSet = main.getByRole("button", { name: "保存竞品集", exact: true });
    await expect(saveSet).toBeInViewport();
    await expectNoOverflow(page);

    await main.getByLabel("竞品名称（每行一个，最多 5 个）", { exact: true }).fill(`${longName}\n${shortName}`);
    await activateFromKeyboard(page, saveSet);
    await expect(main.getByRole("link", { name: "版本 1", exact: true })).toBeVisible();
    await expect(main.getByText(longName, { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page);
    const before = main.getByRole("row", { name: shortName });
    await expect(before.getByRole("cell").nth(1)).toHaveText("N/A");
    await expect(before.getByRole("cell").nth(2)).toHaveText("N/A");
    await expect(before.getByRole("cell").nth(3)).toHaveText("0");
    await expect(before.getByRole("cell").nth(4)).toHaveText("0");

    const mention = async () => {
      await main.getByLabel(shortName, { exact: true }).selectOption("true");
      await main.getByLabel(longName, { exact: true }).selectOption("true");
      await main.getByRole("button", { name: "保存提及", exact: true }).click();
    };
    await mention();
    await mention();
    const after = main.getByRole("row", { name: shortName });
    await expect(after.getByRole("cell").nth(1)).toHaveText("N/A");
    await expect(after.getByRole("cell").nth(2)).toHaveText("50.0%");
    await expect(after.getByRole("cell").nth(3)).toHaveText("1");
    await expect(after.getByRole("cell").nth(4)).toHaveText("2");
    await expect(main.getByText("缺失题目编号的回答（不进入等权均值）", { exact: true })).toBeVisible();
    await expect(main.getByText("这些提及没有明确顺序，不显示排名。", { exact: true })).toBeVisible();
    await expect(main.getByText(/条件平均位置/)).toHaveCount(0);
    await expect(main.getByText(rawUrl, { exact: true }).first()).toBeVisible();
    await expect(main.getByText("已观察", { exact: true })).toBeVisible();
    await expect(main.getByText("支持性未知", { exact: true })).toBeVisible();
    await expect(main.getByText(/不是平台偏好/)).toBeVisible();

    await main.getByRole("checkbox", { name: "页面仍可打开", exact: true }).check();
    await main.getByRole("checkbox", { name: "正文支持本品牌", exact: true }).check();
    await main.getByRole("button", { name: "保存复核", exact: true }).click();
    await expect(main.getByText("正文受限", { exact: true })).toBeVisible();
    await expect(main.getByText("支持性未知", { exact: true })).toBeVisible();
    await expect(main.getByText("页面支持品牌", { exact: true })).toHaveCount(0);

    const brief = main.locator("section").filter({ has: page.getByRole("heading", { name: "研究 Brief", exact: true }) });
    await brief.getByLabel("问题簇", { exact: true }).fill("采购比较");
    await brief.getByLabel("议题缺口", { exact: true }).fill("只替换了名称");
    await brief.locator("select[name=sourceId]").selectOption({ index: 0 });
    await brief.getByLabel("对方原文", { exact: true }).fill("甲品牌更适合采购");
    await brief.getByLabel("拟写角度", { exact: true }).fill("乙品牌更适合采购");
    await brief.getByLabel("对方品牌名", { exact: true }).fill("甲品牌");
    await brief.getByLabel("自家品牌名", { exact: true }).fill("乙品牌");
    await brief.getByRole("button", { name: "保存 Brief", exact: true }).click();
    await expect(main.getByText("这只是把对方品牌名换成自家品牌，没有保存。", { exact: true })).toBeVisible();
    await expect(main.getByText("只替换了名称", { exact: true })).toHaveCount(0);

    await brief.getByLabel("问题簇", { exact: true }).fill("采购比较");
    await brief.getByLabel("议题缺口", { exact: true }).fill("交付周期没有写清");
    await brief.getByLabel("可用事实（每行一条）", { exact: true }).fill("交付周期以合同为准");
    await brief.locator("select[name=sourceId]").selectOption({ index: 0 });
    await brief.getByLabel("对方原文", { exact: true }).fill("甲品牌只写了价格");
    await brief.getByLabel("拟写角度", { exact: true }).fill("补充交付周期和适用边界");
    await brief.getByLabel("对方品牌名", { exact: true }).fill("甲品牌");
    await brief.getByLabel("自家品牌名", { exact: true }).fill("乙品牌");
    await brief.getByRole("button", { name: "保存 Brief", exact: true }).click();
    await expect(main.getByText("交付周期没有写清", { exact: true })).toBeVisible();
    await expect(main.getByText("待确认", { exact: true })).toBeVisible();

    for (const copy of [
      { locale: "zh-CN", title: "竞品与来源", unordered: "这些提及没有明确顺序，不显示排名。", limited: "正文受限", support: "支持性未知", proposed: "待确认", share: "份额表" },
      { locale: "en", title: "Competitors and sources", unordered: "These mentions have no explicit order, so no rank is shown.", limited: "Text limited", support: "Support unknown", proposed: "Proposed", share: "Share table" },
    ]) {
      await context.addCookies([{ name: "geo-locale", value: copy.locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/dashboard/monitoring/competitors?brandId=${brandId}`);
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
        await expect(main.getByText(longName, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(rawUrl, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(copy.unordered, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.limited, { exact: true })).toBeVisible();
        await expect(main.getByText(copy.support, { exact: true })).toBeVisible();
        await expect(main.getByText("交付周期没有写清", { exact: true })).toBeVisible();
        await expect(main.getByText(copy.proposed, { exact: true })).toBeVisible();
        const table = main.getByRole("region", { name: copy.share, exact: true });
        await expect(table.getByRole("row", { name: shortName }).getByRole("cell").nth(3)).toHaveText("1");
        await expectNoOverflow(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`competitors-${copy.locale}.png`) });
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    const share = main.getByRole("region", { name: "Share table", exact: true });
    await share.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(share).toBeFocused();
    expect(await share.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    const countCell = share.getByRole("row", { name: shortName }).getByRole("cell").nth(3);
    await countCell.scrollIntoViewIfNeeded();
    expect(await countCell.evaluate((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
    })).toBe(true);
    await activateFromKeyboard(page, main.getByRole("button", { name: "Accept", exact: true }));
    await expect(main.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);

    await page.goto(`/dashboard/monitoring/competitors?brandId=${brandId}&version=99`);
    await expect(main.getByRole("heading", { name: "Competitors and sources", exact: true })).toBeVisible();
    await expect(main.getByText("The resource was not found or is not yours.", { exact: true })).toBeVisible();
    await expect(main.getByText(longName)).toHaveCount(0);
    await expect(main.getByText(rawUrl)).toHaveCount(0);
    await expectNoOverflow(page);
    await activateFromKeyboard(page, main.getByRole("link", { name: "View the current brand", exact: true }));
    await expect(main.getByText(longName, { exact: true }).first()).toBeVisible();

    // Seed slotted observations for Version 2: Q1 (1 answer -> 甲), Q2 (5 answers -> 乙), Q3 (zero mentions), Q4 (unknown)
    const q1Id = "11111111-1111-4111-8111-111111111111";
    const q2Id = "22222222-2222-4222-8222-222222222222";
    const q3Id = "33333333-3333-4333-8333-333333333333";
    const q4Id = "44444444-4444-4444-8444-444444444444";
    const seeded = JSON.parse(execFileSync(process.execPath, [
      "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "competitor-slots",
      JSON.stringify({
        userId: accounts[0].userId,
        brandId,
        items: [
          { questionId: q1Id, questionText: "第一题", answerText: "只提甲" },
          { questionId: q2Id, questionText: "第二题", answerText: "乙回答1" },
          { questionId: q2Id, questionText: "第二题", answerText: "乙回答2" },
          { questionId: q2Id, questionText: "第二题", answerText: "乙回答3" },
          { questionId: q2Id, questionText: "第二题", answerText: "乙回答4" },
          { questionId: q2Id, questionText: "第二题", answerText: "乙回答5" },
          { questionId: q3Id, questionText: "第三题", answerText: "无提及" },
          { questionId: q4Id, questionText: "第四题", answerText: "甲未知" },
        ],
      }),
    ], { encoding: "utf8" })) as { created: Array<{ observationId: string; questionId: string }> };

    await main.getByLabel("Competitor names (one per line, up to 5)", { exact: true }).fill("甲\n乙");
    await main.getByRole("button", { name: "Save set", exact: true }).click();
    await expect(main.getByRole("link", { name: "Version 2", exact: true })).toBeVisible();

    let expectedCommon = 0;
    let expectedExcluded = 0;
    for (const entry of seeded.created) {
      await main.locator("select[name=observationId]").selectOption(entry.observationId);
      if (entry.questionId === q1Id) {
        await main.getByLabel("甲", { exact: true }).selectOption("true");
        await main.getByLabel("乙", { exact: true }).selectOption("false");
        expectedCommon += 1;
      } else if (entry.questionId === q2Id) {
        await main.getByLabel("甲", { exact: true }).selectOption("false");
        await main.getByLabel("乙", { exact: true }).selectOption("true");
        expectedCommon += 1;
      } else if (entry.questionId === q3Id) {
        await main.getByLabel("甲", { exact: true }).selectOption("false");
        await main.getByLabel("乙", { exact: true }).selectOption("false");
        expectedCommon += 1;
      } else {
        await main.getByLabel("甲", { exact: true }).selectOption("unknown");
        await main.getByLabel("乙", { exact: true }).selectOption("true");
        expectedExcluded += 1;
      }
      await main.getByRole("button", { name: "Save mentions", exact: true }).click();
      await expect(main.getByText(new RegExp(`^${expectedCommon} common answers .* ${expectedExcluded} excluded$`))).toBeVisible();
    }

    for (const copy of [
      {
        locale: "zh-CN",
        region: "份额表",
        version: "版本 2",
        equalHeader: "题等权份额",
        pooledHeader: "池化份额",
        zeroNote: /仍在覆盖中/,
        excludedNote: /整题未进入共同可判断子集（1 条含未知提及）/,
      },
      {
        locale: "en",
        region: "Share table",
        version: "Version 2",
        equalHeader: "Question-equal-weighted share",
        pooledHeader: "Pooled share",
        zeroNote: /Still covered/,
        excludedNote: /Excluded from common judgable subset \(1 answers with unknown mentions\)/,
      },
    ]) {
      await context.addCookies([{ name: "geo-locale", value: copy.locale, url: origin }]);
      await page.goto(`/dashboard/monitoring/competitors?brandId=${brandId}&version=2`);
      await expect(main.getByText(copy.version, { exact: true }).first()).toBeVisible();
      const v2Table = main.getByRole("region", { name: copy.region, exact: true });
      await expect(v2Table.getByRole("columnheader", { name: copy.equalHeader, exact: true })).toBeVisible();
      await expect(v2Table.getByRole("columnheader", { name: copy.pooledHeader, exact: true })).toBeVisible();
      const jiaRow = v2Table.getByRole("row", { name: "甲" });
      await expect(jiaRow.getByRole("cell").nth(1)).toHaveText("50.0%");
      await expect(jiaRow.getByRole("cell").nth(2)).toHaveText("16.7%");
      await expect(jiaRow.getByRole("cell").nth(3)).toHaveText("1");
      await expect(jiaRow.getByRole("cell").nth(4)).toHaveText("6");
      const yiRow = v2Table.getByRole("row", { name: "乙" });
      await expect(yiRow.getByRole("cell").nth(1)).toHaveText("50.0%");
      await expect(yiRow.getByRole("cell").nth(2)).toHaveText("83.3%");
      await expect(yiRow.getByRole("cell").nth(3)).toHaveText("5");
      await expect(yiRow.getByRole("cell").nth(4)).toHaveText("6");
      await expect(main.getByText(q1Id, { exact: true })).toBeVisible();
      await expect(main.getByText(q2Id, { exact: true })).toBeVisible();
      await expect(main.getByText(q3Id, { exact: true })).toBeVisible();
      await expect(main.getByText(q4Id, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(copy.zeroNote)).toBeVisible();
      await expect(main.getByText(copy.excludedNote)).toBeVisible();
      await expectNoOverflow(page);
    }

    // Version 1 remains unchanged after Version 2
    await page.goto(`/dashboard/monitoring/competitors?brandId=${brandId}&version=1`);
    const v1Table = main.getByRole("region", { name: "Share table", exact: true });
    await expect(v1Table.getByRole("row", { name: shortName }).getByRole("cell").nth(2)).toHaveText("50.0%");
    await expect(v1Table.getByRole("row", { name: shortName }).getByRole("cell").nth(3)).toHaveText("1");

    const denied = await outsider.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "submit-manual", brandId, operationId: randomUUID(),
        questionText: question, answerText: "其他账号不能写入。",
        region: "CN", language: "zh-CN", requestedNetworkMode: "unknown", entityVersion: 1,
        citationSetState: "missing", citations: [], locatorRef: null, collectorId: null,
        contested: false, brandName: "合成竞品验收", aliases: [],
      },
    });
    expect(denied.status()).toBe(404);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const outsiderPage = await outsider.newPage();
    await outsiderPage.setViewportSize({ width: 375, height: 800 });
    await outsiderPage.goto(`/dashboard/monitoring/competitors?brandId=${brandId}`);
    await expect(outsiderPage.getByRole("heading", { name: "Competitors and sources", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "Go to brands", exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(longName)).toHaveCount(0);
    await expect(outsiderPage.getByText(rawUrl)).toHaveCount(0);
    await expectNoOverflow(outsiderPage);
    await outsiderPage.goto("/dashboard/monitoring/competitors");
    await expect(outsiderPage.getByRole("link", { name: "Go to brands", exact: true })).toBeVisible();
    await expectNoOverflow(outsiderPage);
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
