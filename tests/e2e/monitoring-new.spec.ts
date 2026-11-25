import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const route = "/dashboard/monitoring/new";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成确认品牌-${"LongSegment_".repeat(4)}end`;
const apiChannelName = `合成确认API-${"ChannelSegment_".repeat(3)}end`;
const unverifiedChannelName = `合成待验通道-${"PendingSegment_".repeat(3)}end`;

const copy = {
  "zh-CN": {
    title: "运行确认",
    openBrand: "去建档",
    registerTitle: "登记监测运行",
    backMonitoring: "返回监测",
    viewBrand: "查看品牌",
    noBrand: "先完成一个活跃品牌的建档，再登记监测运行。",
    channelEligibilityTitle: "通道资格预检",
    confirmFormal: "确认正式运行",
    confirmDemo: "使用演示空间",
    channelUnverified: "存在未验证、过期、降级或已禁用的通道，不能新建正式运行。",
    demoNotFormal: "演示空间已记录选择，这不是正式运行。",
    preview: "预览范围",
    accept: "登记排队运行",
    noCeiling: "没有可信费用上界，不能登记官方 API 运行。",
    upperLabel: "上界（最小货币单位）",
    notFound: "找不到该品牌或运行，或当前账号无权访问。",
    loading: "正在读取监测能力…",
    unavailable: "暂时无法读取或更新监测能力，请稍后重试。",
    retry: "重新加载",
    openRun: (id: string) => `查看运行 ${id.slice(0, 8)}`,
  },
  en: {
    title: "Run confirmation",
    openBrand: "Create a brand",
    registerTitle: "Register a monitoring run",
    backMonitoring: "Back to monitoring",
    viewBrand: "View brand",
    noBrand: "Finish an active brand profile before registering a monitoring run.",
    channelEligibilityTitle: "Channel eligibility check",
    confirmFormal: "Confirm formal run",
    confirmDemo: "Use demo space",
    channelUnverified: "An unverified, expired, degraded or disabled channel cannot start a formal run.",
    demoNotFormal: "The demo selection was recorded. This is not a formal run.",
    preview: "Preview scope",
    accept: "Register queued run",
    noCeiling: "A trusted cost ceiling is required before registering an official API run.",
    upperLabel: "Ceiling (minor units)",
    notFound: "That brand or run was not found, or this account cannot access it.",
    loading: "Loading monitoring capabilities…",
    unavailable: "Monitoring capabilities are temporarily unavailable. Try again shortly.",
    retry: "Reload",
    openRun: (id: string) => `Open run ${id.slice(0, 8)}`,
  },
};

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function keyboardActivate(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.GEO_MONITORING_NEW_SCREENSHOTS;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function register(context: BrowserContext, sql: postgres.Sql) {
  const email = `monitoring-new-${randomUUID()}@example.invalid`;
  const signup = await registerTestAccount(context, {
    name: "Monitoring new visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(signup.status()).toBe(200);
  const { user: { id } } = await signup.json();
  const userId = String(id);
  await sql`UPDATE "user" SET email_verified = true WHERE id = ${userId}`;
  return { userId, email };
}

test("monitoring/new aligns to ui-visual-v1 with bilingual viewports, keyboard flow, isolation, and read recovery", async ({
  context,
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const sql = openTestDatabase();
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const users: string[] = [];
  const channels: string[] = [];
  let brandId = "";
  let runId = "";
  const main = page.getByRole("main");
  const header = main.locator("header").first();

  async function checkAcrossViewports(
    path: string,
    primaryKey: "openBrand" | "registerTitle",
    shotPrefix: string,
    assertBody: (locale: (typeof locales)[number]) => Promise<void>,
  ) {
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator('[data-workspace-section="monitoring"]')).toBeVisible();
        await expect(main).toHaveCount(1);
        await expect(header.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
        const primary = header.getByRole("link", { name: labels[primaryKey], exact: true });
        await expect(primary).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await assertBody(locale);
        if (width === 375) await screenshot(page, `${shotPrefix}-${locale}-375`);
      }
    }
  }

  try {
    const owner = await register(context, sql);
    users.push(owner.userId);
    const peer = await register(outsider, sql);
    users.push(peer.userId);

    await checkAcrossViewports(route, "openBrand", "nobrand", async (locale) => {
      await expect(main.getByText(copy[locale].noBrand, { exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: copy[locale].channelEligibilityTitle, exact: true })).toBeVisible();
    });

    const saved = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: owner.userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "用于运行确认页面视觉与流程验收的合成品牌。",
          website: "https://monitoring-new-fixture.example.com",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(saved.status()).toBe(200);
    brandId = String((await saved.json()).id);

    const now = new Date().toISOString();
    const expiresAt = "2027-12-31T00:00:00.000Z";
    const apiChannelId = randomUUID();
    const unverifiedChannelId = randomUUID();
    channels.push(apiChannelId, unverifiedChannelId);

    for (const item of [
      { id: apiChannelId, name: apiChannelName, status: "verified", verifiedAt: now, expiresAt },
      { id: unverifiedChannelId, name: unverifiedChannelName, status: "candidate", verifiedAt: null, expiresAt: null },
    ]) {
      await sql`
        INSERT INTO capability_channel (id, vendor_id, kind, created_at)
        VALUES (${item.id}, 'fixture-vendor', 'model_api', ${now})
      `;
      await sql`
        INSERT INTO capability_version (
          channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name,
          product_entry, mode, model_version, availability, search_required, citation_capability,
          region_target, region_actual, limits_summary, sop_summary, verified_at, expires_at,
          public_visible, changed_at
        ) VALUES (
          ${item.id}, 1, ${randomUUID()}, ${`fp-cap-${randomUUID()}`}, ${owner.userId}, 'initial-record',
          ${item.status}, ${item.name}, 'responses', 'official-api', 'synthetic-v1',
          'synthetic fixture', 0, 'complete', 'CN', 'CN', 'No live traffic', 'Synthetic SOP',
          ${item.verifiedAt}, ${item.expiresAt}, 0, ${now}
        )
      `;
    }

    const promptSetId = randomUUID();
    const setId = randomUUID();
    const clusterId = randomUUID();
    const promptContent = JSON.stringify({
      clusters: [
        { id: clusterId, audience: "Store operations", intent: "Inspection", primaryPage: "", conversionAction: "" },
      ],
      questions: [
        {
          id: randomUUID(), clusterId, text: "连锁门店巡检软件怎么选？", source: "manual", sourceNote: "",
          type: "discovery", stage: "awareness", region: "CN", language: "zh-CN", status: "confirmed",
          acceptSimilar: false, primary: true,
        },
        {
          id: randomUUID(), clusterId, text: "支持离线记录的巡检工具有哪些？", source: "manual", sourceNote: "",
          type: "scenario", stage: "consider", region: "CN", language: "zh-CN", status: "confirmed",
          acceptSimilar: false, primary: true,
        },
        {
          id: randomUUID(), clusterId, text: "预算受限团队如何评估门店巡检方案？", source: "manual", sourceNote: "",
          type: "constraint", stage: "compare", region: "CN", language: "zh-CN", status: "confirmed",
          acceptSimilar: false, primary: true,
        },
      ],
    });
    await sql`
      INSERT INTO prompt_set (
        brand_id, id, set_id, version, entity_version, region, language, content, created_at
      ) VALUES (
        ${brandId}, ${promptSetId}, ${setId}, 1, 1, 'CN', 'zh-CN', ${promptContent}, ${now}
      )
    `;

    await sql`
      INSERT INTO quota_grant (
        brand_id, kind, version, operation_id, fingerprint, actor_id, reason, count_limit, budget_minor, currency, expires_at, changed_at, action
      ) VALUES (
        ${brandId}, 'sampling', 1, ${randomUUID()}, ${`fp-quota-${randomUUID()}`}, ${owner.userId}, 'pilot-approval',
        20, 2000, 'CNY', ${expiresAt}, ${now}, 'set'
      )
    `;

    const scopedPath = `${route}?brandId=${brandId}`;
    await checkAcrossViewports(scopedPath, "registerTitle", "ready", async (locale) => {
      await expect(main.getByText(brandName, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(apiChannelName, { exact: true }).first()).toBeVisible();
      await expect(header.getByRole("link", { name: copy[locale].backMonitoring, exact: true })).toBeVisible();
      await expect(header.getByRole("link", { name: copy[locale].viewBrand, exact: true })).toHaveAttribute(
        "href",
        `/dashboard/brands/${brandId}`,
      );
    });

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(scopedPath);

    await keyboardActivate(page, header.getByRole("link", { name: copy["zh-CN"].registerTitle, exact: true }));
    await expect(page).toHaveURL(`${origin}${scopedPath}#monitoring-registration`);

    const eligSection = main.locator("#channel-eligibility");
    await eligSection.getByRole("checkbox", { name: new RegExp(unverifiedChannelName) }).check();
    await keyboardActivate(page, eligSection.getByRole("button", { name: copy["zh-CN"].confirmFormal, exact: true }));
    await expect(eligSection.getByRole("status")).toContainText(copy["zh-CN"].channelUnverified);

    await keyboardActivate(page, eligSection.getByRole("button", { name: copy["zh-CN"].confirmDemo, exact: true }));
    await expect(eligSection.getByRole("status")).toContainText(copy["zh-CN"].demoNotFormal);

    const regSection = main.locator("#monitoring-registration");
    await regSection.getByRole("checkbox", { name: `${apiChannelName} 可用于正式登记`, exact: true }).check();
    await keyboardActivate(page, regSection.getByRole("button", { name: copy["zh-CN"].preview, exact: true }));
    await expect(regSection.getByRole("status")).toContainText(copy["zh-CN"].noCeiling);

    await regSection.getByLabel(copy["zh-CN"].upperLabel, { exact: true }).fill("10");
    await keyboardActivate(page, regSection.getByRole("button", { name: copy["zh-CN"].preview, exact: true }));
    await expect(regSection.getByText(`品牌 ${brandName}`, { exact: true })).toBeVisible();

    await keyboardActivate(page, regSection.getByRole("button", { name: copy["zh-CN"].accept, exact: true }));
    await expect(page).toHaveURL(/\/dashboard\/monitoring\/runs\/[0-9a-f-]{36}$/);
    runId = page.url().split("/").at(-1)!;

    await page.goto(scopedPath);
    const reopen = main.getByRole("link", { name: copy["zh-CN"].openRun(runId), exact: true });
    await expect(reopen).toBeVisible();
    await keyboardActivate(page, reopen);
    await expect(page).toHaveURL(`${origin}/dashboard/monitoring/runs/${runId}`);

    const outsiderPage = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(scopedPath);
    const outsiderMain = outsiderPage.getByRole("main");
    await expect(outsiderMain.getByText(copy.en.notFound, { exact: true })).toBeVisible();
    await expect(outsiderMain.getByText(brandName, { exact: true })).toHaveCount(0);
    await outsiderPage.close();

    for (const locale of locales) {
      const labels = copy[locale];
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-monitoring-new-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(scopedPath, { waitUntil: "commit" });
      await expect(main.getByRole("status", { name: labels.loading })).toBeVisible();
      await screenshot(page, `loading-${locale}-375`);

      const alert = main.getByRole("alert");
      await expect(alert).toContainText(labels.unavailable);
      await expect(main.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
      await expect(main.getByText("Private monitoring-new fixture failure")).toHaveCount(0);
      await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(main.getByText(apiChannelName, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

      const retry = main.getByRole("link", { name: labels.retry, exact: true });
      await expect(retry).toBeInViewport({ ratio: 1 });
      await expect(retry).toHaveAttribute("href", scopedPath);
      await screenshot(page, `unavailable-${locale}-375`);

      await context.clearCookies({ name: "geo-monitoring-new-read" });
      await keyboardActivate(page, retry);
      await expect(page).toHaveURL(`${origin}${scopedPath}`);
      await expect(main.getByText(brandName, { exact: true }).first()).toBeVisible();
    }
  } finally {
    try {
      await outsider.close();
      if (runId) {
        await sql`DELETE FROM monitoring_slot WHERE run_id = ${runId}`;
        await sql`DELETE FROM monitoring_run WHERE id = ${runId}`;
      }
      if (brandId) {
        await sql`DELETE FROM quota_attempt WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM quota_reservation WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM quota_grant WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM prompt_set WHERE brand_id = ${brandId}`;
        await sql`DELETE FROM brand WHERE id = ${brandId}`;
      }
      if (channels.length) {
        await sql`DELETE FROM sampling_answer_network WHERE channel_id IN ${sql(channels)}`;
        await sql`DELETE FROM capability_version WHERE channel_id IN ${sql(channels)}`;
        await sql`DELETE FROM capability_channel WHERE id IN ${sql(channels)}`;
      }
      if (users.length) {
        await sql`DELETE FROM "user" WHERE id IN ${sql(users)}`;
        expect(await sql`SELECT id FROM "user" WHERE id IN ${sql(users)}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
