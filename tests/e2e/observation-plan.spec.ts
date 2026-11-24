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
    exploratoryTask: "窗口已到期，但可比题低于 80% 门槛。这是探索记录，排除题原样保留。不要把它写成正式结论。下一步是查看排除题。",
    save: "保存观察",
    requestFormal: "请求正式结论",
    viewExcluded: "查看排除题",
    related: "相关入口",
    observing: "观察中",
    recorded: "检查点已记录",
    progress: "进度",
    exploratory: "探索",
    emptyConclusion: "完整观察结论为空。",
    exploratoryConclusion: "窗口已到期，但可比题低于 80% 门槛。这是探索记录。",
    unavailable: "暂时无法读取或保存观察记录，请稍后重试。",
    reload: "重新载入",
    missing: "找不到这条观察，或它不属于当前账号。",
    openBrand: "去建档",
  },
  en: {
    title: "Observation plan",
    emptyTask: "No observation has been saved. The frozen question set is not rewritten, and no sampling run is created. Save an observation next.",
    pendingTask: "This observation has no checkpoint yet. A control page can be registered before the first checkpoint, and its label stays observation. Record a checkpoint next. Before the window is due, only progress is stored and the full conclusion stays empty.",
    progressTask: "The latest checkpoint is not due yet. The full observation conclusion is empty. This is not a formal comparison. Record a checkpoint next.",
    exploratoryTask: "The window is due, but comparable questions are under the 80% threshold. This is an exploratory record and the excluded questions stay as entered. Do not treat it as a formal conclusion. Review the excluded questions next.",
    save: "Save observation",
    requestFormal: "Request a formal conclusion",
    viewExcluded: "Review excluded questions",
    related: "Related entries",
    observing: "Observing",
    recorded: "Checkpoint recorded",
    progress: "Progress",
    exploratory: "Exploratory",
    emptyConclusion: "The full observation conclusion is empty.",
    exploratoryConclusion: "The window is due, but comparable questions are under the 80% threshold. This is an exploratory record.",
    unavailable: "Observations cannot be read or saved right now. Try again later.",
    reload: "Reload",
    missing: "This observation was not found, or it belongs to another account.",
    openBrand: "Open brands",
  },
} as const;

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
        await expect(main.getByText(effectiveOn)).toBeVisible();
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
    await page.locator("input[name='comparableQuestions']").fill("30");
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

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.locator("input[name='today']").fill(dueDay);
    await page.locator("input[name='comparableQuestions']").fill("23");
    await page.locator("textarea[name='excluded']").fill(excluded.join("\n"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].requestFormal, exact: true }));
    await expect(page.getByText(copy["zh-CN"].exploratoryTask, { exact: true })).toBeVisible();
    const exploratory = await readObservations(context, brandId);
    expect(exploratory.observations[0]?.checkpoints).toHaveLength(2);
    const due = exploratory.observations[0]?.checkpoints.find((item) => item.evaluatedOn === dueDay);
    if (!due) throw new Error("missing due checkpoint");
    expect(due.mode).toBe("exploratory");
    expect(due.comparableCount).toBe(23);
    expect(due.excluded).toEqual(excluded);
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
        for (const id of excluded) await expect(main.getByText(id, { exact: true })).toBeVisible();
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

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await stranger.evaluate(() => window.scrollTo(0, 0));
    const hidden = stranger.getByRole("main");
    await expect(hidden.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(hidden.getByRole("alert")).toContainText(copy.en.missing);
    await expect(hidden.getByText(frozenSetId)).toHaveCount(0);
    await expect(hidden.getByText(brandName)).toHaveCount(0);
    await expect(hidden.getByRole("link", { name: copy.en.openBrand, exact: true })).toBeInViewport();
    await expect(hidden.getByRole("button", { name: copy.en.requestFormal, exact: true })).toHaveCount(0);
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
