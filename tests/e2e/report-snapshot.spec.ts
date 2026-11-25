import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const brandName = "合成报告品牌";

const copy = {
  "zh-CN": {
    title: "复测与报告",
    emptyTask: "还没有报告快照。生成同口径快照之后，下一步才是下载不可变 JSON。现在先打开观察计划。",
    currentTask: "已有仍有效的报告快照。后继版本不会改写这份文件。探索结论不声称因果。下一步是下载当前 JSON。",
    downloadCurrent: "下载当前 JSON",
    downloadJson: "下载 JSON",
    downloadHtml: "下载 HTML",
    openObservations: "打开观察计划",
    related: "相关入口",
    line: "exploratory · diagnostic · 闭环 否",
    previous: "上一份",
    unavailable: "暂时无法读取复测与报告。请稍后重试。",
    reload: "重新载入",
    missing: "找不到该品牌或报告资源。",
    noCharge: "站内提醒不会自动发起付费调用",
    known: "已知费用 N/A",
    metrics: ["提及率", "推荐率", "官网引用率"],
    citationCount: "1 道共同题 · N/A",
    legacyMetric: "历史快照指标 推荐率",
  },
  en: {
    title: "Retest & reports",
    emptyTask: "There is no report snapshot yet. Download the immutable JSON only after a same-scope snapshot exists. Open the observation plan for now.",
    currentTask: "A current report snapshot is still valid. A later version does not rewrite this file. Exploratory conclusions do not claim causality. Download the current JSON next.",
    downloadCurrent: "Download the current JSON",
    downloadJson: "Download JSON",
    downloadHtml: "Download HTML",
    openObservations: "Open the observation plan",
    related: "Related entries",
    line: "exploratory · diagnostic · loop no",
    previous: "Previous",
    unavailable: "Retest and reports could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Brand or report resource was not found.",
    noCharge: "In-app reminders never auto-charge paid runs",
    known: "Known cost N/A",
    metrics: ["Mention rate", "Recommendation rate", "Official site citation rate"],
    citationCount: "1 common question · N/A",
    legacyMetric: "Historical snapshot metric: Recommendation rate",
  },
} as const;

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function reportFixture(command: string, payload: object) {
  return JSON.parse(execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", command, JSON.stringify(payload),
  ], { encoding: "utf8" }));
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Report snapshot visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function post(context: BrowserContext, url: string, data: unknown) {
  const response = await context.request.post(url, { headers: { Origin: origin }, data });
  expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
  return response.json();
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

test("report snapshots keep the current download readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const shots = ".cache/issue-135/report-snapshot";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `report-snapshot-${randomUUID()}@example.invalid`;
  const outsiderEmail = `report-snapshot-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await post(context, "/api/brands", {
      action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName, description: "仅用于报告快照隔离验收的合成品牌。",
        website: "https://report-snapshot.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const brandId = savedBrand.id as string;
    const { before, after } = reportFixture("report-observations", { userId: accounts[0]?.userId, brandId });
    const retest = await post(context, "/api/reports", {
      action: "request-retest", brandId, operationId: randomUUID(), kind: "exploratory", intent: "business_loop",
      track: "model_api", timezone: "Asia/Shanghai", entityVersion: 1, before, after, locale: "zh-CN",
    });
    expect(retest.loopCompleted).toBe(false);
    expect(retest.retest.intent).toBe("diagnostic");
    const reminder = await post(context, "/api/reports", {
      action: "request-retest", brandId, operationId: randomUUID(), kind: "d7_reminder", intent: "business_loop",
      track: "model_api", timezone: "Asia/Shanghai", entityVersion: 1, before,
      effectiveAt: "2026-11-20T02:00:00.000Z", locale: "zh-CN",
    });
    expect(reminder.todo.autoCharge).toBe(0);
    const report = await post(context, "/api/reports", {
      action: "generate-report", brandId, operationId: randomUUID(), retestId: retest.retest.id,
      before, after, locale: "zh-CN", brandName,
    });
    const snapshotId = report.snapshot.id as string;
    expect(snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.snapshot.predecessorId).toBeNull();
    expect(report.loopCompleted).toBe(false);

    const href = `/dashboard/reports?brandId=${brandId}`;
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    let originalJson: Buffer = Buffer.alloc(0);
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
        await expect(main.getByText(current.currentTask, { exact: true })).toBeVisible();
        const download = main.getByRole("link", { name: current.downloadCurrent, exact: true });
        await expect(download).toHaveCount(1);
        await expect(download).toHaveAttribute("href", `/api/reports/snapshots/${snapshotId}?format=json`);
        await expect(main.getByRole("link", { name: current.downloadJson, exact: true })).toHaveCount(1);
        await expect(main.getByRole("link", { name: current.downloadHtml, exact: true })).toHaveCount(1);
        await expect(main.getByText(current.line, { exact: true })).toBeVisible();
        await expect(main.getByText("created", { exact: true })).toBeVisible();
        await expect(main.getByText("superseded")).toHaveCount(0);
        await expect(main.getByText(current.noCharge, { exact: true })).toBeVisible();
        await expect(main.getByText(current.known, { exact: true })).toBeVisible();
        for (const metric of current.metrics) await expect(main.getByText(metric, { exact: true })).toBeVisible();
        await expect(main.getByText(current.citationCount, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        if (width === 375) {
          await expect(download).toBeInViewport();
          await page.screenshot({ path: `${shots}/report-snapshot-current-${locale}-375.png`, fullPage: false });
          const card = main.getByRole("listitem").filter({ has: page.locator(`a[href="/api/reports/snapshots/${snapshotId}?format=json"]`) });
          await card.locator("dl").screenshot({ path: `${shots}/report-snapshot-metrics-${locale}-375.png` });
        }
        await expectNoOverflow(page);
      }
      const body = await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).body();
      if (locale === "zh-CN") originalJson = Buffer.from(body);
      else expect(Buffer.compare(originalJson, body)).toBe(0);
      expect(body.toString("utf8")).toContain(brandName);
    }
    const first = JSON.parse(originalJson.toString("utf8"));
    expect(first.report_id).toBe(snapshotId);
    expect(first.comparisons.recommendation_rate).toMatchObject({ common_query_count: 3, before_sample_count: 3, after_sample_count: 3 });
    expect(first.comparisons.recommendation_rate.delta_pp).toBeCloseTo(66.6667);
    expect(first.comparisons.official_site_citation_rate).toMatchObject({ common_query_count: 1, delta_pp: null, before_sample_count: 1 });
    const firstHtmlResponse = await context.request.get(`/api/reports/snapshots/${snapshotId}?format=html`);
    expect(firstHtmlResponse.ok()).toBeTruthy();
    const firstHtml = await firstHtmlResponse.text();
    expect(firstHtml).toContain(snapshotId);
    expect(firstHtml).toMatch(/<h2>推荐率<\/h2>[\s\S]*?共同题 3\/4[\s\S]*?\+66\.7pp/);
    expect(firstHtml).toMatch(/<h2>官网引用率<\/h2>[\s\S]*?共同题 1\/4[\s\S]*?N\/A/);

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const downloadPromise = page.waitForEvent("download");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].downloadCurrent, exact: true }));
    const downloadFile = await (await downloadPromise).path();
    expect(downloadFile).toBeTruthy();
    expect(Buffer.compare(originalJson, await readFile(downloadFile!))).toBe(0);

    const legacy = reportFixture("report-history", {
      userId: accounts[0]?.userId, brandId, retestId: retest.retest.id, observationId: after.samples[1].observationId,
    });
    const revised = await post(context, "/api/reports", {
      action: "revise-report", brandId, operationId: randomUUID(), snapshotId,
      before, after, locale: "en", brandName, note: "label correction",
    });
    const nextId = revised.snapshot.id as string;
    expect(nextId).not.toBe(snapshotId);
    expect(revised.snapshot.predecessorId).toBe(snapshotId);
    expect(revised.previous.status).toBe("superseded");
    const preserved = await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).body();
    expect(Buffer.compare(originalJson, preserved)).toBe(0);
    const successor = await (await context.request.get(`/api/reports/snapshots/${nextId}?format=json`)).body();
    expect(Buffer.compare(originalJson, successor)).not.toBe(0);
    const corrected = JSON.parse(successor.toString("utf8"));
    expect(corrected.comparisons.recommendation_rate.delta_pp).toBe(100);
    expect(corrected.evidence[after.samples[1].observationId].analysis_version).toBe(2);
    const successorHtml = await (await context.request.get(`/api/reports/snapshots/${nextId}?format=html`)).text();
    expect(successorHtml).toContain(nextId);
    expect(successorHtml).toContain("<h2>Mention rate</h2>");
    expect(successorHtml).toMatch(/<h2>Recommendation rate<\/h2>[\s\S]*?\+100\.0pp/);
    expect(successorHtml).toMatch(/<h2>Official site citation rate<\/h2>[\s\S]*?N\/A/);
    expect(await (await context.request.get(`/api/reports/snapshots/${legacy.id}?format=json`)).text()).toBe(legacy.json);
    expect(await (await context.request.get(`/api/reports/snapshots/${legacy.id}?format=html`)).text()).toBe(legacy.html);
    console.info(`Isolated snapshots ${snapshotId} → ${nextId}, historical ${legacy.id}; common questions 3/3/1.`);

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(current.currentTask, { exact: true })).toBeVisible();
        const download = main.getByRole("link", { name: current.downloadCurrent, exact: true });
        await expect(download).toHaveCount(1);
        await expect(download).toHaveAttribute("href", `/api/reports/snapshots/${nextId}?format=json`);
        await expect(main.getByText(`created · ${current.previous} ${snapshotId}`)).toBeVisible();
        await expect(main.getByText("superseded", { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
        const historyRow = main.getByRole("listitem").filter({ has: page.locator(`a[href="/api/reports/snapshots/${legacy.id}?format=json"]`) });
        await expect(historyRow.getByText(current.legacyMetric, { exact: true })).toBeVisible();
        await expect(historyRow.getByText(current.metrics[2], { exact: true })).toHaveCount(0);
        if (width === 375) {
          await expect(download).toBeInViewport();
          await page.screenshot({ path: `${shots}/report-snapshot-revised-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const outsiderBrand = await post(outsider, "/api/brands", {
      action: "submit", actorId: accounts[1]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: "合成空白报告品牌", description: "仅用于报告快照空态隔离验收的合成品牌。",
        website: "https://report-snapshot-empty.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const emptyPage = await outsider.newPage();
    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await outsider.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await emptyPage.setViewportSize({ width, height: 800 });
        await emptyPage.goto("/dashboard/reports");
        await emptyPage.evaluate(() => window.scrollTo(0, 0));
        const main = emptyPage.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByText(current.emptyTask, { exact: true })).toBeVisible();
        const observations = main.getByRole("link", { name: current.openObservations, exact: true });
        await expect(observations).toHaveCount(1);
        await expect(main.getByRole("link", { name: current.downloadCurrent, exact: true })).toHaveCount(0);
        await expect(main.getByRole("link", { name: current.downloadJson, exact: true })).toHaveCount(0);
        await expect(main.getByText(snapshotId)).toHaveCount(0);
        await expect(main.getByText(nextId)).toHaveCount(0);
        if (width === 375) {
          await expect(observations).toBeInViewport();
          await emptyPage.screenshot({ path: `${shots}/report-snapshot-empty-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(emptyPage);
      }
    }
    expect(outsiderBrand.id).toMatch(/^[0-9a-f-]{36}$/);

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-reports-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(snapshotId)).toHaveCount(0);
    await expect(failed.getByText(nextId)).toHaveCount(0);
    await expect(failed.getByText("exploratory")).toHaveCount(0);
    await expect(failed.getByText("diagnostic")).toHaveCount(0);
    await expect(failed.getByText(brandName)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/report-snapshot-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-reports-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText(copy.en.currentTask, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.en.downloadCurrent, exact: true })).toHaveAttribute("href", `/api/reports/snapshots/${nextId}?format=json`);

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    const hidden = stranger.getByRole("main");
    await expect(hidden.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(hidden.getByRole("alert")).toContainText(copy.en.missing);
    await expect(hidden.getByText(snapshotId)).toHaveCount(0);
    await expect(hidden.getByText(nextId)).toHaveCount(0);
    await expect(hidden.getByText(brandName)).toHaveCount(0);
    await expect(hidden.getByRole("link", { name: copy.en.downloadCurrent, exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/report-snapshot-hidden-en-375.png`, fullPage: false });
  } finally {
    await outsider.close();
    const sql = postgres(localDatabaseURL(), { max: 1 });
    try {
      for (const { userId, email } of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
          JSON.stringify({ userId, email }),
        ], { stdio: "inherit" });
      }
      const users = await sql<{ count: string }[]>`
        select count(*)::text as count from "user" where email like 'report-snapshot-%@example.invalid'`;
      const versions = await sql<{ count: string }[]>`
        select count(*)::text as count from brand_version where name in (${brandName}, ${"合成空白报告品牌"})`;
      const snapshots = await sql<{ count: string }[]>`
        select count(*)::text as count from report_snapshot where owner_id in ${sql(accounts.map((item) => item.userId))}`;
      const objects = await sql<{ count: string }[]>`
        select count(*)::text as count from stored_object where owner_id in ${sql(accounts.map((item) => item.userId))}`;
      expect(users[0]?.count).toBe("0");
      expect(versions[0]?.count).toBe("0");
      expect(snapshots[0]?.count).toBe("0");
      expect(objects[0]?.count).toBe("0");
    } finally {
      await sql.end();
    }
  }
});
