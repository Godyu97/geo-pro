import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/monitoring/demo";
const api = "/api/monitoring/demo-observations";
const headers = { Origin: origin };
const shots = ".cache/issue-135/demo";
const probe = "geo-demo-read";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const copy = {
  "zh-CN": {
    title: "演示空间", open: "打开演示空间", badge: "演示数据", setup: "前往品牌资料",
    noBrand: "当前没有可保存演示观察的品牌。", empty: "还没有演示观察。",
    history: "演示记录", viewHistory: "查看历史",
    enter: "填写演示观察", form: "保存演示观察", question: "问题", answer: "回答", save: "保存演示观察",
    invalid: "请检查品牌、问题和回答。", saved: "已保存。这条记录只属于演示空间，不进入真实统计。",
    unavailable: "演示观察暂时不可用，请稍后重试。", loading: "正在加载演示观察…",
    reload: "重新载入", missing: "找不到该品牌的演示观察。",
  },
  en: {
    title: "Demo space", open: "Open demo space", badge: "Demo data", setup: "Go to brands",
    noBrand: "There is no brand available for a demo observation.", empty: "No demo observations yet.",
    history: "Demo history", viewHistory: "View history",
    enter: "Enter a demo observation", form: "Save a demo observation", question: "Question", answer: "Answer", save: "Save demo observation",
    invalid: "Check the brand, question, and answer.", saved: "Saved. This record stays in the demo space and is left out of real statistics.",
    unavailable: "Demo observations are temporarily unavailable. Try again shortly.", loading: "Loading demo observations…",
    reload: "Reload", missing: "Demo observations for that brand were not found.",
  },
};
type Locale = typeof locales[number];

