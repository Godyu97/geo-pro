import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const brandName = "合成观察品牌";
const frozenSetId = `core${"a".repeat(60)}`;
const effectiveOn = "2026-11-01";
const earlyDay = "2026-11-10";
const dueDay = "2026-11-20";
const excluded = ["q24", "q25", "q26", "q27", "q28", "q29", "q30"];

const copy = {
  "zh-CN": {
    title: "观察计划",
    emptyTask: "还没有观察记录。冻结题集不会被改写，也不会创建采样运行。下一步是保存观察。",
    pendingTask: "这份观察还没有检查点。对照页可以在第一个检查点之前登记，标签只能是观察。下一步是记录检查点。未到期只记进度，完整结论留空。",
    progressTask: "最近一次检查点尚未到期。完整观察结论为空。这不是正式对比。下一步仍是记录检查点。",
    exploratoryTask: "窗口已到期，但已保存槽位的覆盖或指标门槛未全部达标。这是探索记录，不足指标与排除原因已保留。下一步是查看排除题。",
    save: "保存观察",
    requestFormal: "请求正式结论",
    viewExcluded: "查看排除题",
    related: "相关入口",
    observing: "观察中",
    baselineClear: "该窗口内没有已核验生效的干预批次或发布。",
    baselineWindow: "基线窗口 2026-10-18（含）至 2026-11-01（不含），时区 Asia/Shanghai。生效日当天不计入基线。",
    recorded: "检查点已记录",
    progress: "进度",
    exploratory: "探索",
    emptyConclusion: "完整观察结论为空。",
    exploratoryConclusion: "窗口已到期，已保存槽位的覆盖或指标门槛未全部达标。这是探索记录。",
    unavailable: "暂时无法读取或保存观察记录，请稍后重试。",
    reload: "重新载入",
    taskStopped: "这份观察已提前停止。已写入的检查点和槽位编号仍可查看。下一步是查看停止原因。",
    stopTitle: "提前停止观察",
    saveStop: "停止观察",
    stopped: "已停止",
    invalid: "观察记录无效。请检查日期、题数、排除题、因素、说明、对照页标识和停止原因。",
    unwritten: "这个检查点尚未写入。",
    unwrittenNote: "这里只保留已停止状态和停止原因。",
    retained: "已保留槽位",
  },
  en: {
    title: "Observation plan",
    emptyTask: "No observation has been saved. The frozen question set is not rewritten, and no sampling run is created. Save an observation next.",
    pendingTask: "This observation has no checkpoint yet. A control page can be registered before the first checkpoint, and its label stays observation. Record a checkpoint next. Before the window is due, only progress is stored and the full conclusion stays empty.",
    progressTask: "The latest checkpoint is not due yet. The full observation conclusion is empty. This is not a full comparison. Record a checkpoint next.",
    exploratoryTask: "The window is due, but saved slots did not pass every coverage or metric threshold. This is an exploratory record with insufficient metrics and exclusion reasons kept. Review the excluded questions next.",
    save: "Save observation",
    requestFormal: "Request a formal conclusion",
    viewExcluded: "Review excluded questions",
    related: "Related entries",
    observing: "Observing",
    baselineClear: "This window has no verified intervention batch or publication.",
    baselineWindow: "Baseline window 2026-10-18 inclusive to 2026-11-01 exclusive, time zone Asia/Shanghai. The effective day stays outside the baseline.",
    recorded: "Checkpoint recorded",
    progress: "Progress",
    exploratory: "Exploratory",
    emptyConclusion: "The full observation conclusion is empty.",
    exploratoryConclusion: "The window is due, but saved slots did not pass every coverage or metric threshold. This is an exploratory record.",
    unavailable: "Observations cannot be read or saved right now. Try again later.",
    reload: "Reload",
    missing: "Page not found",
    taskStopped: "This observation was stopped early. Written checkpoints and slot IDs remain available. Review the stop reason next.",
    stopTitle: "Stop the observation early",
    saveStop: "Stop observation",
    stopped: "Stopped",
    invalid: "The observation record is invalid. Check the dates, counts, excluded questions, factor, note, control page identifier, and stop reason.",
    unwritten: "This checkpoint has not been written.",
    unwrittenNote: "Only the stopped status and the stop reason are kept here.",
    retained: "Retained slots",
  },
} as const;

const stopReason = "客户要求在 D+28 前提前停止。";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Observation plan visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function post(context: BrowserContext, url: string, data: unknown) {
  const response = await context.request.post(url, { headers: { Origin: origin }, data });
  expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
  return response.json();
}

