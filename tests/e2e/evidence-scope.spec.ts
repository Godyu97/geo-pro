import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const day = "2026-11-20T08:00:00.000Z";
const nextDay = "2026-11-21T08:00:00.000Z";

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

async function verifyEmail(userId: string) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  try {
    await sql`update "user" set email_verified = true where id = ${userId}`;
  } finally {
    await sql.end();
  }
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertObservations(input: {
  ownerId: string;
  brandId: string;
  rows: Array<{
    id: string;
    sourceMode: "model_api" | "consumer_ui";
    captureMethod: "official_api" | "manual";
    questionText: string;
    targetRegion: string;
    observedRegion: string;
    requestedNetworkMode: "on" | "off" | "unknown";
    capturedAt: string;
    recommended: "true" | "false";
  }>;
}) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  try {
    for (const row of input.rows) {
      await sql`
        insert into answer_observation (
          id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
          fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
          evidence_state, locator_ref, collector_id, missing_reason, created_at,
          target_region, observed_region, new_session, product_mode, network_trigger
        ) values (
          ${row.id}, ${input.brandId}, ${input.ownerId}, null, null, ${row.sourceMode}, ${row.captureMethod},
          ${row.questionText}, ${"隔离范围样本，不得用于真实营销。"}, ${sha(row.id)}, ${row.capturedAt},
          ${row.targetRegion}, ${"zh-CN"}, ${row.requestedNetworkMode}, 1, ${"complete"}, ${"complete"},
          null, null, null, ${row.capturedAt}, ${row.targetRegion}, ${row.observedRegion}, ${"unknown"},
          ${"unknown"}, ${"unknown"}
        )`;
      await sql`
        insert into answer_analysis_version (
          id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
          official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
        ) values (
          ${randomUUID()}, ${row.id}, ${input.brandId}, 1, 1, ${"s-m0-06-v1"}, ${"true"}, ${row.recommended},
          ${"false"}, null, ${"classified"}, null, null, null, ${row.capturedAt}
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

test("evidence scope stays on overview, answers and detail in both locales", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `scope-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let userId = "";
  const ids = {
    consumer: randomUUID(),
    officialOff: randomUUID(),
    officialOtherRegion: randomUUID(),
    officialOn: randomUUID(),
    officialUnknown: randomUUID(),
    officialLater: randomUUID(),
  };
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "范围验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    await verifyEmail(userId);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("范围样本品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于隔离验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://scope-brand.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "范围样本品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();
    await insertObservations({
      ownerId: userId,
      brandId: brandId!,
      rows: [
        { id: ids.consumer, sourceMode: "consumer_ui", captureMethod: "manual", questionText: "消费者样本", targetRegion: "CN", observedRegion: "CN", requestedNetworkMode: "off", capturedAt: day, recommended: "true" },
        { id: ids.officialOff, sourceMode: "model_api", captureMethod: "official_api", questionText: "官方关联网", targetRegion: "CN", observedRegion: "US", requestedNetworkMode: "off", capturedAt: day, recommended: "true" },
        { id: ids.officialOtherRegion, sourceMode: "model_api", captureMethod: "official_api", questionText: "官方其他地区", targetRegion: "US", observedRegion: "CN", requestedNetworkMode: "off", capturedAt: day, recommended: "true" },
        { id: ids.officialOn, sourceMode: "model_api", captureMethod: "official_api", questionText: "官方开联网", targetRegion: "CN", observedRegion: "CN", requestedNetworkMode: "on", capturedAt: day, recommended: "false" },
        { id: ids.officialUnknown, sourceMode: "model_api", captureMethod: "official_api", questionText: "官方未知联网", targetRegion: "CN", observedRegion: "CN", requestedNetworkMode: "unknown", capturedAt: day, recommended: "true" },
        { id: ids.officialLater, sourceMode: "model_api", captureMethod: "official_api", questionText: "官方次日", targetRegion: "CN", observedRegion: "CN", requestedNetworkMode: "off", capturedAt: nextDay, recommended: "true" },
      ],
    });

    await page.goto(`/dashboard/monitoring/overview?brandId=${brandId}`);
    const overview = page.locator("#main-content");
    await expect(overview.getByRole("heading", { name: "可解释概览", exact: true })).toBeVisible();
    await overview.getByRole("combobox", { name: "轨道", exact: true }).selectOption("consumer_ui");
    await overview.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page).toHaveURL(/sourceMode=consumer_ui/);
    await expect(page.getByText("消费者样本", { exact: true })).toBeVisible();
    await expect(page.getByText("官方关联网", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "查看回答列表", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`sourceMode=consumer_ui`));
    await expect(page.getByText("当前范围 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByText("消费者样本", { exact: true })).toBeVisible();
    await expect(page.getByText("官方关联网", { exact: true })).toHaveCount(0);
    const consumerEvidence = page.getByRole("link", { name: "查看证据", exact: true });
    await expect(consumerEvidence).toHaveAttribute("href", new RegExp(ids.consumer));
    await page.getByRole("link", { name: "返回概览", exact: true }).click();
    await expect(page).toHaveURL(/sourceMode=consumer_ui/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#overview-source-mode")).toHaveValue("consumer_ui");

    await page.locator("#overview-region").fill("CN");
    await page.locator("#overview-network").selectOption("off");
    await page.locator("#overview-from").fill("2026-11-20T00:00:00.000Z");
    await page.locator("#overview-to").fill("2026-11-20T23:59:59.999Z");
    await page.locator("#overview-source-mode").selectOption("model_api");
    await expect(page.locator("#overview-region")).toHaveValue("CN");
    await expect(page.locator("#overview-source-mode")).toHaveValue("model_api");
    await page.getByRole("button", { name: "应用筛选", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sourceMode=model_api/);
    await expect(page).toHaveURL(/region=CN/);
    await expect(page).toHaveURL(/requestedNetworkMode=off/);
    await expect(page.getByText("官方关联网", { exact: true })).toBeVisible();
    for (const excluded of ["消费者样本", "官方其他地区", "官方开联网", "官方未知联网", "官方次日"]) {
      await expect(page.getByText(excluded, { exact: true })).toHaveCount(0);
    }
    await page.getByRole("link", { name: "查看回答列表", exact: true }).click();
    await expect(page.getByText("当前范围 1 条回答", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI 回答列表", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "相关入口" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "查看证据", exact: true })).toHaveAttribute("href", new RegExp(`${ids.officialOff}.*region=CN`));
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      if (width === 375) {
        const back = page.getByRole("link", { name: "返回概览", exact: true });
        await back.focus();
        await expect(back).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "查看证据", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/evidence/${ids.officialOff}`));
    await expect(page).toHaveURL(/requestedNetworkMode=off/);
    await page.getByRole("link", { name: "返回回答列表", exact: true }).click();
    await expect(page).toHaveURL(/region=CN/);
    await expect(page).toHaveURL(/requestedNetworkMode=off/);
    await expect(page.getByText("官方关联网", { exact: true })).toBeVisible();
    await expect(page.getByText("官方未知联网", { exact: true })).toHaveCount(0);

    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(/sourceMode=model_api/);
    await expect(page).toHaveURL(/region=CN/);
    await expect(page.getByRole("heading", { name: "AI answer list", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Related entries" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText("1 answer in this scope", { exact: true })).toBeVisible();
    await expect(page.getByText("官方关联网", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View evidence", exact: true })).toHaveAttribute("href", new RegExp(ids.officialOff));
    await expect(page.locator("#main-content").getByRole("textbox", { name: "Target region", exact: true })).toHaveValue("CN");
    await expect(page.locator("#main-content").getByRole("combobox", { name: "Requested network", exact: true })).toHaveValue("off");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      if (width === 375) {
        const back = page.getByRole("link", { name: "Back to overview", exact: true });
        await back.focus();
        await expect(back).toBeFocused();
      }
    }

    await page.locator("#main-content").getByRole("textbox", { name: "Target region", exact: true }).fill("JP");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.getByText("0 answers in this scope", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI answer list", exact: true })).toBeVisible();
    await expect(page.getByText("This scope has no samples. Change the track, target region, requested network, or time above.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 900 });
    await expectNoOverflow(page);
    await expect(page.getByLabel("Target region", { exact: true })).toBeVisible();
    await expect(page.getByText("官方关联网", { exact: true })).toHaveCount(0);
  } finally {
    if (userId) cleanupAccount(userId, email);
  }
});