async function register(context: BrowserContext) {
  const response = await registerTestAccount(context, {
    name: "Demo space visual test", email: `demo-visual-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function createBrand(context: BrowserContext, userId: string, name: string) {
  const response = await context.request.post("/api/brands", {
    headers,
    data: {
      action: "submit", actorId: userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name, description: "Synthetic brand for demo space acceptance.", website: "", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function keyboardActivate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: Locale, width: number, brandId?: string) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(brandId ? `${path}?brandId=${brandId}` : path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="monitoring"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(copy[locale].title));
  await expect(main.getByText(copy[locale].badge, { exact: true }).first()).toBeVisible();
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number) {
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test("demo space directs accounts with no brand to brand setup", async ({ page, context }) => {
  test.setTimeout(60_000);
  const sql = openTestDatabase();
  let userId: string | undefined;
  try {
    userId = await register(context);
    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width);
        const destination = main.getByRole("link", { name: copy[locale].setup, exact: true });
        await checkLayout(page, destination, width);
        await expect(main.getByText(copy[locale].noBrand, { exact: true })).toBeVisible();
        await expect(main.getByRole("form")).toHaveCount(0);
        if (width === 375) await page.screenshot({ path: `${shots}/no-brand-${locale}-375.png` });
      }
    }
    await keyboardActivate(page, page.getByRole("link", { name: copy.en.setup, exact: true }));
    await expect(page).toHaveURL(`${origin}/dashboard/brands`);
  } finally {
    try {
      if (userId) {
        await sql`delete from "user" where id = ${userId}`;
        expect(await sql`select 1 from "user" where id = ${userId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});

test("demo space browses brand history and safely retries a save with an unknown outcome", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const sql = openTestDatabase();
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: string[] = [];
  const brandIds: string[] = [];
  const longBrand = `Synthetic-${"brand".repeat(13)}`;
  const questionText = `合成问题 ${"Question".repeat(30)}`;
  const answerText = `合成回答\n${"Answer".repeat(55)}`;
  try {
    const ownerId = await register(context);
    accounts.push(ownerId);
    accounts.push(await register(outsider));
    const brandId = await createBrand(context, ownerId, longBrand);
    brandIds.push(brandId);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(`/dashboard/monitoring/overview?brandId=${brandId}`);
    await keyboardActivate(page, page.getByRole("link", { name: copy["zh-CN"].open, exact: true }));
    await expect(page).toHaveURL(`${origin}${path}?brandId=${brandId}`);

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width, brandId);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].enter, exact: true }), width);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expect(main.getByRole("form", { name: copy[locale].form }).getByText(longBrand, { exact: true })).toBeVisible();
        if (width === 375) await page.screenshot({ path: `${shots}/empty-${locale}-375.png` });
      }
    }

    const main = await visit(page, "zh-CN", 375, brandId);
    const question = main.getByRole("textbox", { name: "问题", exact: true });
    const answer = main.getByRole("textbox", { name: "回答", exact: true });
    const chineseSubmit = main.getByRole("button", { name: "保存演示观察", exact: true });
    await keyboardActivate(page, main.getByRole("link", { name: "填写演示观察" }));
    await expect(question).toBeFocused();
    expect(await question.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await page.screenshot({ path: `${shots}/focus-zh-CN-375.png` });

    await question.fill("   ");
    await answer.fill(answerText);
    await keyboardActivate(page, chineseSubmit);
    await expect(question).toBeFocused();
    await expect(question).toHaveAttribute("aria-invalid", "true");
    await expect(main.getByRole("alert")).toHaveText(copy["zh-CN"].invalid);

    const operationIds: string[] = [];
    let releaseResponse: () => void = () => {};
    const responsePaused = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route(`**${api}`, async (route) => {
      const data = route.request().postDataJSON();
      operationIds.push(data.operationId);
      if (operationIds.length === 1) {
        const submitted = await route.fetch();
        try {
          expect(submitted.status()).toBe(200);
          expect((await submitted.json()).observation.is_demo).toBe(true);
        } finally {
          await submitted.dispose();
        }
        await responsePaused;
        await route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Private demo write fixture failure" } } });
        return;
      }
      await route.continue();
    });
    await question.fill(questionText);
    await keyboardActivate(page, chineseSubmit);
    const pending = main.getByRole("button", { name: "正在保存…", exact: true });
    try {
      await expect(pending).toBeFocused();
      await expect(pending).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect.poll(() => operationIds.length).toBe(1);
    } finally {
      releaseResponse();
    }
    await expect(main.getByRole("alert")).toHaveText(copy["zh-CN"].unavailable);
    await expect(chineseSubmit).toBeFocused();
    await expect(main).not.toContainText("Private demo write fixture failure");

    await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(main.getByRole("alert")).toHaveText(copy.en.unavailable);
    await expect(main.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(questionText);
    await expect(main.getByRole("textbox", { name: "Answer", exact: true })).toHaveValue(answerText);
    await page.screenshot({ path: `${shots}/save-unavailable-en-375.png` });
    await keyboardActivate(page, main.getByRole("button", { name: copy.en.save, exact: true }));
    await expect(main.getByRole("status").filter({ hasText: copy.en.saved })).toBeVisible();
    await expect(main.getByRole("region", { name: copy.en.history }).getByRole("listitem")).toHaveCount(1);
    expect(operationIds).toEqual([operationIds[0], operationIds[0]]);
    await page.screenshot({ path: `${shots}/saved-en-375.png` });

    const rows = await sql`select question_text, answer_text, is_demo from demo_observation where brand_id = ${brandId}`;
    expect(rows).toEqual([{ question_text: questionText, answer_text: answerText, is_demo: 1 }]);
    const [counts] = await sql`select
      (select count(*)::int from answer_observation where brand_id = ${brandId}) as answers,
      (select count(*)::int from report_snapshot where brand_id = ${brandId}) as snapshots,
      (select count(*)::int from report_retest where brand_id = ${brandId}) as retests`;
    expect(counts).toEqual({ answers: 0, snapshots: 0, retests: 0 });
    const list = await context.request.get(`${api}?brandId=${brandId}`, { headers });
    expect(list.status()).toBe(200);
    expect(await list.json()).toMatchObject({ is_demo: true, observations: [{ brandId, questionText, answerText, is_demo: true }] });

    for (const locale of locales) {
      for (const width of widths) {
        const current = await visit(page, locale, width, brandId);
        const viewHistory = current.getByRole("link", { name: copy[locale].viewHistory, exact: true });
        await checkLayout(page, viewHistory, width);
        const history = current.getByRole("region", { name: copy[locale].history, exact: true });
        const entry = history.getByRole("listitem");
        await expect(entry.getByText(copy[locale].badge, { exact: true })).toBeVisible();
        await expect(entry.getByText(questionText, { exact: true })).toHaveCount(1);
        expect(await entry.getByText(/合成回答/).textContent()).toBe(answerText);
        if (width === 375 || width === 1440) {
          await keyboardActivate(page, viewHistory);
          await expect(history.getByRole("heading")).toBeFocused();
          await page.screenshot({ path: `${shots}/history-${locale}-${width}.png` });
        }
      }
    }

    await visit(page, "en", 375);
    await expect(main.getByRole("region", { name: copy.en.history }).getByText(questionText, { exact: true })).toBeVisible();

    const deniedPage = await outsider.newPage();
    const denied = await visit(deniedPage, "en", 375, brandId);
    await expect(denied.getByRole("alert")).toHaveText(copy.en.missing);
    await expect(denied).not.toContainText(questionText);
    await expect(denied.getByRole("form")).toHaveCount(0);
    await deniedPage.screenshot({ path: `${shots}/denied-en-375.png` });
    expect((await outsider.request.get(`${api}?brandId=${brandId}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(api, {
      headers, data: { brandId, questionText, answerText, operationId: randomUUID() },
    })).status()).toBe(404);

    for (const locale of locales) {
      const text = copy[locale];
      await context.addCookies([{ name: probe, value: "slow-unavailable", url: origin }, { name: "geo-locale", value: locale, url: origin }]);
      await page.goto(`${path}?brandId=${brandId}`, { waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: text.loading })).toBeVisible();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(main.getByRole("alert")).toHaveText(text.unavailable);
      const reload = main.getByRole("link", { name: text.reload, exact: true });
      await checkLayout(page, reload, 375);
      await expect(main).not.toContainText("Private demo fixture failure");
      await expect(main).not.toContainText(questionText);
      await expect(main.getByRole("form")).toHaveCount(0);
      await page.screenshot({ path: `${shots}/read-unavailable-${locale}-375.png` });
      await context.clearCookies({ name: probe });
      await keyboardActivate(page, reload);
      await expect(page).toHaveURL(`${origin}${path}?brandId=${brandId}`);
      await expect(main.getByRole("region", { name: text.history }).getByText(questionText, { exact: true })).toBeVisible();
    }

    const archive = await context.request.post("/api/brands", {
      headers, data: { action: "archive", actorId: ownerId, operationId: randomUUID(), brandId, expectedBrandRevision: 1 },
    });
    expect(archive.status()).toBe(200);
    const currentBrandId = await createBrand(context, ownerId, "Synthetic current brand");
    brandIds.push(currentBrandId);
    await visit(page, "en", 375, brandId);
    await expect(main.getByRole("form")).toHaveCount(0);
    await expect(main.getByRole("region", { name: copy.en.history }).getByText(questionText, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${shots}/archived-en-375.png` });
    await keyboardActivate(page, main.getByRole("link", { name: "View current brand", exact: true }));
    await expect(page).toHaveURL(`${origin}${path}?brandId=${currentBrandId}`);
    await expect(main.getByText(copy.en.empty, { exact: true })).toBeVisible();
    await expect(main).not.toContainText(questionText);
    expect(operationIds).toHaveLength(2);
    expect(await sql`select 1 from demo_observation where brand_id = ${currentBrandId}`).toHaveLength(0);
  } finally {
    try {
      await outsider.close();
      for (const id of accounts) {
        await sql`delete from "user" where id = ${id}`;
        expect(await sql`select 1 from "user" where id = ${id}`).toHaveLength(0);
      }
      for (const id of brandIds) {
        const [remaining] = await sql`select
          exists(select 1 from brand where id = ${id}) as brand,
          exists(select 1 from brand_version where brand_id = ${id}) as version,
          exists(select 1 from demo_observation where brand_id = ${id}) as demo`;
        expect(remaining).toEqual({ brand: false, version: false, demo: false });
      }
    } finally {
      await sql.end();
    }
  }
});