async function readObservations(context: BrowserContext, brandId: string) {
  const response = await context.request.get(`/api/reports/observations?brandId=${brandId}`, {
    headers: { Origin: origin },
  });
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return JSON.parse(body) as {
    observations: Array<{
      frozenSetId: string;
      effectiveOn: string;
      frozenNonBrandCount: number;
      status: string;
      checkpoints: Array<{
        mode: string;
        conclusion: string | null;
        evaluatedOn: string;
        comparableCount: number;
        excluded: string[];
      }>;
    }>;
  };
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

test("observation plans keep the next checkpoint readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const shots = ".cache/issue-135/observation-plan";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `observation-plan-${randomUUID()}@example.invalid`;
  const outsiderEmail = `observation-plan-other-${randomUUID()}@example.invalid`;
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
        name: brandName, description: "仅用于观察计划隔离验收的合成品牌。",
        website: "https://observation-plan.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const brandId = savedBrand.id as string;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(frozenSetId).toHaveLength(64);
    const href = `/dashboard/reports/observations?brandId=${brandId}`;

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
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
        await expect(main.getByText(current.emptyTask, { exact: true })).toBeVisible();
        const save = main.getByRole("button", { name: current.save, exact: true });
        await expect(save).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.requestFormal, exact: true })).toHaveCount(0);
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        await expect(main.getByText(frozenSetId)).toHaveCount(0);
        if (width === 375) {
          await expect(save).toBeInViewport();
          await page.screenshot({ path: `${shots}/observation-plan-empty-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.locator("input[name='frozenSetId']").fill(frozenSetId);
    await page.locator("input[name='effectiveOn']").fill(effectiveOn);
    await page.locator("input[name='frozenNonBrandCount']").fill("30");
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].save, exact: true }));
    await expect(page.getByText(copy["zh-CN"].pendingTask, { exact: true })).toBeVisible();
    const listed = await readObservations(context, brandId);
    expect(listed.observations).toHaveLength(1);
    expect(listed.observations[0].frozenSetId).toBe(frozenSetId);
    expect(listed.observations[0].effectiveOn).toBe(effectiveOn);
    expect(listed.observations[0].frozenNonBrandCount).toBe(30);
    expect(listed.observations[0].checkpoints).toHaveLength(0);
    const runs = postgres(localDatabaseURL(), { max: 1 });
    try {
      const rows = await runs<{ count: string }[]>`
        select count(*)::text as count from monitoring_run where owner_id = ${accounts[0]!.userId}`;
      expect(rows[0]?.count).toBe("0");
    } finally {
      await runs.end();
    }

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(current.pendingTask, { exact: true })).toBeVisible();
        const request = main.getByRole("button", { name: current.requestFormal, exact: true });
        await expect(request).toHaveCount(1);
        await expect(main.getByText(frozenSetId, { exact: true })).toBeVisible();
        await expect(main.getByText(current.observing, { exact: true })).toBeVisible();
        await expect(main.getByText(locale === "zh-CN" ? `生效日 ${effectiveOn}` : `Effective date ${effectiveOn}`)).toBeVisible();
        await expect(main.getByText(current.baselineWindow, { exact: true })).toBeVisible();
        await expect(main.getByText(current.baselineClear, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(request).toBeInViewport();
          const edge = await main.getByText(frozenSetId, { exact: true }).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right <= window.innerWidth && rect.left >= 0;
          });
          expect(edge).toBe(true);
          await page.screenshot({ path: `${shots}/observation-plan-pending-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.locator("input[name='today']").fill(earlyDay);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].requestFormal, exact: true }));
    await expect(page.getByText(copy["zh-CN"].progressTask, { exact: true })).toBeVisible();
    const progress = await readObservations(context, brandId);
    expect(progress.observations[0].checkpoints).toHaveLength(1);
    expect(progress.observations[0].checkpoints[0].mode).toBe("progress");
    expect(progress.observations[0].checkpoints[0].conclusion).toBeNull();
    expect(progress.observations[0].checkpoints[0].evaluatedOn).toBe(earlyDay);
    expect(progress.observations[0].status).toBe("observing");

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main.getByText(current.progressTask, { exact: true })).toBeVisible();
        const request = main.getByRole("button", { name: current.requestFormal, exact: true });
        await expect(request).toHaveCount(1);
        await expect(main.getByText(current.progress, { exact: true })).toBeVisible();
        await expect(main.getByText(current.emptyConclusion, { exact: true })).toBeVisible();
        await expect(main.getByText(current.exploratory, { exact: true })).toHaveCount(0);
        if (width === 375) {
          await expect(request).toBeInViewport();
          await page.screenshot({ path: `${shots}/observation-plan-progress-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    const seededSlotIds: string[] = [];
    const seedDb = postgres(localDatabaseURL(), { max: 1 });
    try {
      const channelId = randomUUID();
      for (const [winIndex, at] of ["2026-10-20T12:00:00.000Z", "2026-11-05T12:00:00.000Z"].entries()) {
        const runId = randomUUID();
        await seedDb`
          insert into monitoring_run (
            id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
            repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
            requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
            status, sampling_complete, created_at
          ) values (
            ${runId}, ${brandId}, ${accounts[0]!.userId}, ${randomUUID()}, ${String(winIndex).repeat(64)},
            'model_api', ${frozenSetId}, 1, 1, 30, 30, 1, 30, 'CN', 'zh-CN', 'off', 'CNY', 0, 0, 0,
            'succeeded', 1, ${at}
          )`;
        for (let i = 1; i <= 30; i += 1) {
          const slotId = randomUUID();
          seededSlotIds.push(slotId);
          const qId = `q${String(i).padStart(2, "0")}`;
          await seedDb`
            insert into monitoring_slot (
              id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
              repeat_index, reservation_id, status, adopted_attempt_id, late, created_at
            ) values (
              ${slotId}, ${runId}, ${brandId}, ${qId}, 1, ${channelId}, 1,
              1, null, 'succeeded', ${slotId}, 0, ${at}
            )`;
          const obsId = randomUUID();
          const partialCitation = winIndex === 1 && i > 24;
          const unknownCitation = winIndex === 1 && i > 21 && i <= 24;
          const unknownRec = winIndex === 1 && i >= 24;
          await seedDb`
            insert into answer_observation (
              id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method,
              question_text, answer_text, fingerprint, captured_at, region, language,
              requested_network_mode, entity_version, citation_set_state, evidence_state,
              locator_ref, collector_id, missing_reason, created_at, target_region,
              observed_region, new_session, product_mode, network_trigger
            ) values (
              ${obsId}, ${brandId}, ${accounts[0]!.userId}, ${slotId}, null, 'model_api', 'isolated',
              ${`Question ${qId}?`}, 'Synthetic answer', ${"b".repeat(64)}, ${at}, 'CN', 'zh-CN',
              'off', 1, ${partialCitation ? "partial" : "complete"}, 'complete',
              null, null, null, ${at}, 'CN', 'unknown', 'unknown', 'unknown', 'not_triggered'
            )`;
          await seedDb`
            insert into answer_analysis_version (
              id, observation_id, brand_id, version, entity_version, rule_version,
              mentioned, recommended, official_site_cited, evidence_span, status,
              revised_from, reason, reviewer_id, created_at
            ) values (
              ${randomUUID()}, ${obsId}, ${brandId}, 1, 1, 'rule-v1',
              'true', ${unknownRec ? "unknown" : "false"},
              ${partialCitation || unknownCitation ? "unknown" : "true"},
              null, 'classified', null, null, null, ${at}
            )`;
        }
      }
    } finally {
      await seedDb.end();
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.locator("input[name='today']").fill(dueDay);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].requestFormal, exact: true }));
    await expect(page.getByText(copy["zh-CN"].exploratoryTask, { exact: true })).toBeVisible();
    const exploratory = await readObservations(context, brandId);
    expect(exploratory.observations[0]?.checkpoints).toHaveLength(2);
    const due = exploratory.observations[0]?.checkpoints.find((item) => item.evaluatedOn === dueDay);
    if (!due) throw new Error("missing due checkpoint");
    expect(due.mode).toBe("exploratory");
    expect(due.comparableCount).toBe(21);
    expect(due.excluded).toEqual(["q22", "q23", "q24", "q25", "q26", "q27", "q28", "q29", "q30"]);
    expect(due.conclusion).toContain("exploratory");
    expect(exploratory.observations[0].status).toBe("checkpoint_due");

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(current.exploratoryTask, { exact: true })).toBeVisible();
        const review = main.getByRole("link", { name: current.viewExcluded, exact: true });
        await expect(review).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.requestFormal, exact: true })).toHaveCount(1);
        await expect(main.getByText(current.recorded, { exact: true })).toBeVisible();
        await expect(main.getByText(current.exploratory, { exact: true })).toBeVisible();
        await expect(main.getByText(current.exploratoryConclusion, { exact: true })).toBeVisible();
        await expect(main.getByText(current.progress, { exact: true })).toBeVisible();
        const dueCard = main.locator("article").filter({ hasText: dueDay });
        await expect(dueCard).not.toContainText(/\bformal\b/i);
        await expect(dueCard).toContainText("C/E");
        await expect(dueCard).toContainText("Jc/C");
        await expect(dueCard).toContainText(seededSlotIds[0]!);
        for (const id of excluded) await expect(dueCard).toContainText(id);
        if (width === 375) {
          await expect(review).toBeInViewport();
          await page.screenshot({ path: `${shots}/observation-plan-exploratory-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-observations-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(frozenSetId)).toHaveCount(0);
    await expect(failed.getByText(brandName)).toHaveCount(0);
    await expect(failed.getByText("exploratory")).toHaveCount(0);
    await expect(failed).not.toContainText("Private observation fixture failure");
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/observation-plan-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-observations-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText(copy.en.exploratoryTask, { exact: true })).toBeVisible();
    await expect(page.getByText(frozenSetId, { exact: true })).toBeVisible();

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(href);
    const blankStop = page.locator("form").filter({ has: page.getByRole("heading", { name: copy["zh-CN"].stopTitle, exact: true }) });
    await blankStop.locator("textarea[name='reason']").fill("   ");
    await blankStop.getByRole("button", { name: copy["zh-CN"].saveStop, exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(copy["zh-CN"].invalid);
    await expect(page.getByText(copy["zh-CN"].exploratoryTask, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy["zh-CN"].saveStop, exact: true })).toBeVisible();
    const beforeStop = await readObservations(context, brandId);
    expect(beforeStop.observations[0]?.status).toBe("checkpoint_due");
    expect(beforeStop.observations[0]?.checkpoints).toHaveLength(2);

    const reasonStop = page.locator("form").filter({ has: page.getByRole("heading", { name: copy["zh-CN"].stopTitle, exact: true }) });
    await reasonStop.locator("textarea[name='reason']").fill(stopReason);
    await reasonStop.getByRole("button", { name: copy["zh-CN"].saveStop, exact: true }).click();
    await expect(page.getByText(copy["zh-CN"].taskStopped, { exact: true })).toBeVisible();

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      const reasonLine = locale === "zh-CN" ? `停止原因：${stopReason}` : `Stop reason: ${stopReason}`;
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main.getByText(current.taskStopped, { exact: true })).toBeVisible();
        await expect(main.getByText(current.stopped, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(reasonLine, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(current.retained, { exact: false }).first()).toBeVisible();
        await expect(main.getByText(seededSlotIds[0]!, { exact: true }).first()).toBeVisible();
        const dueCard = main.locator("article").filter({ hasText: dueDay });
        await expect(dueCard.getByText(current.exploratory, { exact: true })).toBeVisible();
        await expect(dueCard).toContainText(seededSlotIds[0]!);
        const unwritten = main.locator("article").filter({ has: page.getByText("D+28", { exact: true }) });
        await expect(unwritten).toContainText(current.unwritten);
        await expect(unwritten).toContainText(reasonLine);
        await expect(unwritten).toContainText(current.unwrittenNote);
        await expect(main.getByRole("button", { name: current.requestFormal, exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (locale === "zh-CN" && width === 375) {
          await page.screenshot({ path: `${shots}/observation-plan-stopped-zh-CN-375.png`, fullPage: false });
        }
      }
    }
    const stopped = await readObservations(context, brandId);
    expect(stopped.observations[0]?.status).toBe("stopped");
    expect(stopped.observations[0]?.checkpoints).toHaveLength(2);
    expect(stopped.observations[0]?.checkpoints.find((item) => item.evaluatedOn === dueDay)?.mode).toBe("exploratory");

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    const denied = await stranger.goto(href);
    expect(denied?.status()).toBe(404);
    await stranger.evaluate(() => window.scrollTo(0, 0));
    const hidden = stranger.getByRole("main");
    await expect(hidden.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(hidden.getByText(frozenSetId)).toHaveCount(0);
    await expect(hidden.getByText(brandName)).toHaveCount(0);
    await expect(hidden.getByRole("button", { name: copy.en.requestFormal, exact: true })).toHaveCount(0);
    await expect(hidden.getByText(stopReason)).toHaveCount(0);
    await expect(hidden.getByText(seededSlotIds[0]!)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/observation-plan-hidden-en-375.png`, fullPage: false });
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
        select count(*)::text as count from "user" where email like 'observation-plan-%@example.invalid'`;
      const versions = await sql<{ count: string }[]>`
        select count(*)::text as count from brand_version where name = ${brandName}`;
      const observations = await sql<{ count: string }[]>`
        select count(*)::text as count from formal_observation where owner_id in ${sql(accounts.map((item) => item.userId))}`;
      expect(users[0]?.count).toBe("0");
      expect(versions[0]?.count).toBe("0");
      expect(observations[0]?.count).toBe("0");
    } finally {
      await sql.end();
    }
  }
});
