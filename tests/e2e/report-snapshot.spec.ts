import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
    businessRate: "可识别引荐转化率 N/A。没有可靠会话分母，未把自报咨询除以访问数。",
    businessCrawler: "爬虫访问观察 1",
    businessInquiries: "去重咨询 1",
    businessAbsent: "这份快照没有业务反馈汇总。",
    metrics: ["提及率", "推荐率", "官网引用率"],
    citationCount: "1 道共同题 · N/A",
    legacyMetric: "历史快照指标 推荐率",
    execution: "执行成果",
    visibility: "可见性观察",
    visits: "站点访问",
    feedback: "业务反馈",
    diagnostic: "诊断复跑。没有核验生效点，经营闭环未完成。",
    executionAbsent: "执行成果缺失。这份快照没有保存核验发布或诊断复跑。",
    visibilityAbsent: "可见性比较缺失。历史指标保持原样，没有可见性结论。",
    visitsAbsent: "站点访问缺失。这份快照没有保存爬虫访问。",
    forbidden: "无效果",
    decisionHeading: "下轮决策",
    decisionEmpty: "还没有保存下轮决策。",
    decisionSave: "保存决策",
    decisionObserve: "继续观察",
    decisionEvidence: "补证据",
    decisionActions: ["继续内容动作", "补证据", "继续观察", "停止"],
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
    businessRate: "Identified-referral conversion N/A. There is no reliable session denominator, so self-reported inquiries are not divided by visits.",
    businessCrawler: "Crawler visit observations 1",
    businessInquiries: "Deduplicated inquiries 1",
    businessAbsent: "This snapshot has no business-feedback summary.",
    metrics: ["Mention rate", "Recommendation rate", "Official site citation rate"],
    citationCount: "1 common question · N/A",
    legacyMetric: "Historical snapshot metric: Recommendation rate",
    execution: "Execution record",
    visibility: "Visibility observations",
    visits: "Site visits",
    feedback: "Business feedback",
    diagnostic: "Diagnostic rerun. There is no verified effective time, and the business loop is not complete.",
    executionAbsent: "The execution record is missing. This snapshot has no saved verification or diagnostic rerun.",
    visibilityAbsent: "Visibility comparisons are missing. The historical metric stays as saved, with no visibility conclusion.",
    visitsAbsent: "Site visits are missing. This snapshot has no saved crawler visits.",
    forbidden: "no effect",
    decisionHeading: "Next-round decision",
    decisionEmpty: "No next-round decision has been saved.",
    decisionSave: "Save decision",
    decisionObserve: "Keep observing",
    decisionEvidence: "Add evidence",
    decisionActions: ["Continue the content work", "Add evidence", "Keep observing", "Stop"],
  },
} as const;

const conclusionCopy = {
  "zh-CN": {
    improved: "观察改善。不建立因果。",
    declined: "观察下降。不建立因果。",
    unchanged: "无变化。不建立因果。",
    inconclusive: "无法判断。不建立因果。",
    incomparable: "不可比较。不建立因果。",
    missing: "可见性结论缺失。已保存的百分点差仍按原数值显示。",
  },
  en: {
    improved: "Observed improvement. This does not establish causality.",
    declined: "Observed decline. This does not establish causality.",
    unchanged: "Unchanged. This does not establish causality.",
    inconclusive: "Inconclusive. This does not establish causality.",
    incomparable: "Not comparable. This does not establish causality.",
    missing: "The visibility conclusion is missing. The saved point difference stays as recorded.",
  },
} as const;

function conclusionLabel(locale: keyof typeof conclusionCopy, value: unknown) {
  const found = Object.entries(conclusionCopy[locale]).find(([key]) => key === value);
  if (!found) throw new Error("unexpected conclusion");
  return found[1];
}

