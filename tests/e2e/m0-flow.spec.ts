import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const brandName = "北岸设备";
const website = "https://beian-equipment.example.com";
const questions = [
  ["30 家门店如何管理设备巡检？", "discovery"],
  ["支持离线巡检的设备管理产品怎么选？", "scenario"],
  ["预算有限的连锁门店怎样比较报修系统？", "constraint"],
  ["北岸设备和远帆设备有什么不同？", "comparison"],
] as const;
const facts = [
  ["specification", "离线巡检", "支持离线巡检。合成产品说明，不得用于真实营销。", "合成产品说明第 1 节"],
  ["price", "门店报价", "价格按门店数报价。合成报价说明，不得用于真实营销。", "合成报价说明第 2 节"],
  ["region", "服务范围", "服务范围覆盖示例门店。合成日期说明，不得用于真实营销。", "合成服务说明第 3 节"],
] as const;
const runCopy = {
  "zh-CN": {
    title: "监测运行", back: "返回运行确认", openReceipts: "查看槽位和回执", receipts: "槽位和回执",
    scope: "地区 CN，业务语言 zh-CN", budget: "预算与费用", cost: /^实际费用 CNY\s*0\.03$/,
    progress: "成功 3，失败 1，待核对 0，未执行 0，已取消 0", planned: "计划分母 4",
    loading: "正在读取运行…", failure: "暂时无法读取运行。重新加载可查看最新进度。",
    retry: "重新加载", notFound: "当前账号无法查看此运行。",
  },
  en: {
    title: "Monitoring run", back: "Back to run confirmation", openReceipts: "View slots and receipts", receipts: "Slots and receipts",
    scope: "Region CN, business language zh-CN", budget: "Budget and cost", cost: /^Actual cost CNY\s*0\.03$/,
    progress: "3 succeeded, 1 failed, 0 pending, 0 not started, 0 cancelled", planned: "Planned denominator 4",
    loading: "Loading the run…", failure: "The run could not be loaded. Reload to check the latest progress.",
    retry: "Reload", notFound: "This run is unavailable for your account.",
  },
};

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function fixture(command: string, payload: object) {
  const stdout = execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", command, JSON.stringify(payload),
  ], { encoding: "utf8" });
  return JSON.parse(stdout) as Record<string, string | number | boolean>;
}

async function verifyEmail(userId: string) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  try {
    await sql`update "user" set email_verified = true where id = ${userId}`;
  } finally {
    await sql.end();
  }
}

function choose(root: Page | Locator, name: string, value: string) {
  return root.getByRole("combobox", { name, exact: true }).selectOption(value);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    let node: Element | null = null;
    let right = width;
    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (box.right > right + 1) {
        right = box.right;
        node = element;
      }
    }
    const text = (node?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return { scrollWidth: document.documentElement.scrollWidth, width, text };
  });
  expect(overflow, overflow ? `${overflow.scrollWidth}>${overflow.width} ${overflow.text}` : undefined).toBeNull();
}

async function createFact(page: Page, category: string, title: string, claim: string, excerpt: string) {
  await choose(page, "事实类型", category);
  await page.getByLabel("简称", { exact: true }).fill(title);
  await page.getByLabel("主张", { exact: true }).fill(claim);
  await page.getByLabel("来源网址或材料说明", { exact: true }).fill("合成材料，不得用于真实营销");
  await page.getByLabel("出处位置（页码、段落或章节）", { exact: true }).fill(excerpt);
  await page.getByLabel("来源片段", { exact: true }).fill(claim);
  await page.getByLabel("来源日期", { exact: true }).fill("2026-11-01");
  await choose(page, "主张公开许可", "public");
  await choose(page, "有效期", "longTerm");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("已保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交待确认", exact: true }).click();
  await page.getByRole("checkbox", { name: "我已逐条核对主张、来源和公开许可。", exact: true }).check();
  await page.getByRole("button", { name: "确认此版本", exact: true }).click();
  await expect(page.getByText("已批准", { exact: true }).first()).toBeVisible();
  const id = new URL(page.url()).searchParams.get("fact");
  expect(id).toBeTruthy();
  return id!;
}

function windowSample(queryId: string, numerator: number, queryVersion = `${queryId}-v1`) {
  return {
    observationId: randomUUID(), queryId, queryVersion, track: "model_api", channelVersion: "1",
    protocolVersion: "m0-fixture", analysisRuleVersion: "m0-fixture", region: "CN", entityVersion: 1,
    judgable: true, numerator, denominator: 1, brandQuestion: queryId === "q4",
  };
}

