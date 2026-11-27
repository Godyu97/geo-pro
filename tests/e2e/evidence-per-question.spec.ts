import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const day = "2026-11-20T08:00:00.000Z";
const from = "2026-11-20T00:00:00.000Z";
const to = "2026-11-20T23:59:59.999Z";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [] }),
  ], { stdio: "inherit" });
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertQuestionFixture(input: { ownerId: string; brandId: string }) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const rows = [
    { questionText: "购买怎么选", answerText: "选购金样甲", mentioned: "true", recommended: "true", officialSiteCited: "unknown", ownership: "owned_domain" },
    { questionText: "购买怎么选", answerText: "选购金样乙", mentioned: "true", recommended: "false", officialSiteCited: "unknown", ownership: "unknown" },
    { questionText: "售后怎么保", answerText: "保修说明甲", mentioned: "true", recommended: "true", officialSiteCited: "true", ownership: "competitor" },
    { questionText: "售后怎么保", answerText: "保修说明乙", mentioned: "false", recommended: "true", officialSiteCited: "true", ownership: "competitor" },
    { questionText: "售后怎么保", answerText: "保修说明丙", mentioned: "false", recommended: "true", officialSiteCited: "false", ownership: "competitor" },
    { questionText: "安装是否复杂", answerText: "安装步骤单独记录", mentioned: "true", recommended: "unknown", officialSiteCited: "false", ownership: "competitor" },
  ];
  try {
    const [brand] = await sql`
      select entity_version from brand where id = ${input.brandId} and owner_id = ${input.ownerId}`;
    for (const row of rows) {
      const id = randomUUID();
      await sql`
        insert into answer_observation (
          id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
          fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
          evidence_state, locator_ref, collector_id, missing_reason, created_at,
          target_region, observed_region, new_session, product_mode, network_trigger
        ) values (
          ${id}, ${input.brandId}, ${input.ownerId}, null, null, ${"model_api"}, ${"official_api"},
          ${row.questionText}, ${row.answerText}, ${sha(id)}, ${day}, ${"CN"}, ${"zh-CN"}, ${"off"},
          ${brand.entity_version}, ${"complete"}, ${"complete"}, null, null, null, ${day},
          ${"CN"}, ${"CN"}, ${"unknown"}, ${"unknown"}, ${"unknown"}
        )`;
      await sql`
        insert into answer_analysis_version (
          id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
          official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
        ) values (
          ${randomUUID()}, ${id}, ${input.brandId}, 1, ${brand.entity_version}, ${"s-m0-06-v1"},
          ${row.mentioned}, ${row.recommended}, ${row.officialSiteCited}, null, ${"classified"}, null, null, null, ${day}
        )`;
      await sql`
        insert into answer_citation (
          id, observation_id, brand_id, raw_url, normalized_url, citation_origin, position_label, ownership, page_status, created_at
        ) values (
          ${randomUUID()}, ${id}, ${input.brandId}, ${"https://owned.example.com/page"}, ${"https://owned.example.com/page"},
          ${"provider_native"}, null, ${row.ownership}, ${"unknown"}, ${day}
        )`;
    }
  } finally {
    await sql.end();
  }
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

function questionRow(page: Page, question: string) {
  return page.locator("#overview-question-table").getByRole("row").filter({
    has: page.getByRole("rowheader", { name: question, exact: true }),
  });
}

