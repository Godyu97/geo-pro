import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
// Keep the unstarted slot inside the filter window and ahead of the server clock.
const reference = new Date();
reference.setUTCHours(0, 0, 0, 0);
function fixtureTime(days: number, hours = 0) {
  return new Date(reference.getTime() + (days * 24 + hours) * 3_600_000).toISOString();
}
const soloFrom = fixtureTime(-7);
const soloAt = fixtureTime(-7, 8);
const planFrom = fixtureTime(-5);
const planTo = fixtureTime(2);
const pendingAt = fixtureTime(-5, 2);
const ownedAt = fixtureTime(-5, 3.5);
const emptyAt = fixtureTime(-5, 4.5);
const answer = "隔离覆盖回答，不得用于真实营销。";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string, channelId: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [channelId] }),
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

async function insertCoverageFixture(input: {
  ownerId: string;
  brandId: string;
  channelId: string;
  findingId: string;
  taskId: string;
}) {
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const planId = randomUUID();
  const run = async (
    planSlotId: string,
    at: string,
    questionText: string,
    requestedNetworkMode: "on" | "off",
    networkTrigger: "unknown" | "not_triggered",
    citations: string[],
  ) => {
    const runId = randomUUID();
    const monitorId = randomUUID();
    const observationId = randomUUID();
    await sql`
      insert into monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) values (
        ${runId}, ${input.brandId}, ${input.ownerId}, ${randomUUID()}, ${"d".repeat(64)}, 'model_api', ${randomUUID()}, 1,
        1, 1, 1, 1, 1, 'CN', 'zh-CN', ${requestedNetworkMode}, 'CNY', 10, 10, 0, 'queued', 0, ${at}
      )`;
    await sql`
      insert into monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
        reservation_id, status, created_at, adopted_attempt_id, late
      ) values (
        ${monitorId}, ${runId}, ${input.brandId}, ${randomUUID()}, 1, ${input.channelId}, 1, 1,
        null, 'failed', ${at}, null, 0
      )`;
    await sql`
      insert into sampling_due_run (
        id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
        kind, status, monitoring_run_id, charged_minor, prompt_ids_json, created_at
      ) values (
        ${randomUUID()}, ${planId}, 1, ${input.brandId}, ${input.ownerId}, ${input.channelId}, ${pendingAt.slice(0, 10)}, ${planSlotId},
        'Asia/Shanghai', 'official', 'accepted', ${runId}, 0, null, ${at}
      )`;
    await sql`
      insert into answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
        evidence_state, locator_ref, collector_id, missing_reason, created_at,
        target_region, observed_region, new_session, product_mode, network_trigger
      ) values (
        ${observationId}, ${input.brandId}, ${input.ownerId}, ${monitorId}, null, 'model_api', 'official_api',
        ${questionText}, ${answer}, ${sha(observationId)}, ${at}, 'CN', 'zh-CN', ${requestedNetworkMode}, 1, 'complete',
        'complete', null, null, null, ${at}, 'CN', 'unknown', 'unknown', 'unknown', ${networkTrigger}
      )`;
    await sql`
      insert into answer_analysis_version (
        id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
        official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
      ) values (
        ${randomUUID()}, ${observationId}, ${input.brandId}, 1, 1, 's-m0-06-v1', 'true', 'true',
        'false', null, 'classified', null, null, null, ${at}
      )`;
    for (const ownership of citations) {
      await sql`
        insert into answer_citation (
          id, observation_id, brand_id, raw_url, normalized_url, citation_origin, position_label, ownership, page_status, created_at
        ) values (
          ${randomUUID()}, ${observationId}, ${input.brandId}, 'https://owned.example.com/page', 'https://owned.example.com/page',
          'provider_native', null, ${ownership}, 'unknown', ${at}
        )`;
    }
  };

  try {
    const soloMonitor = randomUUID();
    const soloRun = randomUUID();
    const soloObservation = randomUUID();
    await sql`
      insert into capability_channel (id, vendor_id, kind, created_at)
      values (${input.channelId}, 'coverage-vendor', 'model_api', ${soloAt})`;
    await sql`
      insert into capability_version (
        channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name, product_entry, mode,
        model_version, availability, search_required, citation_capability, region_target, region_actual, limits_summary,
        sop_summary, verified_at, expires_at, public_visible, changed_at
      ) values (
        ${input.channelId}, 1, ${randomUUID()}, ${"c".repeat(64)}, ${input.ownerId}, 'verification', 'verified', 'API', 'entry', 'mode',
        'model', 'up', 0, 'complete', 'CN', 'CN', 'limits', 'sop', ${fixtureTime(-50)}, ${fixtureTime(-30)}, 1, ${soloAt}
      )`;
    await sql`
      insert into monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) values (
        ${soloRun}, ${input.brandId}, ${input.ownerId}, ${randomUUID()}, ${"e".repeat(64)}, 'model_api', ${randomUUID()}, 1,
        1, 1, 1, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 10, 10, 0, 'queued', 0, ${soloAt}
      )`;
    await sql`
      insert into monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
        reservation_id, status, created_at, adopted_attempt_id, late
      ) values (
        ${soloMonitor}, ${soloRun}, ${input.brandId}, ${randomUUID()}, 1, ${input.channelId}, 1, 1,
        null, 'failed', ${soloAt}, null, 0
      )`;
    await sql`
      insert into answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
        evidence_state, locator_ref, collector_id, missing_reason, created_at,
        target_region, observed_region, new_session, product_mode, network_trigger
      ) values (
        ${soloObservation}, ${input.brandId}, ${input.ownerId}, ${soloMonitor}, null, 'model_api', 'official_api',
        '无计划合格回答', ${answer}, ${sha(soloObservation)}, ${soloAt}, 'CN', 'zh-CN', 'off', 1, 'complete',
        'complete', null, null, null, ${soloAt}, 'CN', 'unknown', 'unknown', 'unknown', 'not_triggered'
      )`;
    await sql`
      insert into answer_analysis_version (
        id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
        official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
      ) values (
        ${randomUUID()}, ${soloObservation}, ${input.brandId}, 1, 1, 's-m0-06-v1', 'true', 'true',
        'false', null, 'classified', null, null, null, ${soloAt}
      )`;
    await sql`
      insert into sampling_plan (
        id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at
      ) values (
        ${planId}, 1, ${input.brandId}, ${input.ownerId}, 'active', 'CNY', 100, 0, 0, ${pendingAt}
      )`;
    const slots = [
      [randomUUID(), fixtureTime(-5, 1), "failed"],
      [randomUUID(), pendingAt, "completed"],
      [randomUUID(), ownedAt, "completed"],
      [randomUUID(), emptyAt, "completed"],
      [randomUUID(), fixtureTime(1, 1), "scheduled"],
    ] as const;
    for (const [id, at, status] of slots) {
      await sql`
        insert into sampling_slot (
          id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
        ) values (
          ${id}, ${planId}, ${input.brandId}, ${input.ownerId}, ${input.channelId}, ${at}, ${status}, 0, 1
        )`;
    }
    await run(slots[1][0], pendingAt, "待核对问题", "on", "unknown", ["unknown"]);
    await run(slots[2][0], ownedAt, "自有页问题", "off", "not_triggered", ["owned_account", "unknown"]);
    await run(slots[3][0], emptyAt, "空引用问题", "off", "not_triggered", []);
    await sql`
      insert into optimization_finding (
        id, brand_id, owner_id, gap_type, question_cluster, target_page,
        observation_id, analysis_version_id, evidence_summary, problem_statement,
        hypothesis, assumption_level, steps_json, completion_criteria, retest_method,
        business_importance, estimated_effort, verified_evidence, privacy_risk, created_at
      ) values (
        ${input.findingId}, ${input.brandId}, ${input.ownerId}, 'needs_evidence', 'coverage', 'https://owned.example.com/page',
        null, null, 'synthetic', 'synthetic', 'pending', 'pending', '[]', 'recorded', 'same scope',
        2, 2, 1, 0, ${soloAt}
      )`;
    await sql`
      insert into optimization_task (
        id, brand_id, owner_id, primary_finding_id, gap_type, question_cluster, target_page,
        title, status, priority_bucket, manual_rank, reorder_reason, completion_note,
        dismiss_reason, retest_conclusion, created_at, updated_at
      ) values (
        ${input.taskId}, ${input.brandId}, ${input.ownerId}, ${input.findingId}, 'needs_evidence', 'coverage', 'https://owned.example.com/page',
        '补一条可判断引用', 'todo', 'urgent', null, null, null, null, null, ${soloAt}, ${soloAt}
      )`;
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

test("overview shows coverage, owned citations, capture time, and localized task labels", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `coverage-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const channelId = randomUUID();
  let userId = "";
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "覆盖验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    await verifyEmail(userId);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("覆盖样本品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于隔离验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://coverage-brand.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "覆盖样本品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();
    await insertCoverageFixture({
      ownerId: userId,
      brandId: brandId!,
      channelId,
      findingId: randomUUID(),
      taskId: randomUUID(),
    });

    await page.goto(`/dashboard/monitoring/overview?brandId=${brandId}&sourceMode=model_api&from=${encodeURIComponent(soloFrom)}&to=${encodeURIComponent(fixtureTime(-6))}`);
    const overview = page.locator("#main-content");
    await expect(overview.getByRole("heading", { name: "可解释概览", exact: true })).toBeVisible();
    const soloCoverage = overview.getByRole("region", { name: "计划覆盖" });
    await expect(soloCoverage).toContainText("没有冻结计划槽位");
    await expect(soloCoverage).not.toContainText("100.0%");
    await expect(overview.getByText("最近有效采集", { exact: false })).toBeVisible();
    await expect(overview.getByText("能力记录已过期", { exact: true })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "提及率", exact: true })).toBeVisible();
    await expect(overview).toContainText("紧急 · 待处理");
    await expect(overview).not.toContainText("urgent");
    await expect(overview).not.toContainText("todo");

    await page.locator("#overview-from").fill(planFrom);
    await page.locator("#overview-to").fill(planTo);
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("from") === planFrom);
    const windowCoverage = overview.getByRole("region", { name: "计划覆盖" });
    await expect(windowCoverage).toContainText("2/4");
    await expect(windowCoverage).toContainText("50.0%");
    await expect(windowCoverage).not.toContainText("2/2");
    await expect(windowCoverage).toContainText("联网未知");
    const official = overview.locator("section").filter({ has: page.getByRole("heading", { name: "官网引用率", exact: true }) });
    const owned = overview.locator("section").filter({ has: page.getByRole("heading", { name: "自有页引用率", exact: true }) });
    await expect(official).toContainText("0.0%");
    await expect(owned).toContainText("50.0%");
    await expect(owned).toContainText("1/2");
    await expect(overview.getByText("能力记录已过期", { exact: true })).toBeVisible();
    await expect(overview.getByText("最近有效采集", { exact: false })).toBeVisible();

    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(overview.getByRole("region", { name: "Plan coverage" })).toContainText("2/4");
    await expect(overview.getByRole("region", { name: "Plan coverage" })).toContainText("50.0%");
    await expect(overview.getByText("Capability record expired", { exact: true })).toBeVisible();
    await expect(overview.getByText("Latest valid capture", { exact: false })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Owned-page citation rate", exact: true })).toBeVisible();
    await expect(overview).toContainText("Urgent · To do");
    await expect(overview).not.toContainText("urgent");
    await expect(overview).not.toContainText("todo");
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
    }
  } finally {
    if (userId) cleanupAccount(userId, email, channelId);
  }
});