test("北岸设备 isolated M0 flow, i18n matrix and negative paths", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `m0-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const outsiderEmail = `m0-out-${randomBytes(8).toString("hex")}@example.invalid`;
  let userId = "";
  let outsiderId = "";
  let channelIds: string[] = [];
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "北岸验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id;
    await verifyEmail(userId);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill(brandName);
    await page.getByLabel("一句话业务", { exact: true }).fill("合成连锁门店设备巡检品牌，仅用于隔离验收。");
    await page.getByLabel("官网地址", { exact: true }).fill(website);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("远帆设备");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
    await expect(page.getByText("本地验收 · 合成资料", { exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();

    await page.goto(`/dashboard/brands/${brandId}/facts`);
    const factIds: string[] = [];
    for (const [category, title, claim, excerpt] of facts) {
      factIds.push(await createFact(page, category, title, claim, excerpt));
      if (factIds.length < facts.length) {
        await page.getByRole("link", { name: "录入新事实", exact: true }).click();
        await expect(page.getByRole("heading", { name: "录入事实", exact: true })).toBeVisible();
      }
    }

    const sidebar = page.getByRole("navigation", { name: "工作台导航" });
    const questionsLink = sidebar.getByRole("link", { name: "提示词问题库", exact: true });
    await questionsLink.click();
    await expect(page).toHaveURL(`/dashboard/brands/${brandId}/questions`);
    await expect(questionsLink).toHaveAttribute("aria-current", "page");
    await page.getByLabel("问题簇 1 受众", { exact: true }).fill("连锁门店设备负责人");
    await page.getByLabel("问题簇 1 意图", { exact: true }).fill("比较巡检与报修条件");
    await page.getByLabel("主页面（可待补）", { exact: true }).fill(`${website}/faq`);
    await page.getByLabel("承接动作（可待补）", { exact: true }).fill("查看合成说明");
    await page.getByLabel("逐行粘贴题目", { exact: true }).fill(questions.map(([text]) => text).join("\n"));
    await page.getByRole("button", { name: "加入粘贴的题目", exact: true }).click();
    for (const [index, [, type]] of questions.entries()) {
      const group = page.getByRole("group", { name: `题目 ${index + 1} 文本` });
      await choose(group, "题型", type);
      await choose(group, `题目 ${index + 1} 状态`, "confirmed");
    }
    const comparison = page.getByRole("group", { name: "题目 4 文本" });
    await expect(comparison).toContainText("此题不计入自然发现主指标。");
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByLabel("Question 4 text", { exact: true })).toHaveValue(questions[3][0]);
    await expect(page.getByText("No frozen version yet.", { exact: true })).toBeVisible();
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(comparison.getByLabel("题目 4 文本", { exact: true })).toHaveValue(questions[3][0]);
    await page.getByRole("button", { name: "冻结题集", exact: true }).click();
    await expect(page.getByText("预算预览输入：4 个已确认题，主指标 3 题，地区 CN，语言 zh-CN。").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "第 1 版" })).toBeVisible();

    const prepared = fixture("prepare", { userId, brandId });
    channelIds = [String(prepared.apiChannelId), String(prepared.consumerChannelId)];
    await page.goto(`/dashboard/brands/${brandId}?version=1`);
    await expect(page.getByText(/正在查看历史实体版本/)).toBeVisible();
    await expect(page.getByRole("link", { name: "确认此品牌的监测运行", exact: true })).toHaveCount(0);
    await page.goto(`/dashboard/brands/${brandId}`);
    await expect(page.getByRole("heading", { name: "监测准备", exact: true })).toBeVisible();
    await expect(page.getByText("已确认自然发现题 3 / 3，确认题共 4", { exact: true })).toBeVisible();
    const readiness = page.getByRole("region", { name: "监测准备" });
    const viewport = page.viewportSize();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await readiness.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    if (viewport) await page.setViewportSize(viewport);
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.getByRole("heading", { name: "Monitoring readiness", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Confirm monitoring for this brand", exact: true })).toHaveAttribute("href", `/dashboard/monitoring/new?brandId=${brandId}`);
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh-CN");
    await page.getByRole("link", { name: "确认此品牌的监测运行", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/dashboard/monitoring/new?brandId=${brandId}`);
    await page.getByRole("checkbox", { name: "北岸隔离 API 可用于正式登记", exact: true }).check();
    await page.getByRole("button", { name: "预览范围", exact: true }).click();
    await expect(page.getByText("没有可信费用上界，不能登记官方 API 运行。", { exact: true })).toBeVisible();
    await page.getByLabel("上界（最小货币单位）", { exact: true }).fill("10");
    await page.getByRole("button", { name: "预览范围", exact: true }).click();
    await expect(page.getByText("范围内 4 题，自然发现 3 题，通道 1 个，重复 1 次，逻辑槽位 4 个。")).toBeVisible();
    await expect(page.getByText(`品牌 ${brandName}`, { exact: true })).toBeVisible();
    await expect(page.getByText("北岸隔离 API，版本 2", { exact: true })).toBeVisible();
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.getByText(`Brand: ${brandName}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Question set version 1, region CN, business language zh-CN", { exact: true })).toBeVisible();
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh-CN");
    await page.getByRole("button", { name: "登记排队运行", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/monitoring\/runs\/[0-9a-f-]{36}$/);
    await page.setViewportSize({ width: 375, height: 900 });
    const execute = page.getByRole("button", { name: "执行官方采样", exact: true });
    await expect(execute).toBeInViewport();
    const confirmationPath = `/dashboard/monitoring/new?brandId=${brandId}`;
    const runURL = page.url();
    const runId = runURL.split("/").at(-1)!;
    const back = page.getByRole("link", { name: runCopy["zh-CN"].back, exact: true });
    await expect(back).toHaveAttribute("href", confirmationPath);
    await back.focus();
    await page.keyboard.press("Tab");
    await expect(execute).toBeFocused();
    expect(await execute.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("run-queued-zh-CN-375.png") });
    await back.press("Enter");
    await expect(page).toHaveURL(confirmationPath);
    await page.getByRole("link", { name: `查看运行 ${runId.slice(0, 8)}`, exact: true }).press("Enter");
    await expect(page).toHaveURL(runURL);
    await page.getByRole("button", { name: "暂停未执行单元", exact: true }).press("Enter");
    await expect(page.getByText("进度已更新。", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText("已暂停", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "继续未执行单元", exact: true }).press("Enter");
    await expect(page.locator("main").getByText("排队中", { exact: true })).toBeVisible();
    const queuedRead = await page.request.get(`/api/monitoring/runs/${runId}`, { headers: { Origin: baseURL } });
    expect(queuedRead.ok()).toBe(true);
    const queued = (await queuedRead.json()).run;
    expect(queued.slots.map((slot: { status: string }) => slot.status)).toEqual(Array(4).fill("queued"));
    expect(queued.attempts).toHaveLength(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("link", { name: `${brandName}，实体版本 1`, exact: true })).toHaveAttribute("href", `/dashboard/brands/${brandId}?version=1`);
    await expect(page.getByText(`通道 ${channelIds[0]}，版本 2`, { exact: true })).toBeVisible();
    expect(fixture("sample", { ownerId: userId, runId }).synthetic).toBe(true);
    await page.reload();
    await expect(page.getByText("成功 3，失败 1，待核对 0，未执行 0，已取消 0")).toBeVisible();
    await expect(page.getByText("隔离合成结果").first()).toBeVisible();
    await expect(page.getByText("隔离传输的结果会标明合成。它不是真实采样。")).toBeVisible();
    await expect(page.getByText("执行只发送已冻结的题目和已确认的采样条件。调用前会记下本次尝试和费用上界。超时、中断或未知回执进入待核对并保留预留；确认没有产生费用后，才按原上界重试。")).toBeVisible();
    await expect(page.getByRole("button", { name: "执行官方采样", exact: true })).toBeVisible();
    await expect(page.getByText("真实供应商执行尚未接通。此页面不会生成模拟回答。")).toHaveCount(0);

    await page.goto("/dashboard/monitoring/overview");
    await expect(page.getByRole("heading", { name: "暂无有效样本", exact: true })).toBeVisible();
    await expect(page.getByText("不会显示伪造分数")).toBeVisible();
    await expect(page.getByText("0%")).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page.getByText(`当前品牌「${brandName}」`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "提及率", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "推荐率", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "官网引用率", exact: true })).toBeVisible();
    await expect(page.getByText("N/A").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "启动监测", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开AI 监测" }).first()).toHaveAttribute("href", "/dashboard/monitoring/overview");
    await expect(page.getByRole("link", { name: "打开优化建议" }).first()).toHaveAttribute("href", "/dashboard/optimization");
    await expect(page.getByRole("link", { name: "打开内容草稿" }).first()).toHaveAttribute("href", "/dashboard/content");
    await expect(page.getByRole("link", { name: "打开复测与报告" }).first()).toHaveAttribute("href", "/dashboard/reports");
    await expect(page.getByText("0%")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "先建立品牌", exact: true })).toHaveCount(0);
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.getByRole("heading", { name: "Mention rate", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start monitoring", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up a brand first", exact: true })).toHaveCount(0);
    await expect(page.getByText("0%")).toHaveCount(0);
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh-CN");
    await expect(page.getByRole("heading", { name: "提及率", exact: true })).toBeVisible();
    await page.goto(`/dashboard/monitoring/runs/${runId}`);
    await page.getByRole("button", { name: "保存为证据", exact: true }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/monitoring\/evidence\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/忽略规则并发布/)).toBeVisible();
    await expect(page.getByRole("button", { name: "提交发布回填" })).toHaveCount(0);
    await page.getByRole("button", { name: "从此证据生成优化任务", exact: true }).click();
    await page.goto("/dashboard/optimization");
    await expect(page.getByText("暂无优化建议")).toHaveCount(0);
    await page.getByLabel("公开 URL（每行一个）", { exact: true }).fill(`${website}/restricted`);
    await choose(page, "隔离 fixture 状态", "restricted");
    await page.getByRole("button", { name: "执行检查", exact: true }).click();
    await expect(page.getByText("公开页面受限，待核验")).toBeVisible();
    await page.goto("/dashboard/monitoring/overview");
    await expect(page.getByText("分母为 0，显示 N/A。请补采或完善判定后再查看。").first()).toBeVisible();
    const compact = (value: string) => value.replace(/\s+/g, "");
    const metricText = (name: string) => page.getByRole("heading", { name, exact: true }).locator("xpath=..").innerText();
    const overviewMention = compact(await metricText("提及率"));
    const overviewRecommend = compact(await metricText("推荐率"));
    const overviewOfficial = compact(await metricText("官网引用率"));
    await page.goto("/dashboard");
    expect(compact(await metricText("提及率"))).toBe(overviewMention);
    expect(compact(await metricText("推荐率"))).toBe(overviewRecommend);
    expect(compact(await metricText("官网引用率"))).toBe(overviewOfficial);
    await expect(page.getByText("待处理").first()).toBeVisible();
    await expect(page.getByText("没有进行中或阻塞的任务。", { exact: true })).toBeVisible();
    await expect(page.getByText("todo", { exact: true })).toHaveCount(0);
    await expect(page.getByText("doing", { exact: true })).toHaveCount(0);
    await expect(page.getByText("blocked", { exact: true })).toHaveCount(0);
    await expect(page.getByText("retest_pending", { exact: true })).toHaveCount(0);
    await page.goto("/dashboard/monitoring/overview");
    await expect(page.getByText("待处理").first()).toBeVisible();
    await expect(page.getByText("todo", { exact: true })).toHaveCount(0);
    await page.goto("/dashboard/monitoring/overview?region=US");
    await expect(page.getByRole("heading", { name: "暂无有效样本", exact: true })).toBeVisible();
    await expect(page.getByText("0%")).toHaveCount(0);

    await page.goto("/dashboard/monitoring/new");
    await page.getByRole("radio", { name: "消费者人工", exact: true }).check();
    await page.getByRole("checkbox", { name: "北岸隔离人工 可用于正式登记", exact: true }).check();
    await page.getByRole("button", { name: "预览范围", exact: true }).click();
    await page.getByRole("button", { name: "登记排队运行", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/monitoring\/runs\/[0-9a-f-]{36}$/);
    const manual = await page.request.post("/api/monitoring/answers", {
      headers: { origin: baseURL },
      data: {
        action: "submit-manual", brandId, operationId: randomUUID(),
        questionText: questions[2][0],
        answerText: "隔离人工存证：北岸设备支持离线巡检。这不是真实消费者采集。",
        region: "CN", language: "zh-CN", requestedNetworkMode: "unknown", entityVersion: 1,
        citationSetState: "complete", citations: [], locatorRef: "fixture-screen-beian",
        collectorId: "fixture-operator", contested: false, brandName, aliases: [], officialWebsite: website,
      },
    });
    expect(manual.status()).toBe(200);
    const observationId = (await manual.json()).observation.id as string;
    await page.goto(`/dashboard/monitoring/evidence/${observationId}`);
    await expect(page.getByText("隔离人工存证：北岸设备支持离线巡检。这不是真实消费者采集。")).toBeVisible();
    await page.goto("/dashboard/monitoring/answers?sourceMode=consumer_ui");
    await expect(page.getByText(questions[2][0], { exact: true })).toBeVisible();

    await page.goto("/dashboard/content");
    const cluster = page.getByLabel("问题簇", { exact: true });
    await cluster.fill("北岸巡检草稿");
    const posts: string[] = [];
    const trackPosts = (request: Request) => {
      if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
    };
    page.on("request", trackPosts);
    await cluster.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
    page.off("request", trackPosts);
    expect(posts).toEqual([]);
    await expect(page.getByText("暂无 Brief。先填写受众、缺口、适用边界与可用事实。")).toBeVisible();
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("No briefs yet. Add audience, gap, applicable boundary, and usable facts first.")).toBeVisible();
    await page.getByLabel("Interface language", { exact: true }).selectOption("zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    const briefs = [
      ["离线巡检 FAQ", "离线巡检怎么做"],
      ["门店报价说明", "门店数报价说明"],
      ["服务范围说明", "服务范围说明"],
    ];
    for (const [clusterName, title] of briefs) {
      await page.getByLabel("问题簇", { exact: true }).fill(clusterName);
      await page.getByLabel("受众", { exact: true }).fill("连锁门店设备负责人");
      await page.getByLabel("目标缺口", { exact: true }).fill("FAQ 缺少可核验说明");
      await page.getByLabel("适用边界", { exact: true }).fill("仅合成验收，不用于真实营销");
      await page.getByLabel("主页面 / 计划页", { exact: true }).fill(`${website}/faq`);
      await page.getByLabel("承接动作", { exact: true }).fill("阅读合成说明");
      await page.getByLabel("标题候选（每行一个，最多 3）", { exact: true }).fill(title);
      await page.getByLabel("批准事实版本 ID", { exact: true }).fill(factIds.join("\n"));
      await page.getByRole("button", { name: "保存草稿", exact: true }).click();
      await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
      await page.getByRole("link", { name: title, exact: true }).click();
      await page.getByRole("button", { name: "确认 Brief", exact: true }).click();
      await expect(page.getByText("confirmed", { exact: true })).toBeVisible();
      await page.goto("/dashboard/content");
    }
    const briefIds = (await page.getByRole("textbox", { name: "已确认 Brief ID（每行一个，1–5）", exact: true }).inputValue()).split(/\s+/).filter(Boolean);
    expect(briefIds).toHaveLength(3);
    await page.getByLabel("隔离失败的 Brief ID（可选，每行一个）", { exact: true }).fill(briefIds[2]);
    await page.getByRole("button", { name: "生成草稿", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/content\/batches\//);
    const units = page.locator("section").filter({ has: page.getByRole("heading", { name: "批次单元", exact: true }) });
    await expect(units.locator("li").filter({ hasText: "succeeded" })).toHaveCount(2);
    await expect(units.locator("li").filter({ hasText: "fixture_forced_failure" })).toHaveCount(1);
    await page.getByRole("button", { name: "仅重试失败项", exact: true }).click();
    await expect(units.locator("li").filter({ hasText: "succeeded" })).toHaveCount(3);

    await page.goto("/dashboard/content");
    await page.locator("section").filter({ has: page.getByRole("heading", { name: "稿件版本", exact: true }) })
      .getByRole("link", { name: briefs[0][1], exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/content\/versions\/[0-9a-f-]{36}/);
    const versionUrl = page.url().split("?")[0];
    await choose(page, "标识核实状态", "verified");
    await page.getByRole("button", { name: "保存变体修改", exact: true }).click();
    await page.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(page.getByRole("button", { name: "批准（自审）", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "批准（自审）", exact: true }).click();
    await expect(page.getByText("当前批准仍有效。", { exact: true })).toBeVisible();
    await choose(page, "导出类型", "formal");
    await page.getByRole("button", { name: "运行预检", exact: true }).click();
    await expect(page.getByText("可导出", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认导出所选合格版本", exact: true }).click();
    await expect(page.getByText("导出完成", { exact: true })).toBeVisible();
    const pack = await page.request.get(await page.getByRole("link", { name: "下载 content.md" }).getAttribute("href") ?? "");
    expect(pack.status()).toBe(200);
    expect(await pack.text()).toContain(facts[0][2]);

    const publishedBody = await page.getByRole("textbox", { name: "正文（Markdown）", exact: true }).inputValue();
    async function publish(path: string, accessClass: string, body: string) {
      await page.goto(versionUrl);
      await expect(page.getByRole("heading", { name: "发布回填与核验", exact: true })).toBeVisible();
      const textbox = (name: string) => page.getByRole("textbox", { name, exact: true });
      await textbox("公开 URL").fill(`${website}${path}`);
      await textbox("目标账号 / 页面归属").fill("fixture-owner");
      await textbox("用户申报发布时间").fill("2026-11-18T02:00:00.000Z");
      await textbox("渠道声明确认").fill("隔离验收，不是真实发布");
      await choose(page, "访问类别", accessClass);
      await textbox("页面正文（fixture）").fill(body);
      await page.getByRole("button", { name: "提交发布回填", exact: true }).click();
    }
    await publish("/draft", "draft_box", "草稿链接，不能算公开发布");
    await expect(page.getByText("draft_only", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("无（草稿/受限不计生效）")).toBeVisible();
    await page.goto(versionUrl);
    await publish("/published", "public", publishedBody);
    await expect(page.getByText("verified_public", { exact: true }).first()).toBeVisible();
    const publicationId = page.url().match(/\/publications\/([0-9a-f-]{36})/)?.[1];
    const effectiveAt = (await page.locator("body").innerText()).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
    expect(publicationId && effectiveAt).toBeTruthy();

    await page.goto(versionUrl);
    await page.getByLabel("标题", { exact: true }).fill("离线巡检怎么做（已改）");
    await page.getByRole("button", { name: "保存变体修改", exact: true }).click();
    await expect(page.getByText("invalidated", { exact: true })).toBeVisible();

    const before = {
      start: "2026-11-01", endExclusive: "2026-11-08",
      samples: ["q1", "q2", "q3", "q4"].map((id) => windowSample(id, 0)),
    };
    const after = {
      start: "2026-11-08", endExclusive: "2026-11-15",
      samples: [
        windowSample("q1", 1), windowSample("q2", 0), windowSample("q3", 1), windowSample("q4", 1, "q4-v2"),
      ],
    };
    const closed = await page.request.post("/api/reports", {
      data: {
        action: "request-retest", brandId, operationId: randomUUID(), kind: "exploratory", intent: "business_loop",
        track: "model_api", timezone: "Asia/Shanghai", entityVersion: 1, before, after, locale: "zh-CN",
      },
    });
    expect(closed.status()).toBe(200);
    expect((await closed.json()).loopCompleted).toBe(false);
    const retest = await page.request.post("/api/reports", {
      data: {
        action: "request-retest", brandId, operationId: randomUUID(), kind: "exploratory", intent: "business_loop",
        track: "model_api", timezone: "Asia/Shanghai", entityVersion: 1, before, after, publicationId, effectiveAt,
        locale: "zh-CN",
      },
    });
    expect(retest.status()).toBe(200);
    const retestId = (await retest.json()).retest.id as string;
    const report = await page.request.post("/api/reports", {
      data: {
        action: "generate-report", brandId, operationId: randomUUID(), retestId, before, after,
        publicationId, effectiveAt, locale: "zh-CN", brandName,
      },
    });
    expect(report.status()).toBe(200);
    const reportResult = await report.json();
    expect(reportResult.loopCompleted).toBe(true);
    const currentSnapshotId: string = reportResult.snapshot.id;
    const snapshotRow = (locale: "zh-CN" | "en") => page.getByRole("region", {
      name: locale === "en" ? "Report snapshots" : "报告快照",
      exact: true,
    }).getByRole("listitem").filter({
      has: page.locator(`a[href="/api/reports/snapshots/${currentSnapshotId}?format=json"]`),
    });
    const reportsLink = sidebar.getByRole("link", { name: "复测与报告", exact: true });
    await reportsLink.click();
    await expect(page).toHaveURL("/dashboard/reports");
    await expect(reportsLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("diagnostic")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "相关入口" })).toBeVisible();
    const currentSnapshot = snapshotRow("zh-CN");
    await expect(currentSnapshot.getByText("闭环 是")).toBeVisible();
    const jsonHref = await currentSnapshot.getByRole("link", { name: "下载 JSON", exact: true }).getAttribute("href");
    const htmlHref = await currentSnapshot.getByRole("link", { name: "下载 HTML", exact: true }).getAttribute("href");
    const firstJson = await page.request.get(jsonHref!);
    const secondJson = await page.request.get(jsonHref!);
    expect(Buffer.compare(await firstJson.body(), await secondJson.body())).toBe(0);
    const snapshot = await firstJson.json();
    expect(JSON.stringify(snapshot)).toContain(brandName);
    expect(snapshot.cost).toEqual({ status: "not_applicable", reason: "no_sampling_cost" });
    expect(snapshot.labor).toEqual({ status: "not_applicable", reason: "unrecorded" });
    await expect(currentSnapshot.getByText("已知费用 N/A")).toBeVisible();
    await expect(currentSnapshot.getByText("待核对费用 N/A")).toBeVisible();
    await expect(currentSnapshot.getByText("窗口内没有可关联的采样费用")).toBeVisible();
    await expect(currentSnapshot.getByText("人工工时 N/A")).toBeVisible();
    await expect(currentSnapshot.getByText("未记录人工工时")).toBeVisible();
    await context.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    const englishJson = await page.request.get(jsonHref!);
    expect(Buffer.compare(await firstJson.body(), await englishJson.body())).toBe(0);
    const html = await (await page.request.get(htmlHref!)).text();
    expect(html).toContain(brandName);
    expect(html).toContain("未记录人工工时");
    expect(html).not.toContain("unrecorded");
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);

    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: "生成导出文件", exact: true }).click();
    const downloadResponse = page.waitForResponse((response) => response.url().includes("/api/data-exports/") && response.request().method() === "GET");
    await page.getByRole("button", { name: "下载 JSON", exact: true }).click();
    const disposition = (await downloadResponse).headers()["content-disposition"];
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? "")).toContain("个人数据");

    const paths = [
      `/dashboard/monitoring/runs/${runId}`,
      "/dashboard/monitoring/overview",
      "/dashboard/monitoring/answers?sourceMode=consumer_ui",
      "/dashboard/content",
      "/dashboard/reports",
      "/dashboard/brands",
    ];
    for (const locale of ["zh-CN", "en"] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      const probe = await page.request.get(paths[1]);
      expect(await probe.text()).toContain(`<html lang="${locale}"`);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of paths) {
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expectNoOverflow(page);
          if (path === paths[0]) {
            const copy = runCopy[locale];
            const main = page.locator("main");
            const title = main.getByRole("heading", { level: 1, name: copy.title, exact: true });
            await expect(main).toHaveCount(1);
            await expect(title).toBeInViewport();
            await expect(main.getByText(copy.planned, { exact: true })).toBeInViewport();
            await expect(main.getByText(copy.progress, { exact: true })).toBeInViewport();
            await expect(main.getByText(copy.scope, { exact: true })).toBeVisible();
            await expect(main.getByRole("region", { name: copy.budget }).getByText(copy.cost)).toBeVisible();
            const receiptsLink = main.getByRole("link", { name: copy.openReceipts, exact: true });
            const receipts = main.getByRole("region", { name: copy.receipts, exact: true });
            const back = main.getByRole("link", { name: copy.back, exact: true });
            await expect(back).toHaveAttribute("href", confirmationPath);
            await expect(receiptsLink).toBeInViewport();
            await back.focus();
            await page.keyboard.press("Tab");
            await expect(receiptsLink).toBeFocused();
            expect(await receiptsLink.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
            if (width === 375) await page.screenshot({ path: testInfo.outputPath(`run-partial-${locale}-375.png`) });
            await page.keyboard.press("Enter");
            await expect(page).toHaveURL(`${runURL}#run-receipts`);
            await expect(receipts).toBeFocused();
            await expect(receipts.getByRole("row")).toHaveCount(5);
            await expect(receipts.getByText(/隔离合成回答/)).toHaveCount(3);
            if (width === 375) {
              await page.keyboard.press("ArrowRight");
              await expect.poll(() => receipts.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
              await expectNoOverflow(page);
            }

            await context.addCookies([{ name: "geo-run-read", value: "slow-unavailable", url: baseURL }]);
            await page.goto(runURL, { waitUntil: "commit" });
            await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
            await expect(title).toBeVisible();
            await expect(main.getByRole("alert")).toHaveText(copy.failure);
            await expect(title).toBeVisible();
            await expect(receipts).toHaveCount(0);
            await expect(main).not.toContainText("Private run fixture failure");
            await expectNoOverflow(page);
            const retry = main.getByRole("button", { name: copy.retry, exact: true });
            await expect(retry).toBeInViewport();
            await expect(back).toHaveAttribute("href", "/dashboard/monitoring/new");
            await context.clearCookies({ name: "geo-run-read" });
            await back.focus();
            await page.keyboard.press("Shift+Tab");
            await expect(retry).toBeFocused();
            if (width === 375) await page.screenshot({ path: testInfo.outputPath(`run-failure-${locale}-375.png`) });
            await page.keyboard.press("Enter");
            await expect(main.getByText(copy.progress, { exact: true })).toBeInViewport();
            await expect(page).toHaveURL(runURL);
          }
          if (path.includes("/dashboard/reports")) {
            await expect(page.locator("main")).toHaveCount(1);
            await expect(page.getByRole("navigation", { name: locale === "en" ? "Related entries" : "相关入口" })).toBeVisible();
            const row = snapshotRow(locale);
            await expect(row.getByText(locale === "en" ? "loop yes" : "闭环 是")).toBeVisible();
            await expect(row.getByText(locale === "en" ? "Known cost N/A" : "已知费用 N/A")).toBeVisible();
            await expect(row.getByText(locale === "en" ? "Cost pending reconciliation N/A" : "待核对费用 N/A")).toBeVisible();
            await expect(row.getByText(locale === "en" ? "No sampling cost can be associated in this window" : "窗口内没有可关联的采样费用")).toBeVisible();
            await expect(row.getByText(locale === "en" ? "Labor hours were not recorded" : "未记录人工工时")).toBeVisible();
            await expect(page.getByText("0 分")).toHaveCount(0);
            await expect(page.getByText("0 minor")).toHaveCount(0);
            if (width === 375) {
              const entry = page.getByRole("link", { name: locale === "en" ? "Open the observation plan" : "打开观察计划" });
              await entry.focus();
              await expect(entry).toBeFocused();
            }
          }
          if (path.startsWith("/dashboard/monitoring/answers")) {
            await expect(page.locator("main")).toHaveCount(1);
            await expect(page.getByRole("heading", { name: locale === "en" ? "AI answer list" : "AI 回答列表" })).toBeVisible();
            await expect(page.getByRole("navigation", { name: locale === "en" ? "Related entries" : "相关入口" })).toBeVisible();
            await expect(page.getByRole("link", { name: locale === "en" ? "View evidence" : "查看证据" }).first()).toBeVisible();
            if (width === 375) {
              const entry = page.getByRole("link", { name: locale === "en" ? "Back to overview" : "返回概览" });
              await entry.focus();
              await expect(entry).toBeFocused();
            }
          }
          if (path === "/dashboard/monitoring/overview") {
            await expect(page.locator("main")).toHaveCount(1);
            await expect(page.getByRole("heading", { name: locale === "en" ? "Explainable overview" : "可解释概览" })).toBeVisible();
            await expect(page.getByRole("navigation", { name: locale === "en" ? "Related entries" : "相关入口" })).toBeVisible();
            await expect(page.getByRole("link", { name: locale === "en" ? "View answers" : "查看回答列表" })).toBeVisible();
            if (width === 375) {
              const entry = page.getByRole("link", { name: locale === "en" ? "Open demo space" : "打开演示空间" });
              await entry.focus();
              await expect(entry).toBeFocused();
            }
          }
          if (path === "/dashboard/brands") {
            await expect(page.locator("main")).toHaveCount(1);
            await expect(page.getByRole("heading", { name: locale === "en" ? "Brand workspace" : "品牌资料", exact: true })).toBeVisible();
            await expect(page.getByRole("navigation", { name: locale === "en" ? "Related entries" : "相关入口" })).toBeVisible();
            await expect(page.getByRole("link", { name: locale === "en" ? "View brand" : "查看品牌", exact: true })).toBeVisible();
            await expect(page.getByText(brandName, { exact: true }).first()).toBeVisible();
            if (width === 375) {
              const entry = page.getByRole("link", { name: locale === "en" ? "Record a local observation" : "登记本地观察", exact: true });
              await entry.focus();
              await expect(entry).toBeFocused();
            }
          }
          if (path === "/dashboard/content") {
            await expect(page.locator("main")).toHaveCount(1);
            await expect(page.getByRole("heading", { name: locale === "en" ? "Content plans and drafts" : "内容计划与草稿" })).toBeVisible();
            await expect(page.getByRole("navigation", { name: locale === "en" ? "Related entries" : "相关入口" })).toBeVisible();
            await expect(page.getByRole("button", { name: locale === "en" ? "Save draft" : "保存草稿" })).toBeVisible();
            await expect(page.getByText(locale === "en" ? /Gaps \d+/ : /补证 \d+/).first()).toBeVisible();
            if (width === 375) {
              const entry = page.getByRole("link", { name: locale === "en" ? "Content calendar" : "内容日历" });
              await entry.focus();
              await expect(entry).toBeFocused();
            }
          }
        }
      }
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: locale === "en" ? "Skip to main content" : "跳转到主要内容" })).toBeFocused();
    }

    const outsider = await browser.newContext({ baseURL });
    const outsiderAccount = await registerTestAccount(outsider, { name: "越权验收", email: outsiderEmail, password });
    expect(outsiderAccount.status()).toBe(200);
    outsiderId = (await outsiderAccount.json()).user.id;
    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto("/dashboard");
    await expect(outsiderPage).toHaveURL(/\/dashboard$/);
    await expect(outsiderPage.getByRole("heading", { name: "先建立品牌", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "前往品牌", exact: true })).toBeVisible();
    await expect(outsiderPage.getByText(brandName)).toHaveCount(0);
    await expect(outsiderPage.getByText("N/A", { exact: true })).toHaveCount(0);
    await outsiderPage.setViewportSize({ width: 375, height: 900 });
    await outsiderPage.goto("/dashboard/monitoring/overview");
    await expect(outsiderPage.getByRole("heading", { name: "可解释概览", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "前往品牌资料", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "相关入口" })).toBeVisible();
    await expect(outsiderPage.locator("main")).toHaveCount(1);
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await outsiderPage.goto("/dashboard/monitoring/overview");
    await expect(outsiderPage.getByRole("heading", { name: "Explainable overview", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "Go to brands", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "Related entries" })).toBeVisible();
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await outsiderPage.goto("/dashboard/content");
    await expect(outsiderPage.getByRole("heading", { name: "内容计划与草稿", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "前往品牌", exact: true })).toBeVisible();
    await expect(outsiderPage.locator("main")).toHaveCount(1);
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await outsiderPage.goto("/dashboard/content");
    await expect(outsiderPage.getByRole("heading", { name: "Content plans and drafts", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "Go to brands", exact: true })).toBeVisible();
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await outsiderPage.goto("/dashboard/brands");
    await expect(outsiderPage.getByRole("heading", { name: "品牌资料", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "建立品牌或继续草稿", exact: true })).toBeVisible();
    await expect(outsiderPage.getByText("还没有活跃品牌。")).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "相关入口" })).toBeVisible();
    await expect(outsiderPage.locator("main")).toHaveCount(1);
    await expectNoOverflow(outsiderPage);
    await expect(outsiderPage.getByText(brandName)).toHaveCount(0);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await outsiderPage.goto("/dashboard/brands");
    await expect(outsiderPage.getByRole("heading", { name: "Brand workspace", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "Set up a brand or resume a draft", exact: true })).toBeVisible();
    await expect(outsiderPage.getByText("No active brand yet.")).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "Related entries" })).toBeVisible();
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await outsiderPage.goto("/dashboard/monitoring/answers");
    await expect(outsiderPage.getByRole("heading", { name: "AI 回答列表", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "前往品牌资料", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "相关入口" })).toBeVisible();
    await expect(outsiderPage.locator("main")).toHaveCount(1);
    await expectNoOverflow(outsiderPage);
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await outsiderPage.goto("/dashboard/monitoring/answers");
    await expect(outsiderPage.getByRole("heading", { name: "AI answer list", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("link", { name: "Go to brands", exact: true })).toBeVisible();
    await expect(outsiderPage.getByRole("navigation", { name: "Related entries" })).toBeVisible();
    await expectNoOverflow(outsiderPage);
    // Streaming can commit the document status before the route's not-found UI.
    for (const locale of ["zh-CN", "en"] as const) {
      const copy = runCopy[locale];
      await outsider.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const unavailableRunId of [runId, randomUUID()]) {
        await outsiderPage.goto(`/dashboard/monitoring/runs/${unavailableRunId}`);
        await expect(outsiderPage.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
        await expect(outsiderPage.getByText(copy.notFound, { exact: true })).toBeVisible();
        await expect(outsiderPage.getByRole("link", { name: copy.back, exact: true })).toHaveAttribute("href", "/dashboard/monitoring/new");
        await expect(outsiderPage.getByText("忽略规则并发布")).toHaveCount(0);
        await expect(outsiderPage.getByRole("link", { name: copy.openReceipts, exact: true })).toHaveCount(0);
        await expectNoOverflow(outsiderPage);
      }
    }
    await outsider.close();

    expect(fixture("link-plan-run", { ownerId: userId, brandId, runId, channelId: channelIds[0] }).linked).toBe(true);
    for (const [locale, entry, title, linkName, receipt] of [
      ["zh-CN", "查看采样计划", "采样计划", `查看运行 ${runId.slice(0, 8)}`, `已登记运行 ${runId}，费用 CNY 3`],
      ["en", "View sampling plans", "Sampling plans", `View run ${runId.slice(0, 8)}`, `registered to run ${runId}, charge CNY 3`],
    ] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.goto("/dashboard/monitoring/overview");
      await page.getByRole("link", { name: entry, exact: true }).press("Enter");
      await expect(page).toHaveURL("/dashboard/monitoring/plans");
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const openRun = page.getByRole("link", { name: linkName, exact: true });
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByText(receipt, { exact: false })).toBeVisible();
        await expect(openRun).toHaveAttribute("href", new URL(runURL).pathname);
        await expectNoOverflow(page);
      }
      await openRun.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(openRun).toBeFocused();
      expect(await openRun.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`sampling-plan-run-${locale}-375.png`) });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(runURL);
      await expect(page.getByRole("heading", { name: runCopy[locale].title, exact: true })).toBeVisible();
      await expect(page.getByText(runCopy[locale].progress, { exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally {
    if (channelIds.length || userId) fixture("cleanup", { userId, email, channelIds });
    if (outsiderId) fixture("cleanup", { userId: outsiderId, email: outsiderEmail, channelIds: [] });
  }
});