test("overview lists four per-question fractions without following answer filters", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `questions-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let userId = "";
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "逐题验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    const sql = postgres(localDatabaseURL(), { max: 1 });
    try {
      await sql`update "user" set email_verified = true where id = ${userId}`;
    } finally {
      await sql.end();
    }
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("逐题样本品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于隔离验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://per-question.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "逐题样本品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();
    await insertQuestionFixture({ ownerId: userId, brandId: brandId! });

    const scope = new URLSearchParams({
      brandId: brandId!,
      sourceMode: "model_api",
      region: "CN",
      requestedNetworkMode: "off",
      from,
      to,
    });
    await page.goto(`/dashboard/monitoring/overview?${scope.toString()}`);
    const overview = page.locator("#main-content");
    await expect(overview.getByRole("heading", { name: "可解释概览", exact: true })).toBeVisible();
    const recommend = overview.locator("section").filter({ has: page.getByRole("heading", { name: "推荐率", exact: true }) });
    await expect(recommend).toContainText("75.0%");
    await expect(recommend).toContainText("4/5");
    const table = page.locator("#overview-question-table");
    await expect(table.getByRole("columnheader", { name: "提及率", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "推荐率", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "官网引用率", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "自有页引用率", exact: true })).toBeVisible();
    await expect(overview.getByText("分母为 0 时该格显示 N/A", { exact: false })).toBeVisible();

    const choose = questionRow(page, "购买怎么选");
    await expect(choose.getByRole("cell").nth(0)).toHaveText("2/2 (100.0%)");
    await expect(choose.getByRole("cell").nth(1)).toHaveText("1/2 (50.0%)");
    await expect(choose.getByRole("cell").nth(2)).toContainText("N/A");
    await expect(choose.getByRole("cell").nth(2)).toContainText("未知 2");
    await expect(choose.getByRole("cell").nth(2)).not.toContainText("0.0%");
    await expect(choose.getByRole("cell").nth(3)).toContainText("1/1 (100.0%)");
    await expect(choose.getByRole("cell").nth(3)).toContainText("未知 1");

    const support = questionRow(page, "售后怎么保");
    await expect(support.getByRole("cell").nth(0)).toHaveText("1/3 (33.3%)");
    await expect(support.getByRole("cell").nth(1)).toHaveText("3/3 (100.0%)");
    await expect(support.getByRole("cell").nth(2)).toHaveText("2/3 (66.7%)");
    await expect(support.getByRole("cell").nth(3)).toHaveText("0/3 (0.0%)");

    const install = questionRow(page, "安装是否复杂");
    await expect(install.getByRole("cell").nth(0)).toHaveText("1/1 (100.0%)");
    await expect(install.getByRole("cell").nth(1)).toContainText("N/A");
    await expect(install.getByRole("cell").nth(1)).toContainText("未知 1");
    await expect(install.getByRole("cell").nth(1)).not.toContainText("0/1");
    await expect(install.getByRole("cell").nth(1)).not.toContainText("0.0%");

    await overview.getByRole("link", { name: "查看回答列表", exact: true }).click();
    await expect(page.getByText("当前范围 6 条回答", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "题目或原文", exact: true }).fill("选购金样");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(page.getByText("当前结果 2 条回答", { exact: true })).toBeVisible();
    const overviewHref = await page.getByRole("link", { name: "返回概览", exact: true }).getAttribute("href");
    expect(overviewHref).toContain("region=CN");
    expect(overviewHref).toContain("requestedNetworkMode=off");
    expect(overviewHref).not.toContain("q=");
    await page.getByRole("link", { name: "返回概览", exact: true }).click();
    await expect(questionRow(page, "购买怎么选").getByRole("cell").nth(1)).toHaveText("1/2 (50.0%)");
    await expect(questionRow(page, "售后怎么保").getByRole("cell").nth(1)).toHaveText("3/3 (100.0%)");
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(1)).toContainText("N/A");
    await expect(recommend).toContainText("4/5");

    await page.goto(`/dashboard/monitoring/answers?${scope.toString()}`);
    await page.getByRole("combobox", { name: "推荐", exact: true }).selectOption("unknown");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.getByText("当前结果 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("安装是否复杂", { exact: true })).toBeVisible();
    await expect(page.getByText("购买怎么选", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "返回概览", exact: true }).click();
    await expect(page).not.toHaveURL(/recommended=/);
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(0)).toHaveText("1/1 (100.0%)");
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(1)).toContainText("未知 1");
    await expect(questionRow(page, "购买怎么选").getByRole("cell").nth(1)).toHaveText("1/2 (50.0%)");

    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(table.getByRole("columnheader", { name: "Mention rate", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Recommendation rate", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Official-site citation rate", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Owned-page citation rate", exact: true })).toBeVisible();
    await expect(overview.getByText("A cell shows N/A when its denominator is 0", { exact: false })).toBeVisible();
    const englishRecommend = overview.locator("section").filter({ has: page.getByRole("heading", { name: "Recommendation rate", exact: true }) });
    await expect(englishRecommend).toContainText("75.0%");
    await expect(englishRecommend).toContainText("4/5");
    await expect(questionRow(page, "购买怎么选").getByRole("cell").nth(1)).toHaveText("1/2 (50.0%)");
    await expect(questionRow(page, "购买怎么选").getByRole("cell").nth(2)).toContainText("Unknown 2");
    await expect(questionRow(page, "售后怎么保").getByRole("cell").nth(1)).toHaveText("3/3 (100.0%)");
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(1)).toContainText("N/A");
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(1)).toContainText("Unknown 1");

    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      if (width === 375) {
        const scrolls = await table.evaluate((element) => element.scrollWidth > element.clientWidth);
        expect(scrolls).toBe(true);
        await expect(table.getByRole("columnheader", { name: "Owned-page citation rate", exact: true })).toHaveText("Owned-page citation rate");
      }
    }

    await page.getByRole("link", { name: "View answers", exact: true }).click();
    const installationAnswer = page.locator("li[id^='answer-']").filter({ hasText: "安装是否复杂" });
    await installationAnswer.getByRole("link", { name: "View evidence", exact: true }).click();
    const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Correct labels", exact: true }) });
    await expect(form.getByRole("combobox", { name: "Recommended", exact: true })).toHaveValue("unknown");
    // LAN HTTP origins expose getRandomValues but omit randomUUID in Chrome.
    await page.evaluate(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
    await form.getByRole("combobox", { name: "Recommended", exact: true }).selectOption("false");
    await form.getByRole("textbox", { name: "Revision reason", exact: true }).fill("The saved answer lists installation steps without a recommendation.");
    const save = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/monitoring/answers" && response.request().method() === "POST");
    await form.getByRole("button", { name: "Save revision", exact: true }).press("Enter");
    const saved = await save;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON().operationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    await expect(page.getByText("Version 2 · classified", { exact: true })).toBeVisible();
    await expect(page.getByText("安装步骤单独记录", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to overview", exact: true }).click();
    await expect(questionRow(page, "安装是否复杂").getByRole("cell").nth(1)).toHaveText("0/1 (0.0%)");
  } finally {
    if (userId) cleanupAccount(userId, email);
  }
});