function firstSnapshotObservationId(document: { comparisons?: Record<string, { queries?: Array<{ before?: { observation_ids?: string[] }; after?: { observation_ids?: string[] } }> }> }) {
  for (const block of Object.values(document.comparisons ?? {})) {
    for (const query of block.queries ?? []) {
      const id = query.before?.observation_ids?.[0] ?? query.after?.observation_ids?.[0];
      if (id) return id;
    }
  }
  return "";
}

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
    const lead = await post(context, "/api/reports/leads", {
      brandId,
      rows: [
        { eventId: "evt-self", evidence: "self_report", directIdentifier: false },
        { eventId: "13800138000", evidence: "unknown", directIdentifier: false },
      ],
    });
    expect(lead.leads).toHaveLength(1);
    expect(lead.leads[0]).toMatchObject({ eventId: "evt-self", count: 1, primary: "self_report" });
    expect(lead.rejected).toEqual([{ index: 1, reason: "direct_pii" }]);
    expect(JSON.stringify(lead).includes("13800138000")).toBe(false);
    const rule = await post(context, "/api/reports/lead-rules", {
      brandId, requiresRealNeed: true, requiresIndustry: true, requiresFollowUp: true,
    });
    await post(context, `/api/reports/lead-rules/${rule.rule.id}/freeze`, {});
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dashboard/reports/leads?brandId=${brandId}`);
    await activateFromKeyboard(page, page.getByRole("link", { name: "记录线索反馈", exact: true }));
    const form = page.getByRole("form", { name: "记录线索反馈", exact: true });
    await form.getByLabel("需求真实", { exact: true }).selectOption("1");
    await form.getByLabel("可跟进", { exact: true }).selectOption("1");
    await form.getByLabel("跟进结果", { exact: true }).selectOption("contacted");
    await expectNoOverflow(page);
    await activateFromKeyboard(page, form.getByRole("button", { name: "保存反馈", exact: true }));
    await expect(page.getByText("反馈第 1 版 · 冻结规则第 1 版")).toBeVisible();
    await page.reload();
    await expect(page.getByText("有效性：未知", { exact: true })).toBeVisible();
    await expect(page.getByText("跟进结果：已联系", { exact: true })).toBeVisible();
    await post(context, "/api/reports/crawler-visits", {
      brandId, userAgentClaimsAi: true, identityVerified: false, answerCitations: 0,
    });
    const report = await post(context, "/api/reports", {
      action: "generate-report", brandId, operationId: randomUUID(), retestId: retest.retest.id,
      before, after, locale: "zh-CN", brandName,
    });
    const snapshotId = report.snapshot.id as string;
    expect(snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.snapshot.predecessorId).toBeNull();
    expect(report.loopCompleted).toBe(false);

    const href = `/dashboard/reports?brandId=${brandId}`;
    const seededBody = await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).body();
    const seeded = JSON.parse(seededBody.toString("utf8"));
    expect(seeded.business_feedback.lead_feedback).toMatchObject({
      unknown_qualification: 1, followed_up_inquiries: 1, records: [{ leadId: lead.leads[0].id }],
    });
    expect(seededBody.toString("utf8")).not.toContain("evt-self");
    const { feedbackId } = seeded.business_feedback.lead_feedback.records[0];
    const feedbackHref = `/dashboard/reports/leads?brandId=${brandId}&leadId=${lead.leads[0].id}&feedbackId=${feedbackId}#lead-record`;
    const other = await outsider.newPage();
    await other.goto(feedbackHref);
    await expect(other.getByRole("main")).not.toContainText("evt-self");
    await expect(other.getByRole("main").getByRole("alert")).toBeVisible();
    await other.close();
    const metricKeys = ["mention_rate", "recommendation_rate", "official_site_citation_rate"] as const;
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
        const card = main.getByRole("listitem").filter({ has: page.locator(`a[href="/api/reports/snapshots/${snapshotId}?format=json"]`) });
        await expect(card.getByRole("heading", { name: current.execution, exact: true })).toBeVisible();
        await expect(card.getByRole("heading", { name: current.visibility, exact: true })).toBeVisible();
        await expect(card.getByRole("heading", { name: current.visits, exact: true })).toBeVisible();
        await expect(card.getByRole("heading", { name: current.feedback, exact: true })).toBeVisible();
        await expect(card.getByText(current.diagnostic, { exact: true })).toBeVisible();
        await expect(card.getByText(current.businessInquiries, { exact: true })).toBeVisible();
        const summary = card.getByText(locale === "en" ? "Open saved lead records" : "打开快照中的线索记录", { exact: true });
        await activateFromKeyboard(page, summary);
        const record = card.getByRole("link", { name: locale === "en" ? "Open lead record 1" : "打开线索记录 1", exact: true });
        await expect(record).toHaveAttribute("href", feedbackHref);
        if (width === 375) {
          await activateFromKeyboard(page, record);
          await expect(page.locator("#lead-record")).toContainText("evt-self");
          await expect(page.locator("#lead-record")).toContainText(locale === "en" ? "Follow-up: Contacted" : "跟进结果：已联系");
          await expectNoOverflow(page);
          await page.goto(href);
        }
        await expect(card.getByText(current.businessRate, { exact: true })).toBeVisible();
        await expect(card.getByText(current.businessCrawler, { exact: true })).toBeVisible();
        await expect(card.getByText(current.citationCount, { exact: true })).toBeVisible();
        await expect(card.getByText(current.forbidden)).toHaveCount(0);
        await expect(card.getByRole("heading", { name: current.decisionHeading, exact: true })).toBeVisible();
        await expect(card.getByText(current.decisionEmpty, { exact: true })).toBeVisible();
        await expect(card.getByRole("button", { name: current.decisionSave, exact: true })).toBeVisible();
        for (const label of current.decisionActions) {
          await expect(card.getByRole("radio", { name: label, exact: true })).toBeVisible();
        }
        for (const [index, metric] of metricKeys.entries()) {
          const group = card.getByRole("group", { name: current.metrics[index], exact: true });
          await expect(group).toContainText(conclusionLabel(locale, seeded.comparisons[metric].conclusion));
        }
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        if (width === 375) {
          await expect(download).toBeInViewport();
          await page.screenshot({ path: `${shots}/report-snapshot-current-${locale}-375.png`, fullPage: false });
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
    expect(first.schema_version).toBe("report-v4");
    expect(first.business_feedback).toMatchObject({
      deduped_inquiries: 1,
      self_reported_inquiries: 1,
      self_reported_over_visits: null,
      answer_citations: 0,
      causality: "not_established",
      ai_referral_conversion: { rate: null, reason: "missing_session_denominator" },
      crawler_visits: { count: 1, called_included: false },
    });
    expect(firstHtml).toContain("called_included: false");
    expect(firstHtml).not.toContain("已被 AI 收录");
    expect(firstHtml).not.toContain("无效果");
    expect(firstHtml).not.toContain("没有效果");
    expect(firstHtml).not.toContain("13800138000");
    const htmlSection = (id: string) => {
      const start = firstHtml.indexOf(`<section id="${id}">`);
      return firstHtml.slice(start, firstHtml.indexOf("</section>", start));
    };
    const executionHtml = htmlSection("execution");
    const visitsHtml = htmlSection("crawler-visits");
    const feedbackHtml = htmlSection("business-feedback");
    expect(executionHtml).toContain("诊断复跑");
    expect(executionHtml).not.toContain("观察改善");
    expect(visitsHtml).toContain("爬虫访问观察 1");
    expect(visitsHtml).not.toContain("去重咨询");
    expect(visitsHtml).not.toContain("已被 AI 收录");
    expect(feedbackHtml).toContain("可识别引荐转化率 N/A。没有可靠会话分母");
    expect(feedbackHtml).not.toContain("爬虫访问");
    for (const metric of metricKeys) {
      expect(firstHtml).toContain(conclusionLabel("zh-CN", first.comparisons[metric].conclusion));
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const downloadPromise = page.waitForEvent("download");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].downloadCurrent, exact: true }));
    const downloadFile = await (await downloadPromise).path();
    expect(downloadFile).toBeTruthy();
    expect(Buffer.compare(originalJson, await readFile(downloadFile!))).toBe(0);

    const decisionCard = () => page.getByRole("main").getByRole("listitem").filter({
      has: page.locator(`a[href="/api/reports/snapshots/${snapshotId}?format=json"]`),
    });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(href);
    const zhCard = decisionCard();
    await expect(zhCard.getByText(conclusionCopy["zh-CN"].declined, { exact: true })).toBeVisible();
    const saveDecision = async (card: Locator) => {
      const saved = page.waitForResponse((response) => (
        new URL(response.url()).pathname === "/dashboard/reports" && response.request().method() === "POST"
      ));
      await card.getByRole("button", { name: copy["zh-CN"].decisionSave, exact: true }).click();
      expect((await saved).status()).toBeLessThan(400);
    };
    await zhCard.getByRole("radio", { name: copy["zh-CN"].decisionObserve, exact: true }).check();
    await saveDecision(zhCard);
    const ownerId = accounts[0]?.userId ?? "";
    const observed = zhCard.locator("ol li").filter({ hasText: copy["zh-CN"].decisionObserve });
    await expect(observed).toHaveCount(1);
    await expect(observed).toContainText(ownerId);
    await zhCard.getByRole("radio", { name: copy["zh-CN"].decisionObserve, exact: true }).check();
    await saveDecision(zhCard);
    await expect(observed).toHaveCount(1);
    await zhCard.getByRole("radio", { name: copy["zh-CN"].decisionEvidence, exact: true }).check();
    await saveDecision(zhCard);
    const savedLines = zhCard.locator("ol li");
    await expect(savedLines).toHaveCount(2);
    const savedText = await savedLines.allTextContents();
    const savedTimes = savedText.map((text) => text.match(/20\d{2}-\d{2}-\d{2}T\S+/)?.[0] ?? "");
    expect(savedText[0]).toContain(copy["zh-CN"].decisionObserve);
    expect(savedText[1]).toContain(copy["zh-CN"].decisionEvidence);
    expect(savedTimes[0] < savedTimes[1]).toBeTruthy();
    const afterDecision = Buffer.from(await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).body());
    const jsonSha = createHash("sha256").update(originalJson).digest("hex");
    expect(Buffer.compare(originalJson, afterDecision)).toBe(0);
    expect(createHash("sha256").update(afterDecision).digest("hex")).toBe(jsonSha);
    expect(JSON.parse(afterDecision.toString("utf8")).comparisons.mention_rate.conclusion).toBe("declined");
    const ownerDecisions = await context.request.get(`${origin}/api/reports/snapshots/${snapshotId}/decisions`, {
      headers: { Origin: origin },
    });
    expect(ownerDecisions.ok()).toBeTruthy();
    const ownerDecisionBody = await ownerDecisions.text();
    const ownerDecisionJson = JSON.parse(ownerDecisionBody) as {
      decisions: Array<{ id: string; action: string; decidedAt: string }>;
    };
    expect(ownerDecisionJson.decisions.map((row) => row.action)).toEqual([
      "continue_observation",
      "supplement_evidence",
    ]);
    expect(ownerDecisionJson.decisions[0]?.decidedAt < ownerDecisionJson.decisions[1]?.decidedAt).toBeTruthy();
    expect(ownerDecisionBody).not.toContain("declined");
    expect(ownerDecisionBody).not.toContain("观察下降");
    const deniedRead = await outsider.request.get(`${origin}/api/reports/snapshots/${snapshotId}/decisions`, {
      headers: { Origin: origin },
    });
    expect(deniedRead.status()).toBe(404);
    const deniedReadBody = await deniedRead.text();
    expect(deniedReadBody).not.toContain("declined");
    expect(deniedReadBody).not.toContain("continue_observation");
    expect(deniedReadBody).not.toContain("supplement_evidence");
    expect(deniedReadBody).not.toContain("观察下降");
    expect(deniedReadBody).not.toContain(brandName);
    const deniedWrite = await outsider.request.post(`${origin}/api/reports/snapshots/${snapshotId}/decisions`, {
      headers: { Origin: origin, "content-type": "application/json" },
      data: { action: "stop" },
    });
    expect(deniedWrite.status()).toBe(404);
    const deniedWriteBody = await deniedWrite.text();
    expect(deniedWriteBody).not.toContain("stop");
    expect(deniedWriteBody).not.toContain("declined");
    expect(deniedWriteBody).not.toContain(snapshotId);
    await context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(href);
    const enCard = decisionCard();
    await expect(enCard.getByRole("radio", { name: copy.en.decisionObserve, exact: true })).toBeVisible();
    await expect(enCard.getByRole("radio", { name: copy.en.decisionEvidence, exact: true })).toBeVisible();
    await expect(enCard.locator("ol li").filter({ hasText: copy.en.decisionObserve })).toHaveCount(1);
    await expect(enCard.locator("ol li").filter({ hasText: copy.en.decisionEvidence })).toHaveCount(1);
    await expectNoOverflow(page);
    console.info(
      `Decision rows ${ownerDecisionJson.decisions.map((row) => `${row.id} ${row.action} ${row.decidedAt}`).join(" | ")} on snapshot ${snapshotId}; json sha256 ${jsonSha}`,
    );

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
        await expect(historyRow.getByText(current.businessAbsent, { exact: true })).toBeVisible();
        await expect(historyRow.getByText(current.executionAbsent, { exact: true })).toBeVisible();
        await expect(historyRow.getByText(current.visibilityAbsent, { exact: true })).toBeVisible();
        await expect(historyRow.getByText(current.visitsAbsent, { exact: true })).toBeVisible();
        await expect(historyRow.getByText(conclusionLabel(locale, "improved"))).toHaveCount(0);
        await expect(historyRow.getByRole("button", { name: current.decisionSave, exact: true })).toHaveCount(0);
        const previous = main.getByRole("listitem").filter({
          has: page.locator(`a[href="/api/reports/snapshots/${snapshotId}?format=json"]`),
        });
        await expect(previous.locator("ol li").first()).toContainText(current.decisionObserve);
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
    await expect(page.getByRole("main").getByRole("status")).toHaveText(copy.en.currentTask);
    await expect(page.getByRole("link", { name: copy.en.downloadCurrent, exact: true })).toHaveAttribute("href", `/api/reports/snapshots/${nextId}?format=json`);

    const preservedJson = Buffer.from(await (await context.request.get(`${origin}/api/reports/snapshots/${nextId}?format=json`)).body());
    const preservedHtml = Buffer.from(await (await context.request.get(`${origin}/api/reports/snapshots/${nextId}?format=html`)).body());
    const removedId = firstSnapshotObservationId(JSON.parse(preservedJson.toString("utf8")));
    expect(removedId).toMatch(/^[0-9a-f-]{36}$/);
    const probe = postgres(localDatabaseURL(), { max: 1 });
    try {
      const deleted = await probe`delete from answer_observation where id = ${removedId} and brand_id = ${brandId} returning id`;
      expect(deleted).toHaveLength(1);
    } finally {
      await probe.end();
    }
    const listed = await context.request.get(`${origin}/api/reports?brandId=${encodeURIComponent(brandId)}`, {
      headers: { Origin: origin },
    });
    expect(listed.ok()).toBeTruthy();
    const listBody = await listed.json();
    expect(listBody.sources[nextId].sourceMissing).toBe(true);
    expect(listBody.sources[nextId].missingObservationCount).toBeGreaterThan(0);
    expect(Buffer.from(await (await context.request.get(`${origin}/api/reports/snapshots/${nextId}?format=json`)).body()).equals(preservedJson)).toBe(true);
    expect(Buffer.from(await (await context.request.get(`${origin}/api/reports/snapshots/${nextId}?format=html`)).body()).equals(preservedHtml)).toBe(true);
    const sourceCopy = {
      "zh-CN": "部分源证据已清除，历史快照不可复核原证据",
      en: "Some source evidence has been cleared",
    } as const;
    for (const locale of ["zh-CN", "en"] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const card = page.getByRole("main").getByRole("listitem").filter({
          has: page.locator(`a[href="/api/reports/snapshots/${nextId}?format=json"]`),
        });
        await expect(card.getByRole("note")).toContainText(sourceCopy[locale]);
        await expectNoOverflow(page);
      }
    }

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

