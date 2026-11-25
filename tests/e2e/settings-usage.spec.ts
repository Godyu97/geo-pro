import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const route = "/dashboard/settings/usage";
const settingsRoute = "/dashboard/settings";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;

const copy = {
  "zh-CN": {
    title: "额度与费用明细",
    openUsage: "查看额度与费用明细",
    backSettings: "返回账户设置",
    adjustScope: "调整监测范围",
    customerPayable: "试点客户应付",
    pilotCharge: "受控试点期间，平台服务费和按量收费均为 0。",
    sampling: "采样次数",
    generation: "生成次数",
    ungranted: "尚未授予",
    limitReached: "次数上限已用尽",
    zeroQuota: "当前没有可用额度。下一步是等待试点额度授予。",
    overLimit: "次数或预算已到硬顶。下一步是调整题数或重复次数。",
    currencySummary: "按币种汇总",
    noUsage: "还没有额度变动。",
    emptyFilter: "没有符合当前筛选的记录。可以清除筛选后再看。",
    clearFilters: "清除筛选",
    filterKind: "类别",
    filterState: "状态",
    filterCurrency: "币种",
    reserved: "已预留次数",
    settled: "已结算次数",
    released: "已释放",
    unknownAmount: "未知",
    nextPage: "下一页",
    runLink: "打开运行",
    loading: "正在读取额度…",
    unavailable: "暂时无法读取或更新试点额度，请稍后重试。",
    retry: "重新加载额度",
  },
  en: {
    title: "Quota and cost details",
    openUsage: "View quota and cost details",
    backSettings: "Back to account settings",
    adjustScope: "Adjust monitoring scope",
    customerPayable: "Pilot customer payable",
    pilotCharge: "The platform charges no service or usage fees during the controlled pilot.",
    sampling: "Sampling slots",
    generation: "Content generations",
    ungranted: "No grant",
    limitReached: "Count limit reached",
    zeroQuota: "No quota is available. The next step is to wait for a pilot grant.",
    overLimit: "The count or budget ceiling is reached. The next step is to adjust the question count or repeats.",
    currencySummary: "Totals by currency",
    noUsage: "There are no quota movements yet.",
    emptyFilter: "Nothing matches these filters. Clear them to see the full list.",
    clearFilters: "Clear filters",
    filterKind: "Kind",
    filterState: "State",
    filterCurrency: "Currency",
    reserved: "Reserved",
    settled: "Used",
    released: "Released",
    unknownAmount: "Unknown",
    nextPage: "Next page",
    runLink: "Open run",
    loading: "Loading pilot quotas…",
    unavailable: "Pilot quotas are temporarily unavailable. Try again shortly.",
    retry: "Reload quotas",
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
  const directory = process.env.GEO_USAGE_SCREENSHOTS;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function register(context: BrowserContext) {
  const email = `settings-usage-${randomUUID()}@example.invalid`;
  const signup = await registerTestAccount(context, {
    name: "Settings usage visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(signup.status()).toBe(200);
  const { user: { id } } = await signup.json();
  return String(id);
}

test("settings usage supports bilingual quota ledger, filters, pagination, isolation and recovery", async ({ context, page, browser }) => {
  test.setTimeout(180_000);
  const sql = openTestDatabase();
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const users: string[] = [];
  const main = page.getByRole("main");
  let brandId = "";
  let runId = "";
  let reservedSlotId = "";

  async function checkStateAcrossViewports(
    primaryKey: "backSettings" | "adjustScope",
    shotPrefix: string,
    assertBody: (locale: (typeof locales)[number]) => Promise<void>,
  ) {
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
        await expect(main.getByRole("link", { name: labels[primaryKey], exact: true }).first()).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await assertBody(locale);
        if (width === 375) await screenshot(page, `${shotPrefix}-${locale}-375`);
      }
    }
  }

  try {
    const ownerId = await register(context);
    users.push(ownerId);
    users.push(await register(outsider));

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(settingsRoute);
    await keyboardActivate(page, main.getByRole("link", { name: copy["zh-CN"].openUsage, exact: true }));
    await expect(page).toHaveURL(`${origin}${route}`);

    await checkStateAcrossViewports("backSettings", "empty", async (locale) => {
      const labels = copy[locale];
      await expect(main.getByText(labels.ungranted, { exact: true })).toBeVisible();
      await expect(main.getByText(labels.zeroQuota, { exact: true })).toBeVisible();
      await expect(main.getByText(labels.noUsage, { exact: true }).first()).toBeVisible();
    });

    const brandResponse = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: ownerId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: "Synthetic Usage Brand",
          description: "Synthetic brand for settings usage acceptance.",
          website: "",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(brandResponse.status()).toBe(200);
    brandId = (await brandResponse.json()).id as string;

    const now = new Date();
    const changedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO quota_grant (brand_id, kind, version, operation_id, fingerprint, actor_id, reason, count_limit, budget_minor, currency, expires_at, changed_at, action)
      VALUES
        (${brandId}, 'sampling', 1, ${randomUUID()}, ${`fp-sampling-${randomUUID()}`}, ${ownerId}, 'pilot-approval', 22, 10000, 'CNY', ${expiresAt}, ${changedAt}, 'set'),
        (${brandId}, 'generation', 1, ${randomUUID()}, ${`fp-gen-${randomUUID()}`}, ${ownerId}, 'pilot-approval', 5, 5000, 'USD', ${expiresAt}, ${changedAt}, 'set')
    `;

    runId = randomUUID();
    await sql`
      INSERT INTO monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) VALUES (
        ${runId}, ${brandId}, ${ownerId}, ${randomUUID()}, ${`fp-run-${randomUUID()}`}, 'model_api',
        ${randomUUID()}, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 120, 120, 0, 'running', 0, ${changedAt}
      )
    `;

    const reservedReservationId = randomUUID();
    reservedSlotId = randomUUID();
    const latestTs = new Date(now.getTime() + 60_000).toISOString();

    await sql`
      INSERT INTO quota_reservation (brand_id, kind, id, grant_version, upper_minor, state, created_at, finalized_at)
      VALUES (${brandId}, 'sampling', ${reservedReservationId}, 1, 120, 'reserved', ${latestTs}, NULL)
    `;
    await sql`
      INSERT INTO monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
        repeat_index, reservation_id, status, created_at, adopted_attempt_id, late
      ) VALUES (
        ${reservedSlotId}, ${runId}, ${brandId}, ${randomUUID()}, 1, ${randomUUID()}, 1,
        1, ${reservedReservationId}, 'reconciliation_required', ${latestTs}, NULL, 0
      )
    `;
    await sql`
      INSERT INTO quota_attempt (brand_id, kind, reservation_id, id, upper_minor, actual_minor, state, started_at, reconciled_at)
      VALUES (${brandId}, 'sampling', ${reservedReservationId}, ${randomUUID()}, 120, NULL, 'unknown', ${latestTs}, NULL)
    `;

    for (let index = 0; index < 21; index += 1) {
      const settledId = randomUUID();
      const ts = new Date(now.getTime() - (index + 1) * 1000).toISOString();
      await sql`
        INSERT INTO quota_reservation (brand_id, kind, id, grant_version, upper_minor, state, created_at, finalized_at)
        VALUES (${brandId}, 'sampling', ${settledId}, 1, 100, 'settled', ${ts}, ${ts})
      `;
      await sql`
        INSERT INTO quota_attempt (brand_id, kind, reservation_id, id, upper_minor, actual_minor, state, started_at, reconciled_at)
        VALUES (${brandId}, 'sampling', ${settledId}, ${randomUUID()}, 100, 80, 'known', ${ts}, ${ts})
      `;
    }

    const genReservationId = randomUUID();
    const genTs = new Date(now.getTime() - 30_000).toISOString();
    await sql`
      INSERT INTO quota_reservation (brand_id, kind, id, grant_version, upper_minor, state, created_at, finalized_at)
      VALUES (${brandId}, 'generation', ${genReservationId}, 1, 250, 'released', ${genTs}, ${genTs})
    `;

    await checkStateAcrossViewports("adjustScope", "populated", async (locale) => {
      const labels = copy[locale];
      await expect(main.getByText(labels.limitReached, { exact: true })).toBeVisible();
      await expect(main.getByText(labels.overLimit, { exact: true })).toBeVisible();
      await expect(main.getByText(labels.pilotCharge, { exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: "CNY", exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: "USD", exact: true })).toBeVisible();
      await expect(main.getByText(reservedSlotId, { exact: true })).toBeVisible();
      await expect(main.getByRole("link", { name: labels.runLink, exact: true })).toHaveAttribute(
        "href",
        `/dashboard/monitoring/runs/${runId}`,
      );
      await expect(main.getByRole("link", { name: labels.nextPage, exact: true })).toBeVisible();
    });

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await page.goto(route);

    await keyboardActivate(page, main.getByRole("link", { name: copy.en.nextPage, exact: true }));
    await expect(page).toHaveURL(/beforeCreatedAt=/);
    await expect(main.locator("tbody tr")).toHaveCount(3);
    await expect(main.getByText(reservedSlotId, { exact: true })).toHaveCount(0);

    await page.goto(route);
    const kindGroup = main.getByRole("group", { name: copy.en.filterKind });
    const stateGroup = main.getByRole("group", { name: copy.en.filterState });
    await keyboardActivate(page, kindGroup.getByRole("link", { name: copy.en.generation, exact: true }));
    await expect(page).toHaveURL(`${origin}${route}?kind=generation`);
    await keyboardActivate(page, stateGroup.getByRole("link", { name: copy.en.released, exact: true }));
    await expect(page).toHaveURL(`${origin}${route}?kind=generation&state=released`);
    await expect(main.locator("tbody tr")).toHaveCount(1);
    await expect(main.locator("tbody").getByText(copy.en.generation, { exact: true })).toBeVisible();

    await keyboardActivate(page, stateGroup.getByRole("link", { name: copy.en.settled, exact: true }));
    await expect(main.getByText(copy.en.emptyFilter, { exact: true })).toBeVisible();
    await keyboardActivate(page, main.getByRole("link", { name: copy.en.clearFilters, exact: true }).first());
    await expect(page).toHaveURL(`${origin}${route}`);
    await expect(main.locator("tbody tr")).toHaveCount(20);

    const outsiderPage = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await outsiderPage.goto(route);
    const outsiderMain = outsiderPage.getByRole("main");
    await expect(outsiderMain.getByText(copy.en.ungranted, { exact: true })).toBeVisible();
    await expect(outsiderMain.getByText(reservedSlotId, { exact: true })).toHaveCount(0);
    await expect(outsiderMain.getByRole("heading", { name: "CNY", exact: true })).toHaveCount(0);
    await outsiderPage.close();

    for (const locale of locales) {
      const labels = copy[locale];
      await page.setViewportSize({ width: 375, height: 800 });
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-usage-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(`${route}?kind=sampling`, { waitUntil: "commit" });
      await expect(main.getByRole("status", { name: labels.loading })).toBeVisible();
      await screenshot(page, `loading-${locale}-375`);

      const alert = main.getByRole("alert");
      await expect(alert).toContainText(labels.unavailable);
      await expect(main.getByRole("heading", { level: 1, name: labels.title, exact: true })).toBeVisible();
      await expect(main.getByText("Private usage fixture failure")).toHaveCount(0);
      await expect(main.getByText(labels.customerPayable, { exact: true })).toHaveCount(0);
      await expect(main.getByRole("heading", { name: labels.currencySummary, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

      const retry = main.getByRole("link", { name: labels.retry, exact: true });
      await expect(retry).toBeInViewport({ ratio: 1 });
      await expect(retry).toHaveAttribute("href", `${route}?kind=sampling`);
      await screenshot(page, `unavailable-${locale}-375`);

      await context.clearCookies({ name: "geo-usage-read" });
      await keyboardActivate(page, retry);
      await expect(page).toHaveURL(`${origin}${route}?kind=sampling`);
      await expect(main.getByText(reservedSlotId, { exact: true })).toBeVisible();
    }
  } finally {
    try {
      await outsider.close();
      if (runId) await sql`DELETE FROM monitoring_run WHERE id = ${runId}`;
      if (brandId) await sql`DELETE FROM brand WHERE id = ${brandId}`;
      if (users.length) {
        await sql`DELETE FROM "user" WHERE id IN ${sql(users)}`;
        expect(await sql`SELECT id FROM "user" WHERE id IN ${sql(users)}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
