import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const stamp = "2026-11-25T10:00:00.000Z";
const brandName = `合成行动品牌-${"LongSegment_".repeat(4)}end`;
const actionText = `合成核对已批准事实-${"LongAction_".repeat(12)}end`;
const keptMaterial = "保留这段合成材料";

const copy = {
  "zh-CN": {
    nav: "每周行动",
    toggle: "切换侧边导航",
    title: "每周行动草案",
    noBrand: "先完成一个活跃品牌的建档，再生成每周行动草案。",
    openBrand: "去建档",
    createTask: "还没有草案。下一步是填写材料并生成。",
    plansTask: "已有草案。下一步是确认仍然有效的条目。",
    fillDraft: "填写草案",
    viewPlans: "查看草案",
    related: "相关入口",
    material: "材料",
    create: "生成草案",
    invalid: "草案无效。请检查动作、事实版本和数字。",
    heading: "本周草案 1 条",
    budget: "预算 2,500，未被材料改变。",
    successes: "历史成功 1 次",
    draft: "草案",
    confirmed: "已确认",
    executed: "已执行",
    settled: "已执行确认",
    notGuaranteed: "不保证收益",
    selectItem: "确认这条",
    confirm: "确认所选",
    execute: "执行已确认",
    saving: "正在保存…",
    confirmedNotice: "所选条目已确认。",
    executedNotice: "已确认的条目已执行。预算和授权没有改变。",
    reviewTitle: "本周复盘",
    reviewNextStep: "建议的下一步",
    saveReview: "确认并保存复盘",
    reviewSaved: "复盘已保存。",
    reviewCounts: "已执行 1 项，因事实失效受阻 1 项。",
    invalidReview: "请输入一句非空的下一步建议（最多 500 字），并删除保证收益的表述。",
    loading: "正在读取每周行动…",
    unavailable: "暂时无法读取或保存草案，请稍后重试。",
    reload: "重新载入",
    privateFailure: "Private assistant fixture failure",
  },
  en: {
    nav: "Weekly actions",
    toggle: "Toggle sidebar navigation",
    title: "Weekly action draft",
    noBrand: "Finish an active brand profile before drafting weekly actions.",
    openBrand: "Open brands",
    createTask: "No draft yet. The next step is to enter material and create one.",
    plansTask: "A draft is already saved. The next step is to confirm items whose facts are still current.",
    fillDraft: "Fill in the draft",
    viewPlans: "View the draft",
    related: "Related entries",
    material: "Material",
    create: "Create draft",
    invalid: "The draft is invalid. Check the actions, fact versions, and numbers.",
    heading: "Weekly draft, 1 items",
    budget: "Budget 2,500, unchanged by the material.",
    successes: "1 past successes",
    draft: "Draft",
    confirmed: "Confirmed",
    executed: "Executed",
    settled: "Confirmation executed",
    notGuaranteed: "No guaranteed return",
    selectItem: "Confirm this item",
    confirm: "Confirm selected",
    execute: "Execute confirmed",
    saving: "Saving…",
    confirmedNotice: "The selected items are confirmed.",
    executedNotice: "The confirmed items were executed. The budget and authorization were not changed.",
    reviewTitle: "Weekly review",
    reviewNextStep: "Suggested next step",
    saveReview: "Confirm and save review",
    reviewSaved: "Review saved.",
    reviewCounts: "1 executed · 1 blocked because the linked fact was no longer current.",
    invalidReview: "Enter a one-line next step of up to 500 characters and remove any claims of guaranteed results.",
    loading: "Loading weekly actions…",
    unavailable: "Drafts cannot be read or saved right now. Try again later.",
    reload: "Reload",
    privateFailure: "Private assistant fixture failure",
  },
} as const;

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Assistant plans visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function createBrand(context: BrowserContext, ownerId: string) {
  const response = await context.request.post("/api/brands", {
    headers,
    data: {
      action: "submit",
      actorId: ownerId,
      operationId: randomUUID(),
      target: null,
      expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: brandName,
        description: "合成每周行动视觉验收资料。",
        website: "https://assistant-plans.example.com/guide",
        aliases: [],
        region: "CN",
        language: "zh-CN",
        competitors: [],
        questions: [],
      },
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function capture(page: Page, dir: string | undefined, name: string) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false });
}