const entryCopy = {
  "zh-CN": {
    title: "复测与报告",
    comparison: "同口径对比",
    submit: "发起同口径对比",
    downgrade: "没有核验生效点。本次按诊断复跑记录，经营闭环未完成。",
    reminder: "D+7 站内提醒",
    remind: "登记 D+7 提醒",
    loop: "缺少核验生效点，无法创建经营闭环 D+7 待办。",
    generate: "生成报告快照",
    revise: "标签纠错后生成后继快照",
    excluded: "排除题",
    modified: "题版本已变更",
    recommendation: "3 道共同题 · +66.7pp",
    corrected: "3 道共同题 · +100.0pp",
    citation: "1 道共同题 · N/A",
    missing: "找不到该品牌或报告资源。",
  },
  en: {
    title: "Retest & reports",
    comparison: "Same-scope comparison",
    submit: "Request a same-scope comparison",
    downgrade: "No verified effective time was found. This run is recorded as diagnostic, and the business loop is not complete.",
    reminder: "D+7 in-app reminder",
    remind: "Register the D+7 reminder",
    loop: "A verified effective time is required before creating a business-loop D+7 todo.",
    generate: "Generate the report snapshot",
    revise: "Create a successor after the label correction",
    excluded: "Excluded questions",
    modified: "Question version changed",
    recommendation: "3 common questions · +66.7pp",
    corrected: "3 common questions · +100.0pp",
    citation: "1 common question · N/A",
    missing: "Brand or report resource was not found.",
  },
} as const;

