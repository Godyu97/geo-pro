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

function question(clusterId: string, text: string, primary = false) {
  return {
    id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary,
  };
}

async function insertListFixture(input: {
  ownerId: string;
  brandId: string;
  installCluster: string;
  budgetCluster: string;
  ids: { install: string; maintain: string; budget: string; parts: string };
}) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  try {
    const [brand] = await sql`
      select entity_version from brand where id = ${input.brandId} and owner_id = ${input.ownerId}`;
    const content = {
      clusters: [
        { id: input.installCluster, audience: "安装用户", intent: "完成安装", primaryPage: "", conversionAction: "" },
        { id: input.budgetCluster, audience: "预算用户", intent: "比较价格", primaryPage: "", conversionAction: "" },
      ],
      questions: [
        question(input.installCluster, "如何安装这个设备", true),
        question(input.installCluster, "日常维护怎么做"),
        question(input.budgetCluster, "预算大概多少"),
        question(input.budgetCluster, "配件是否通用"),
      ],
    };
    await sql`
      insert into prompt_set (
        brand_id, id, set_id, version, entity_version, region, language, content, created_at
      ) values (
        ${input.brandId}, ${randomUUID()}, ${randomUUID()}, 1, ${brand.entity_version}, ${"CN"}, ${"zh-CN"},
        ${JSON.stringify(content)}, ${day}
      )`;
    const rows = [
      { id: input.ids.install, questionText: "如何安装这个设备", answerText: "按说明书固定", mentioned: "true", recommended: "true", officialSiteCited: "false" },
      { id: input.ids.maintain, questionText: "日常维护怎么做", answerText: "定期清洁", mentioned: "true", recommended: "false", officialSiteCited: "true" },
      { id: input.ids.budget, questionText: "预算大概多少", answerText: "暂无明确报价", mentioned: "true", recommended: "unknown", officialSiteCited: "false" },
      { id: input.ids.parts, questionText: "配件是否通用", answerText: "需要核对密封圈型号", mentioned: "unknown", recommended: "true", officialSiteCited: "unknown" },
    ];
    for (const row of rows) {
      await sql`
        insert into answer_observation (
          id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
          fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
          evidence_state, locator_ref, collector_id, missing_reason, created_at,
          target_region, observed_region, new_session, product_mode, network_trigger
        ) values (
          ${row.id}, ${input.brandId}, ${input.ownerId}, null, null, ${"model_api"}, ${"official_api"},
          ${row.questionText}, ${row.answerText}, ${sha(row.id)}, ${day}, ${"CN"}, ${"zh-CN"}, ${"off"},
          ${brand.entity_version}, ${"complete"}, ${"complete"}, null, null, null, ${day},
          ${"CN"}, ${"CN"}, ${"unknown"}, ${"unknown"}, ${"unknown"}
        )`;
      await sql`
        insert into answer_analysis_version (
          id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
          official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
        ) values (
          ${randomUUID()}, ${row.id}, ${input.brandId}, 1, ${brand.entity_version}, ${"s-m0-06-v1"},
          ${row.mentioned}, ${row.recommended}, ${row.officialSiteCited}, null, ${"classified"}, null, null, null, ${day}
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

test("answer list filters stay on the detail round trip in both locales", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `answers-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let userId = "";
  const installCluster = randomUUID();
  const budgetCluster = randomUUID();
  const ids = {
    install: randomUUID(),
    maintain: randomUUID(),
    budget: randomUUID(),
    parts: randomUUID(),
  };
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "列表筛选", email, password });
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
    await page.getByLabel("品牌名称", { exact: true }).fill("列表筛选品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于隔离验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://answer-list.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "列表筛选品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();
    await insertListFixture({ ownerId: userId, brandId: brandId!, installCluster, budgetCluster, ids });

    const scope = new URLSearchParams({
      brandId: brandId!,
      sourceMode: "model_api",
      region: "CN",
      requestedNetworkMode: "off",
      from,
      to,
    });
    await page.goto(`/dashboard/monitoring/answers?${scope.toString()}`);
    await expect(page.getByRole("heading", { name: "AI 回答列表", exact: true })).toBeVisible();
    await expect(page.getByText("当前范围 4 条回答", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "题目或原文", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "问题簇", exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: "题目或原文", exact: true }).fill("安装");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/region=CN/);
    await expect(page).toHaveURL(/requestedNetworkMode=off/);
    await expect(page).toHaveURL(/from=/);
    await expect(page.getByText("当前结果 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("如何安装这个设备", { exact: true })).toBeVisible();
    for (const hidden of ["日常维护怎么做", "预算大概多少", "配件是否通用"]) {
      await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
    }
    const overviewHref = await page.getByRole("link", { name: "返回概览", exact: true }).getAttribute("href");
    expect(overviewHref).toContain("region=CN");
    expect(overviewHref).not.toContain("q=");
    await page.getByRole("link", { name: "返回概览", exact: true }).click();
    await expect(page.getByText("如何安装这个设备", { exact: true })).toBeVisible();
    await expect(page.getByText("日常维护怎么做", { exact: true })).toBeVisible();
    await expect(page.getByText("预算大概多少", { exact: true })).toBeVisible();

    await page.goto(`/dashboard/monitoring/answers?${scope.toString()}&q=${encodeURIComponent("安装")}`);
    await expect(page.getByRole("link", { name: "查看证据", exact: true })).toHaveAttribute("href", new RegExp(ids.install));
    await page.getByRole("link", { name: "查看证据", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/evidence/${ids.install}`));
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/region=CN/);
    await page.getByRole("link", { name: "返回回答列表", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=`));
    await expect(page).toHaveURL(/region=CN/);
    await expect(page).toHaveURL(/requestedNetworkMode=off/);
    await expect(page).toHaveURL(/from=/);
    await expect(page).toHaveURL(new RegExp(`#answer-${ids.install}`));
    await expect(page.getByText("当前结果 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("如何安装这个设备", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "清除列表筛选", exact: true }).click();
    await expect(page.getByText("当前范围 4 条回答", { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page).toHaveURL(/region=CN/);
    await page.getByRole("combobox", { name: "问题簇", exact: true }).selectOption(installCluster);
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.getByText("当前结果 2 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("如何安装这个设备", { exact: true })).toBeVisible();
    await expect(page.getByText("日常维护怎么做", { exact: true })).toBeVisible();
    await expect(page.getByText("预算大概多少", { exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: "清除列表筛选", exact: true }).click();
    await page.getByRole("combobox", { name: "推荐", exact: true }).selectOption("unknown");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.getByText("当前结果 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("预算大概多少", { exact: true })).toBeVisible();
    await expect(page.getByText("日常维护怎么做", { exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "推荐", exact: true }).selectOption("false");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page.getByText("日常维护怎么做", { exact: true })).toBeVisible();
    await expect(page.getByText("预算大概多少", { exact: true })).toHaveCount(0);

    await page.getByRole("combobox", { name: "推荐", exact: true }).selectOption("unknown");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(/recommended=unknown/);
    await expect(page).toHaveURL(/region=CN/);
    await expect(page.getByRole("heading", { name: "AI answer list", exact: true })).toBeVisible();
    await expect(page.getByText("1 matching answer", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Question or answer text", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Question cluster", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Recommended", exact: true })).toHaveValue("unknown");
    await expect(page.getByText("预算大概多少", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View evidence", exact: true })).toHaveAttribute("href", new RegExp(ids.budget));
    await expect(page.getByRole("link", { name: "Clear list filters", exact: true })).toBeVisible();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      if (width === 375) {
        const keyword = page.getByRole("textbox", { name: "Question or answer text", exact: true });
        await keyword.focus();
        await expect(keyword).toBeFocused();
      }
    }
  } finally {
    if (userId) cleanupAccount(userId, email);
  }
});