test("weekly action drafts keep the next action, confirmation, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_ASSISTANT_SCREENSHOTS || ".cache/issue-135/assistant-plans";
  const ownerEmail = `assistant-plans-${randomUUID()}@example.invalid`;
  const outsiderEmail = `assistant-plans-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  const sql = openTestDatabase();
  const planId = randomUUID();
  const itemId = randomUUID();
  const factId = randomUUID();
  let ownerId = "";

  try {
    ownerId = await register(context, ownerEmail);
    accounts.push({ userId: ownerId, email: ownerEmail });
    accounts.push({
      userId: await register(outsider, outsiderEmail),
      email: outsiderEmail,
    });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: copy["zh-CN"].toggle, exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await activateFromKeyboard(page, dialog.getByRole("link", { name: copy["zh-CN"].nav, exact: true }));
    await expect(page).toHaveURL("/dashboard/assistant");

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant");
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toBeVisible();
        const openBrand = main.getByRole("link", { name: t.openBrand, exact: true });
        await expect(openBrand).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByLabel(t.material)).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(openBrand).toBeInViewport();
          await capture(page, screenshotDir, `nobrand-${locale}-375.png`);
        }
      }
    }

    const brandId = await createBrand(context, ownerId);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant");
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.createTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toHaveCount(0);
        const fill = main.getByRole("link", { name: t.fillDraft, exact: true });
        await expect(fill).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(fill).toBeInViewport();
          await activateFromKeyboard(page, fill);
          await expect(main.getByLabel(t.material, { exact: true })).toBeFocused();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
        }
      }
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/assistant");
    const draftMain = page.getByRole("main");
    await draftMain.getByLabel(tZh.material, { exact: true }).fill(keptMaterial);
    let createPosts = 0;
    const countCreates = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && request.url().endsWith("/api/assistant/plans")) createPosts += 1;
    };
    page.on("request", countCreates);
    await draftMain.getByRole("button", { name: tZh.create, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(draftMain.getByRole("alert")).toContainText(tZh.invalid);
    await expect(draftMain.getByLabel(tZh.material, { exact: true })).toHaveValue(keptMaterial);
    expect(createPosts).toBe(0);
    page.off("request", countCreates);

    const materialHash = createHash("sha256").update("synthetic-assistant-visual").digest("hex");
    await sql`
      INSERT INTO brand_fact_version
        (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
      VALUES (${brandId}, ${factId}, ${factId}, 1, 1, NULL, 1, 'approved', 'fixture', ${stamp}, ${ownerId}, ${stamp}, NULL)
    `;
    await sql`
      INSERT INTO assistant_plan (
        id, brand_id, owner_id, material_hash, status, controls_unchanged, ignored, budget_minor,
        strategy_label, guaranteed, successes, created_at, updated_at
      ) VALUES (
        ${planId}, ${brandId}, ${ownerId}, ${materialHash}, 'draft', 1, 0, 2500,
        'observation', 0, 1, ${stamp}, ${stamp}
      )
    `;
    await sql`
      INSERT INTO assistant_plan_item (
        id, plan_id, brand_id, owner_id, position, action_text, fact_version_id, fact_current,
        status, block_reason, created_at, updated_at
      ) VALUES (
        ${itemId}, ${planId}, ${brandId}, ${ownerId}, 1, ${actionText}, ${factId}, 1,
        'draft', NULL, ${stamp}, ${stamp}
      )
    `;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant");
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(t.plansTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { level: 2, name: t.heading, exact: true })).toBeVisible();
        await expect(main.getByText(actionText, { exact: true })).toBeVisible();
        await expect(main.getByText(t.budget, { exact: true })).toBeVisible();
        await expect(main.getByText(t.successes, { exact: true })).toBeVisible();
        await expect(main.getByText(t.notGuaranteed, { exact: true })).toBeVisible();
        const view = main.getByRole("link", { name: t.viewPlans, exact: true });
        await expect(view).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(view).toBeInViewport();
          await activateFromKeyboard(page, view);
          await expect(page.locator("#main-content #assistant-plans")).toBeFocused();
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
        }
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-assistant-write", value: "slow", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/assistant");
    const planMain = page.getByRole("main");
    const plans = page.locator("#main-content #assistant-plans");
    const checkbox = plans.getByRole("checkbox", { name: tZh.selectItem, exact: true });
    await checkbox.focus();
    await page.keyboard.press(" ");
    await expect(checkbox).toBeChecked();
    let confirmPosts = 0;
    const countConfirms = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && request.url().includes("/api/assistant/plans/") && request.url().endsWith("/confirm")) {
        confirmPosts += 1;
      }
    };
    page.on("request", countConfirms);
    const confirmed = page.waitForResponse((response) => (
      response.url().endsWith("/confirm") && response.request().method() === "POST"
    ));
    const confirm = plans.getByRole("button", { name: tZh.confirm, exact: true });
    await confirm.focus();
    await page.keyboard.press("Enter");
    const saving = plans.getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    expect((await confirmed).ok()).toBe(true);
    await expect(planMain.getByText(tZh.confirmedNotice, { exact: true })).toBeVisible();
    await expect(plans.getByText(tZh.confirmed, { exact: true })).toBeVisible();
    expect(confirmPosts).toBe(1);
    page.off("request", countConfirms);
    const confirmedPlan = await sql`
      SELECT status, budget_minor, guaranteed FROM assistant_plan WHERE id = ${planId}
    `;
    const confirmedItem = await sql`
      SELECT status FROM assistant_plan_item WHERE id = ${itemId}
    `;
    expect(confirmedPlan[0]?.status).toBe("draft");
    expect(Number(confirmedPlan[0]?.budget_minor)).toBe(2500);
    expect(Number(confirmedPlan[0]?.guaranteed)).toBe(0);
    expect(confirmedItem[0]?.status).toBe("confirmed");
    await context.clearCookies({ name: "geo-assistant-write" });

    let executePosts = 0;
    const countExecutes = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && request.url().endsWith("/execute")) executePosts += 1;
    };
    page.on("request", countExecutes);
    const executed = page.waitForResponse((response) => (
      response.url().endsWith("/execute") && response.request().method() === "POST"
    ));
    await plans.getByRole("button", { name: tZh.execute, exact: true }).focus();
    await page.keyboard.press("Enter");
    expect((await executed).ok()).toBe(true);
    await expect(planMain.getByText(tZh.executedNotice, { exact: true })).toBeVisible();
    await expect(plans.getByText(tZh.executed, { exact: true })).toBeVisible();
    await expect(plans.getByText(tZh.settled, { exact: true })).toBeVisible();
    await expect(plans.getByText(tZh.budget, { exact: true })).toBeVisible();
    expect(executePosts).toBe(1);
    page.off("request", countExecutes);
    const settledPlan = await sql`
      SELECT status, budget_minor, guaranteed FROM assistant_plan WHERE id = ${planId}
    `;
    const settledItem = await sql`
      SELECT status FROM assistant_plan_item WHERE id = ${itemId}
    `;
    expect(settledPlan[0]?.status).toBe("settled");
    expect(Number(settledPlan[0]?.budget_minor)).toBe(2500);
    expect(Number(settledPlan[0]?.guaranteed)).toBe(0);
    expect(settledItem[0]?.status).toBe("executed");

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto("/dashboard/assistant");
    await expect(stranger.getByRole("main").getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(actionText)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-assistant-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto("/dashboard/assistant", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(actionText)).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-assistant-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(actionText, { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify(account),
      ], { stdio: "inherit" });
    }
    if (accounts.length > 0) {
      const users = accounts.map((account) => account.userId);
      expect(await sql`SELECT id FROM "user" WHERE id IN ${sql(users)}`).toHaveLength(0);
      expect(await sql`SELECT id FROM assistant_plan WHERE id = ${planId}`).toHaveLength(0);
    }
    await sql.end();
  }
});

test("settled plans keep one owner-confirmed review in either language", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Array<{ userId: string; email: string }> = [];
  const sql = openTestDatabase();
  const planIds = [randomUUID(), randomUUID()];
  const nextSteps = ["下周复核受阻条目的新事实。", "Review the updated supporting fact with the owner next week."];
  const screenshotDir = process.env.GEO_ASSISTANT_REVIEW_SCREENSHOTS || ".cache/issue-169";
  try {
    const email = `assistant-review-${randomUUID()}@example.invalid`;
    const ownerId = await register(context, email);
    accounts.push({ userId: ownerId, email });
    const otherEmail = `assistant-review-other-${randomUUID()}@example.invalid`;
    accounts.push({ userId: await register(outsider, otherEmail), email: otherEmail });
    const brandId = await createBrand(context, ownerId);
    const [currentFact, staleFact] = [randomUUID(), randomUUID()];
    await sql`
      INSERT INTO brand_fact_version
        (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
      VALUES
        (${brandId}, ${currentFact}, ${currentFact}, 1, 1, NULL, 1, 'approved', 'fixture', ${stamp}, ${ownerId}, ${stamp}, NULL),
        (${brandId}, ${staleFact}, ${staleFact}, 1, 1, NULL, 1, 'revoked', 'fixture', ${stamp}, ${ownerId}, ${stamp}, ${stamp})
    `;
    for (const planId of planIds) {
      await sql`
        INSERT INTO assistant_plan
          (id, brand_id, owner_id, material_hash, status, controls_unchanged, ignored, budget_minor,
           strategy_label, guaranteed, successes, created_at, updated_at)
        VALUES (${planId}, ${brandId}, ${ownerId}, ${"a".repeat(64)}, 'draft', 1, 0, 2500, 'observation', 0, 0, ${stamp}, ${stamp})
      `;
      await sql`
        INSERT INTO assistant_plan_item
          (id, plan_id, brand_id, owner_id, position, action_text, fact_version_id, fact_current, status, block_reason, created_at, updated_at)
        VALUES
          (${randomUUID()}, ${planId}, ${brandId}, ${ownerId}, 1, 'Check supported fact', ${currentFact}, 1, 'confirmed', NULL, ${stamp}, ${stamp}),
          (${randomUUID()}, ${planId}, ${brandId}, ${ownerId}, 2, 'Check expired fact', ${staleFact}, 1, 'confirmed', NULL, ${stamp}, ${stamp})
      `;
    }

    const route = (planId: string) => `/api/assistant/plans/${planId}/review`;
    const draft = await context.request.post(route(planIds[0]), { headers, data: { nextStep: nextSteps[0] } });
    expect(draft.status()).toBe(409);
    expect((await draft.json()).error.code).toBe("PLAN_NOT_SETTLED");
    expect(await sql`SELECT id FROM assistant_plan_review WHERE plan_id IN ${sql(planIds)}`).toHaveLength(0);
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto("/dashboard/assistant/plans");
    await expect(page.getByRole("region", { name: copy["zh-CN"].reviewTitle })).toHaveCount(0);

    const unauthorized = await page.request.get(route(planIds[0]), { headers: { Origin: "https://untrusted.example.invalid" } });
    expect(unauthorized.status()).toBe(403);
    const planRows = () => sql`
      SELECT id, owner_id, status, budget_minor, controls_unchanged, guaranteed, strategy_label, updated_at
      FROM assistant_plan WHERE brand_id = ${brandId} ORDER BY id
    `;
    const reviews = () => sql`SELECT * FROM assistant_plan_review WHERE plan_id IN ${sql(planIds)} ORDER BY plan_id`;
    const brandGrants = () => sql`SELECT * FROM quota_grant WHERE brand_id = ${brandId} ORDER BY kind, version`;
    const initialGrants = await brandGrants();
    for (const [index, locale] of locales.entries()) {
      const t = copy[locale];
      const planId = planIds[index];
      const nextStep = nextSteps[index];
      const executed = await context.request.post(`/api/assistant/plans/${planId}/execute`, { headers, data: {} });
      expect(executed.ok()).toBe(true);
      const { plan: settlement } = await executed.json();
      expect(settlement.items.map((item: { status: string }) => item.status)).toEqual(["executed", "blocked"]);
      const priorPlans = await planRows();

      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto("/dashboard/assistant/plans");
      const reviewSection = page.getByRole("region", { name: t.reviewTitle }).filter({
        has: page.getByRole("button", { name: t.saveReview, exact: true }),
      });
      const field = reviewSection.getByRole("textbox", { name: t.reviewNextStep });
      const save = reviewSection.getByRole("button", { name: t.saveReview, exact: true });
      async function submitReviewFromKeyboard() {
        await field.focus();
        await page.keyboard.press("Tab");
        await expect(save).toBeFocused();
        expect(await save.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
        await page.keyboard.press("Enter");
      }
      await submitReviewFromKeyboard();
      await expect(reviewSection.getByRole("alert")).toHaveText(t.invalidReview);
      await field.fill(index === 0 ? "必有效" : "guaranteed improvement");
      await submitReviewFromKeyboard();
      await expect(reviewSection.getByRole("alert")).toHaveText(t.invalidReview);
      await expect(field).toHaveValue(index === 0 ? "必有效" : "guaranteed improvement");
      for (const rejected of [" ", index === 0 ? "必有效" : "guaranteed improvement"]) {
        const invalid = await context.request.post(route(planId), { headers, data: { nextStep: rejected } });
        expect(invalid.status()).toBe(400);
        expect((await invalid.json()).error.code).toBe("INVALID_REVIEW");
      }
      expect(await reviews()).toHaveLength(index);

      await field.fill(nextStep);
      const savedResponse = page.waitForResponse((response) => response.url().endsWith(route(planId)) && response.request().method() === "POST");
      await submitReviewFromKeyboard();
      const saved = await savedResponse;
      expect(saved.ok()).toBe(true);
      const { plan } = await saved.json();
      expect(plan.review).toMatchObject({ planId, executedCount: 1, staleBlockedCount: 1, nextStep });
      await expect(page.getByRole("main").getByText(t.reviewSaved, { exact: true })).toBeVisible();
      const read = await context.request.get(route(planId), { headers });
      expect(read.status()).toBe(200);
      expect(read.headers()["cache-control"]).toBe("private, no-store");
      expect(await read.json()).toEqual({ review: plan.review });

      const replay = await context.request.post(route(planId), { headers, data: { nextStep } });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).plan.review).toEqual(plan.review);
      expect(await reviews()).toHaveLength(index + 1);
      expect(await planRows()).toEqual(priorPlans);
      expect(await brandGrants()).toEqual(initialGrants);
      console.log(`${locale} synthetic browser plan=${planId} review=${plan.review.id} budget=${plan.budgetMinor}; executed=1 staleBlocked=1`);

      const denied = await outsider.request.get(route(planId), { headers });
      const missing = await outsider.request.get(route(randomUUID()), { headers });
      expect(denied.status()).toBe(404);
      expect(missing.status()).toBe(404);
      expect(await denied.json()).toEqual(await missing.json());
      expect(await denied.text()).not.toContain(nextStep);
    }

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/dashboard/assistant/plans");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        for (const nextStep of nextSteps) {
          const review = page.getByRole("region", { name: t.reviewTitle }).filter({ hasText: nextStep });
          await expect(review.getByText(nextStep, { exact: true })).toBeVisible();
          await expect(review.getByText(t.reviewCounts, { exact: true })).toBeVisible();
        }
        await expect(page.getByRole("button", { name: t.saveReview, exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await page.getByText(nextSteps[0], { exact: true }).scrollIntoViewIfNeeded();
          await capture(page, screenshotDir, `review-${locale}-375.png`);
        }
      }
    }
    const stranger = await outsider.newPage();
    await stranger.goto("/dashboard/assistant/plans");
    await expect(stranger.getByText(nextSteps[0], { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(nextSteps[1], { exact: true })).toHaveCount(0);
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
      ], { stdio: "inherit" });
    }
    expect(await sql`SELECT id FROM assistant_plan_review WHERE plan_id IN ${sql(planIds)}`).toHaveLength(0);
    await sql.end();
  }
});