test("report page starts a saved-observation comparison without typed samples", async ({ page, context, browser }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const shots = ".cache/issue-152/report-entry";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `report-entry-${randomUUID()}@example.invalid`;
  const outsiderEmail = `report-entry-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  const entryName = "合成报告入口品牌";
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await post(context, "/api/brands", {
      action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: entryName, description: "仅用于报告入口隔离验收的合成品牌。",
        website: "https://report-entry.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const brandId = savedBrand.id as string;
    const { after } = reportFixture("report-observations", { userId: accounts[0]?.userId, brandId });
    const href = `/dashboard/reports?brandId=${brandId}`;
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    const comparison = page.getByRole("region", { name: entryCopy["zh-CN"].comparison });
    await comparison.getByLabel("意图").selectOption("business_loop");
    await comparison.getByLabel("前窗开始").fill("2026-11-01");
    await comparison.getByLabel("前窗结束（不含当天）").fill("2026-11-08");
    await comparison.getByLabel("后窗开始").fill("2026-11-09");
    await comparison.getByLabel("后窗结束（不含当天）").fill("2026-11-16");
    await activateFromKeyboard(page, comparison.getByRole("button", { name: entryCopy["zh-CN"].submit, exact: true }));
    await expect(page.getByText(entryCopy["zh-CN"].downgrade, { exact: true })).toBeVisible();
    await expect(page.getByText("diagnostic · completed · diagnostic", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/comparison-zh-CN-375.png`, fullPage: false });

    await page.getByRole("button", { name: entryCopy["zh-CN"].generate, exact: true }).click();
    await expect(page.getByText(entryCopy["zh-CN"].recommendation, { exact: true })).toBeVisible();
    await expect(page.getByText(entryCopy["zh-CN"].citation, { exact: true })).toBeVisible();
    await expect(page.getByText(entryCopy["zh-CN"].excluded, { exact: true })).toBeVisible();
    await expect(page.getByText(entryCopy["zh-CN"].modified, { exact: false })).toBeVisible();
    await expect(page.getByText("exploratory · diagnostic · 闭环 否", { exact: true })).toBeVisible();
    const snapshotHref = await page.getByRole("link", { name: "下载 JSON", exact: true }).getAttribute("href");
    const snapshotId = snapshotHref?.match(/snapshots\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    const body = await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).text();
    const document = JSON.parse(body);
    expect(document.comparisons.recommendation_rate.common_query_count).toBe(3);
    expect(document.comparisons.mention_rate.common_query_count).toBe(3);
    expect(document.comparisons.official_site_citation_rate.common_query_count).toBe(1);
    expect(JSON.stringify(document.comparisons.recommendation_rate.queries)).not.toContain("\"numerator\":50");

    await page.getByRole("region", { name: entryCopy["zh-CN"].reminder })
      .getByRole("button", { name: entryCopy["zh-CN"].remind, exact: true }).click();
    await expect(page.getByRole("main").locator("p[role=alert]")).toContainText(entryCopy["zh-CN"].loop);
    await expect(page.getByText("站内提醒不会自动发起付费调用")).toHaveCount(0);

    for (const locale of ["zh-CN", "en"] as const) {
      const current = entryCopy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${href}&error=LOOP_NOT_READY`);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByRole("region", { name: current.comparison })).toBeVisible();
        await expect(main.getByRole("region", { name: current.reminder })).toBeVisible();
        await expect(main.locator("p[role=alert]")).toContainText(current.loop);
        await expect(main.getByText(current.recommendation, { exact: true })).toBeVisible();
        await expect(main.getByText(current.excluded, { exact: true })).toBeVisible();
        if (width === 375) await page.screenshot({ path: `${shots}/entry-${locale}-375.png`, fullPage: false });
        await expectNoOverflow(page);
      }
    }

    reportFixture("correct-observation", { observationId: after.samples[1].observationId });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.getByRole("button", { name: entryCopy["zh-CN"].revise, exact: true }).click();
    await expect(page.getByText(entryCopy["zh-CN"].corrected, { exact: true })).toBeVisible();
    await expect(page.getByText(`created · 上一份 ${snapshotId}`, { exact: true })).toBeVisible();
    await expect(page.getByText("superseded", { exact: true })).toBeVisible();
    const preserved = await (await context.request.get(`/api/reports/snapshots/${snapshotId}?format=json`)).text();
    expect(preserved).toBe(body);
    const successorHref = await page.getByRole("link", { name: "下载当前 JSON", exact: true }).getAttribute("href");
    const successorId = successorHref?.match(/snapshots\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(successorId).not.toBe(snapshotId);
    const successor = JSON.parse(await (await context.request.get(`/api/reports/snapshots/${successorId}?format=json`)).text());
    expect(successor.predecessor_id).toBe(snapshotId);
    expect(successor.comparisons.recommendation_rate.delta_pp).toBe(100);
    expect(successor.evidence[after.samples[1].observationId].analysis_version).toBe(2);

    for (const locale of ["zh-CN", "en"] as const) {
      const current = entryCopy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        const main = page.getByRole("main");
        await expect(main.getByText(current.corrected, { exact: true })).toBeVisible();
        await expect(main.getByRole("button", { name: current.revise, exact: true })).toBeVisible();
        if (width === 375) await page.screenshot({ path: `${shots}/revised-${locale}-375.png`, fullPage: false });
        await expectNoOverflow(page);
      }
    }

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    const hidden = stranger.getByRole("main");
    await expect(hidden.locator("p[role=alert]")).toContainText(entryCopy.en.missing);
    await expect(hidden.getByText(snapshotId)).toHaveCount(0);
    await expect(hidden.getByText(successorId)).toHaveCount(0);
    await expect(hidden.getByRole("button", { name: entryCopy.en.submit, exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/hidden-en-375.png`, fullPage: false });
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
        select count(*)::text as count from "user" where email like 'report-entry-%@example.invalid'`;
      const versions = await sql<{ count: string }[]>`
        select count(*)::text as count from brand_version where name = ${entryName}`;
      const snapshots = accounts.length === 0 ? [{ count: "0" }] : await sql<{ count: string }[]>`
        select count(*)::text as count from report_snapshot where owner_id in ${sql(accounts.map((item) => item.userId))}`;
      expect(users[0]?.count).toBe("0");
      expect(versions[0]?.count).toBe("0");
      expect(snapshots[0]?.count).toBe("0");
    } finally {
      await sql.end();
    }
  }
});
