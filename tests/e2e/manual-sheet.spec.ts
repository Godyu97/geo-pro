import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const v2TextA = "门店如何安排设备巡检\n" + "question-reference-".repeat(12);
const v2TextB = "离线巡检的产品怎么比较";
const v1TextA = "v1 旧版门店巡检题目不该显示";
const v3TextA = "v3 修改后的门店巡检题目";
const v3TextC = "v3 新增的维保对比题目";
const foreignText = "另一品牌的巡检题目";

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

function question(id: string, clusterId: string, text: string) {
  return {
    id, clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false,
  };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

async function dueCounts(brandId: string) {
  const db = postgres(localDatabaseURL(), { max: 1 });
  try {
    const runs = await db<{ kind: string; count: number }[]>`
      select kind, count(*)::int as count from sampling_due_run where brand_id = ${brandId} group by kind order by kind
    `;
    const [attempts] = await db<{ count: number }[]>`
      select count(*)::int as count from monitoring_run where brand_id = ${brandId}
    `;
    return { runs, attempts: attempts?.count ?? 0 };
  } finally {
    await db.end();
  }
}

test("sampling plans show due manual work and budget pauses in both languages", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `sheet-${randomBytes(8).toString("hex")}@example.invalid`;
  const otherEmail = `sheet-other-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const outsider = await browser.newContext({ baseURL });
  let userId = "";
  let otherUserId = "";
  const clusterId = randomUUID();
  const setId = randomUUID();
  const setV1Id = randomUUID();
  const setV2Id = randomUUID();
  const setV3Id = randomUUID();
  const questionA = randomUUID();
  const questionB = randomUUID();
  const questionC = randomUUID();
  const foreignId = randomUUID();
  try {
    const policyVersion = publishedRetentionVersion();
    const [registered, otherRegistered] = await Promise.all([
      registerTestAccount(context, { name: "题单验收", email, password }),
      registerTestAccount(outsider, { name: "对照品牌账号", email: otherEmail, password }),
    ]);
    expect(registered.status()).toBe(200);
    expect(otherRegistered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    otherUserId = (await otherRegistered.json()).user.id as string;
    const otherBrandId = randomUUID();
    const sql = postgres(localDatabaseURL(), { max: 1 });
    try {
      await sql`update "user" set email_verified = true where id in (${userId}, ${otherUserId})`;
      await sql`insert into brand (id, owner_id, status, revision, entity_version, created_at) values (${otherBrandId}, ${otherUserId}, 'active', 1, 1, '2026-11-01T00:00:00.000Z')`;
      await sql`insert into brand_version (brand_id, version, name, content, created_at) values (${otherBrandId}, 1, '远帆对照品牌', ${JSON.stringify({
        description: "合成对照品牌",
        website: "https://foreign-sheet.example.com",
        aliases: [],
        region: "CN",
        language: "zh-CN",
        competitors: [],
        questions: [],
      })}, '2026-11-01T00:00:00.000Z')`;
      await sql`
        insert into prompt_set (
          brand_id, id, set_id, version, entity_version, region, language, content, created_at
        ) values (
          ${otherBrandId}, ${randomUUID()}, ${randomUUID()}, 1, 1, 'CN', 'zh-CN',
          ${JSON.stringify({
            clusters: [{ id: clusterId, audience: "门店负责人", intent: "安排巡检", primaryPage: "", conversionAction: "" }],
            questions: [question(foreignId, clusterId, foreignText)],
          })},
          '2026-11-01T00:00:00.000Z'
        )
      `;
    } finally {
      await sql.end();
    }
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("题单验收品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于人工题单验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://manual-sheet.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "题单验收品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();

    let entityVersion = 1;
    const db = postgres(localDatabaseURL(), { max: 1 });
    try {
      const [brand] = await db<{ entity_version: number }[]>`
        select entity_version from brand where id = ${brandId!} and owner_id = ${userId}
      `;
      expect(brand?.entity_version).toBeGreaterThan(0);
      entityVersion = brand!.entity_version;
      const v1 = {
        clusters: [{ id: clusterId, audience: "门店负责人", intent: "安排巡检", primaryPage: "", conversionAction: "" }],
        questions: [question(questionA, clusterId, v1TextA)],
      };
      const v2 = {
        clusters: v1.clusters,
        questions: [question(questionA, clusterId, v2TextA), question(questionB, clusterId, v2TextB)],
      };
      await db`
        insert into prompt_set (
          brand_id, id, set_id, version, entity_version, region, language, content, created_at
        ) values
          (${brandId!}, ${setV1Id}, ${setId}, 1, ${entityVersion}, 'CN', 'zh-CN', ${JSON.stringify(v1)}, '2026-11-01T00:00:00.000Z'),
          (${brandId!}, ${setV2Id}, ${setId}, 2, ${entityVersion}, 'CN', 'zh-CN', ${JSON.stringify(v2)}, '2026-11-10T00:00:00.000Z')
      `;
    } finally {
      await db.end();
    }

    await page.goto("/dashboard/monitoring/plans");
    await expect(page.getByText("还没有采样计划。", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "新建采样计划", exact: true }).press("Enter");
    await expect(page).toHaveURL(/#new-sampling-plan$/);
    await page.getByLabel("币种", { exact: true }).fill("CNY");
    await page.getByLabel("预算（最小货币单位）", { exact: true }).fill("5");
    await page.getByLabel("已花费", { exact: true }).fill("0");
    await page.getByLabel("待对账", { exact: true }).fill("0");
    await page.getByLabel("趋势阈值（百分点）", { exact: true }).fill("15");
    await page.locator('input[name="nextAt"]').fill("2099-12-02T00:00:00.000Z");
    const manual = page.getByRole("group", { name: "槽位 1", exact: true });
    await manual.getByRole("textbox", { name: "通道", exact: true }).fill("consumer-sheet");
    await manual.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2026-11-20T02:00:00.000Z");
    await manual.getByRole("textbox", { name: "槽位费用", exact: true }).fill("0");
    const official = page.getByRole("group", { name: "槽位 2", exact: true });
    await official.getByRole("textbox", { name: "通道", exact: true }).fill("official-api");
    await official.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2026-11-20T02:00:00.000Z");
    await official.getByRole("combobox", { name: "人工", exact: true }).selectOption("0");
    await official.getByRole("textbox", { name: "槽位费用", exact: true }).fill("10");
    const failed = page.getByRole("group", { name: "槽位 3", exact: true });
    await failed.getByRole("textbox", { name: "通道", exact: true }).fill("failed-official");
    await failed.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2026-11-20T02:00:00.000Z");
    await failed.getByRole("combobox", { name: "状态", exact: true }).selectOption("failed");
    await failed.getByRole("combobox", { name: "人工", exact: true }).selectOption("0");
    await failed.getByRole("textbox", { name: "槽位费用", exact: true }).fill("2");
    const futureChannel = "future-official-" + "a".repeat(48);
    const future = page.getByRole("group", { name: "槽位 4", exact: true });
    await future.getByRole("textbox", { name: "通道", exact: true }).fill(futureChannel);
    await future.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2099-12-01T00:00:00.000Z");
    await future.getByRole("combobox", { name: "人工", exact: true }).selectOption("0");
    await future.getByRole("textbox", { name: "槽位费用", exact: true }).fill("10");
    await page.getByRole("button", { name: "保存计划", exact: true }).click();
    await expect(page.getByRole("heading", { name: "当前版本 1", exact: true })).toBeVisible();
    await expect(page.getByText("当前版本的趋势阈值是 15 个百分点。", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/monitoring/plans");
    await expect(page.getByRole("heading", { name: "当前版本 1", exact: true })).toBeInViewport();
    await expect(page.getByRole("row").filter({ hasText: futureChannel })).toContainText("待执行");

    const main = page.getByRole("main");
    const processWindow = main.getByRole("button", { name: "处理到期窗口", exact: true });
    await main.getByRole("textbox", { name: "时区", exact: true }).fill("Invalid/Timezone");
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/dashboard/monitoring/plans")),
      processWindow.press("Enter"),
    ]);
    await expect(main.getByRole("alert").filter({ hasText: "请核对币种、金额、趋势阈值、时段和槽位后再保存。" })).toBeVisible();

    // Reject a request mixing in another brand's question ID.
    await main.getByRole("textbox", { name: "时区", exact: true }).fill("Asia/Shanghai");
    await main.getByRole("textbox", { name: "人工题单的问题编号", exact: true }).fill(`${questionA} ${foreignId}`);
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/dashboard/monitoring/plans")),
      processWindow.press("Enter"),
    ]);
    await expect(main.getByRole("alert").filter({ hasText: "请核对币种、金额、趋势阈值、时段和槽位后再保存。" })).toBeVisible();
    await expect(main.getByText(foreignText, { exact: true })).toHaveCount(0);
    expect((await dueCounts(brandId!)).runs).toEqual([]);

    // Generate manual sheet on v2 preserving [questionB, questionA] order.
    await main.getByRole("textbox", { name: "人工题单的问题编号", exact: true }).fill(`${questionB} ${questionA}`);
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/dashboard/monitoring/plans")),
      processWindow.press("Enter"),
    ]);
    await expect(main.getByText(`冻结题集版本 2（${setV2Id}）`, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(main.getByText(v2TextB, { exact: true })).toBeVisible();
    await expect(main.getByText(v2TextA, { exact: true })).toBeVisible();
    await expect(main.getByText("人工，非自动采集", { exact: true })).toHaveCount(2);
    await expect(main.getByText(/人工题单 .+ 已生成，不会记成自动采集。/)).toBeVisible();
    await expect(main.getByText(v1TextA, { exact: true })).toHaveCount(0);
    await expectNoOverflow(page);
    const first = await dueCounts(brandId!);
    expect(first.runs).toEqual([{ kind: "manual", count: 1 }]);
    expect(first.attempts).toBe(0);
    const listed = await page.request.get(`/api/monitoring/plans?brandId=${brandId}`, { headers: { Origin: baseURL } });
    expect(listed.ok()).toBe(true);
    const { plans: [plan] } = await listed.json();
    expect(plan).toMatchObject({ currency: "CNY", budgetMinor: 5, spentMinor: 0, pendingMinor: 0, trendThresholdPp: 15 });
    expect(plan.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ channelId: futureChannel, status: "paused", manual: false }),
      expect.objectContaining({ channelId: "failed-official", status: "failed" }),
    ]));
    expect(plan.coverageSlotIds).toEqual([plan.slots.find((slot: { channelId: string }) => slot.channelId === "failed-official").id]);

    // Freeze v3 modifying questionA and removing questionB, adding questionC.
    const v3Db = postgres(localDatabaseURL(), { max: 1 });
    try {
      const v3 = {
        clusters: [{ id: clusterId, audience: "门店负责人", intent: "安排巡检", primaryPage: "", conversionAction: "" }],
        questions: [question(questionA, clusterId, v3TextA), question(questionC, clusterId, v3TextC)],
      };
      await v3Db`
        insert into prompt_set (
          brand_id, id, set_id, version, entity_version, region, language, content, created_at
        ) values (
          ${brandId!}, ${setV3Id}, ${setId}, 3, ${entityVersion}, 'CN', 'zh-CN', ${JSON.stringify(v3)}, '2026-11-24T02:00:00.000Z'
        )
      `;
    } finally {
      await v3Db.end();
    }

    await page.reload();
    await expect(main.getByText(`冻结题集版本 2（${setV2Id}）`, { exact: true })).toBeVisible();
    await expect(main.getByText(v2TextB, { exact: true })).toBeVisible();
    await expect(main.getByText(v2TextA, { exact: true })).toBeVisible();
    await expect(main.getByText(v3TextA, { exact: true })).toHaveCount(0);

    // Re-running the old slot adds no sheet or monitoring run.
    await main.getByRole("textbox", { name: "人工题单的问题编号", exact: true }).fill(questionC);
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/dashboard/monitoring/plans")),
      main.getByRole("button", { name: "处理到期窗口", exact: true }).click(),
    ]);
    await expect(main.getByText(v2TextA, { exact: true })).toBeVisible();
    await expect(main.getByText(v3TextA, { exact: true })).toHaveCount(0);
    const second = await dueCounts(brandId!);
    expect(second.runs).toEqual([{ kind: "manual", count: 1 }]);
    expect(second.attempts).toBe(0);

    // Create a second plan for v3 and a third plan with a legacy unverified sheet.
    const v3SlotId = randomUUID();
    const legacySlotId = randomUUID();
    const createV3Plan = await page.request.post("/api/monitoring/plans", {
      headers: { Origin: baseURL },
      data: {
        action: "create", brandId, phase: "active", currency: "CNY",
        budgetMinor: 5, spentMinor: 0, pendingMinor: 0, nextAt: "2099-12-02T00:00:00.000Z",
        slots: [{ id: v3SlotId, channelId: "consumer-sheet-v3", at: "2026-11-20T03:00:00.000Z", status: "scheduled", manual: true, costMinor: 0 }],
      },
    });
    expect(createV3Plan.ok()).toBe(true);
    const { plan: v3Plan } = await createV3Plan.json();
    const createLegacyPlan = await page.request.post("/api/monitoring/plans", {
      headers: { Origin: baseURL },
      data: {
        action: "create", brandId, phase: "paused", currency: "CNY",
        budgetMinor: 5, spentMinor: 0, pendingMinor: 0, nextAt: "2099-12-02T00:00:00.000Z",
        slots: [{ id: legacySlotId, channelId: "consumer-sheet-legacy", at: "2026-11-19T03:00:00.000Z", status: "scheduled", manual: true, costMinor: 0 }],
      },
    });
    expect(createLegacyPlan.ok()).toBe(true);
    const { plan: legacyPlan } = await createLegacyPlan.json();

    const legacyDb = postgres(localDatabaseURL(), { max: 1 });
    try {
      await legacyDb`
        insert into sampling_due_run (
          id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
          kind, status, monitoring_run_id, charged_minor, prompt_set_id, prompt_set_version, prompt_ids_json, created_at
        ) values (
          ${randomUUID()}, ${legacyPlan.id}, 1, ${brandId!}, ${userId}, 'consumer-sheet-legacy', '2026-11-19', ${legacySlotId},
          'Asia/Shanghai', 'manual', 'sheet', null, 0, null, null, ${JSON.stringify([questionA, questionB])}, '2026-11-19T04:00:00.000Z'
        )
      `;
    } finally {
      await legacyDb.end();
    }

    await page.reload();
    const v3Section = main.locator(`section[aria-labelledby="plan-${v3Plan.id}"]`);
    await v3Section.getByRole("textbox", { name: "人工题单的问题编号", exact: true }).fill(`${questionC} ${questionA}`);
    await v3Section.getByRole("button", { name: "处理到期窗口", exact: true }).click();
    await expect(main.getByText(`冻结题集版本 3（${setV3Id}）`, { exact: true })).toBeVisible();
    await expect(main.getByText(v3TextC, { exact: true })).toBeVisible();
    await expect(main.getByText(v3TextA, { exact: true })).toBeVisible();
    const v2SectionText = await main.locator(`section[aria-labelledby="plan-${plan.id}"]`).innerText();
    expect(v2SectionText.indexOf(v2TextB)).toBeLessThan(v2SectionText.indexOf(v2TextA));
    const v3SectionText = await v3Section.innerText();
    expect(v3SectionText.indexOf(v3TextC)).toBeLessThan(v3SectionText.indexOf(v3TextA));

    for (const [locale, title, schedule, paused, v2Version, v3Version, unverifiedHeader, unverifiedLine, manualLabel] of [
      [
        "zh-CN",
        "采样计划",
        "槽位安排",
        "已暂停",
        `冻结题集版本 2（${setV2Id}）`,
        `冻结题集版本 3（${setV3Id}）`,
        "缺少可验证的冻结题集版本，无法核对版本或题目正文。",
        "版本或正文无法核对",
        "人工，非自动采集",
      ],
      [
        "en",
        "Sampling plans",
        "Slot schedule",
        "Paused",
        `Frozen question set version 2 (${setV2Id})`,
        `Frozen question set version 3 (${setV3Id})`,
        "No verifiable frozen question set version; version or question text cannot be verified.",
        "Version or text cannot be verified",
        "Manual, not automatic collection",
      ],
    ]) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.reload();
      const slots = main.getByRole("region", { name: schedule, exact: true }).first();
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(main.getByText(locale === "en"
          ? "This version's trend threshold is 15 percentage points."
          : "当前版本的趋势阈值是 15 个百分点。", { exact: true })).toBeVisible();
        await expect(main.getByText(v2Version, { exact: true })).toBeVisible();
        await expect(main.getByText(v3Version, { exact: true })).toBeVisible();
        await expect(main.getByText(unverifiedHeader, { exact: true })).toBeVisible();
        await expect(main.getByText(unverifiedLine, { exact: true })).toHaveCount(2);
        await expect(main.getByText(v2TextA, { exact: true })).toHaveCSS("white-space", "pre-wrap");
        await expect(main.getByText(v2TextB, { exact: true })).toBeVisible();
        await expect(main.getByText(v3TextC, { exact: true })).toBeVisible();
        await expect(main.getByText(v3TextA, { exact: true })).toBeVisible();
        await expect(main.getByText(manualLabel, { exact: true })).toHaveCount(6);
        await expect(main.getByText(v1TextA, { exact: true })).toHaveCount(0);
        await expect(main.getByText(foreignText, { exact: true })).toHaveCount(0);
        await expect(slots.getByRole("row").filter({ hasText: futureChannel })).toContainText(paused);
        const channelCell = slots.getByRole("cell", { name: futureChannel, exact: true });
        expect(await channelCell.evaluate((cell) => cell.getBoundingClientRect().height)).toBeLessThan(140);
        await expectNoOverflow(page);
      }
      await slots.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(slots).toBeFocused();
      expect(await slots.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => slots.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath(`sampling-plans-${locale}-375.png`) });
      await main.getByText(v2TextA, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`sampling-plan-sheet-${locale}-375.png`) });
    }
  } finally {
    await outsider.close();
    if (userId) cleanupAccount(userId, email);
    if (otherUserId) cleanupAccount(otherUserId, otherEmail);
  }
});
