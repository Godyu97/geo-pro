import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/content/templates";
const api = "/api/content/templates";
const headers = { Origin: origin };
const shots = process.env.GEO_TEMPLATE_SCREENSHOTS;
const useSystemTemplate = process.env.GEO_TEMPLATE_TEST_SYSTEM === "1";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const copy = {
  "zh-CN": {
    title: "内容模板", setup: "前往品牌", browse: "浏览模板", list: "可用模板",
    empty: "还没有可查看的模板。", required: "事实、公开许可和审核门禁必须保持开启，没有新增模板。",
    name: "团队模板名称（可选）", clone: "克隆为团队模板", pending: "正在克隆…", draft: "草稿",
    fact: "事实门禁", success: "已克隆为团队草稿", readonly: "只读",
    export: "检查能否导出", factDenied: "不能编造客户案例", approvalDenied: "不能绕过审核门禁",
    loading: "正在加载模板…", unavailable: "模板暂时不能读取。请稍后重试。", retry: "重新载入",
  },
  en: {
    title: "Content templates", setup: "Go to brands", browse: "Browse templates", list: "Available templates",
    empty: "No templates to show yet.", required: "Fact, public-license, and review gates must stay on. No template was added.",
    name: "Team template name (optional)", clone: "Clone as team template", pending: "Cloning…", draft: "Draft",
    fact: "Fact gate", success: "Cloned as a team draft", readonly: "Read-only",
    export: "Check export", factDenied: "invented customer cases are blocked", approvalDenied: "the approval gate still blocks export",
    loading: "Loading templates…", unavailable: "Templates are temporarily unavailable. Try again later.", retry: "Reload",
  },
} as const;

async function register(context: BrowserContext) {
  const response = await registerTestAccount(context, {
    name: "Synthetic template tester", email: `template-visual-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  const { user }: { user: { id: string } } = await response.json();
  return user.id;
}

async function activate(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function layout(page: Page, control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function screenshot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

test(useSystemTemplate
  ? "system template navigation, cloning gates and failure recovery stay accessible"
  : "template entry, development catalog and failure recovery stay accessible", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Template browser tests require local PostgreSQL");
  }
  const sql = postgres(databaseURL, { max: 1 });
  if (useSystemTemplate && !/^\/geo_b08_[a-f0-9]{16}$/.test(new URL(databaseURL).pathname)) {
    await sql.end();
    throw new Error("System template fixtures require a temporary PostgreSQL database");
  }
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: string[] = [];
  const sourceId = randomUUID();
  const approvalSource = randomUUID();
  const sourceName = `合成模板-${"SyntheticTemplate".repeat(6)}`;
  const cloneName = "合成团队草稿 — Synthetic draft";
  const source = () => sql`select * from content_template where id = ${sourceId}`;
  let brandId: string | undefined;
  const main = page.getByRole("main");
  const card = (name: string) => main.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  async function visit(locale: (typeof locales)[number], width: number, target: string) {
    await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(target);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator('[data-workspace-section="content"]')).toBeVisible();
    await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  }
  async function verifyRecovery(target: string) {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const locale of locales) {
      const words = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-content-templates-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(target, { waitUntil: "commit" });
      await expect(main.getByRole("status")).toContainText(words.loading);
      await screenshot(page, `loading-${locale}-375`);
      await expect(main.getByRole("alert")).toHaveText(words.unavailable);
      await expect(main.getByRole("heading", { name: words.title, exact: true })).toBeVisible();
      await expect(main.getByRole("list")).toHaveCount(0);
      await expect(main.getByText("Private content templates fixture failure")).toHaveCount(0);
      const retry = main.getByRole("link", { name: words.retry });
      await expect(retry).toHaveAttribute("href", target);
      await layout(page, retry);
      await screenshot(page, `unavailable-${locale}-375`);
      await context.clearCookies({ name: "geo-content-templates-read" });
      await activate(page, retry);
      await expect(main.getByRole("heading", { level: 2, name: words.list })).toBeVisible();
      if (useSystemTemplate) await expect(card(cloneName)).toBeVisible();
    }
  }

  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    for (const locale of locales) {
      for (const width of widths) {
        await visit(locale, width, path);
        await layout(page, main.getByRole("link", { name: copy[locale].setup }));
        if (width === 375) await screenshot(page, `no-brand-${locale}-375`);
      }
    }

    const brand = await context.request.post("/api/brands", { headers, data: {
      action: "submit", actorId: owner, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: { name: "Synthetic content template brand", description: "Synthetic visual acceptance only.",
        website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
    } });
    expect(brand.status()).toBe(200);
    const { id }: { id: string } = await brand.json();
    brandId = id;
    const target = `${path}?brandId=${id}`;
    const catalog = `${api}?brandId=${id}`;
    const scope = `${api}/${sourceId}`;
    const packages = () => sql`select id from content_delivery_package where brand_id = ${id}`;
    const initial = await context.request.get(catalog, { headers });
    expect(initial.ok()).toBe(true);
    if ((await initial.json()).templates.length === 0) {
      for (const locale of locales) {
        for (const width of widths) {
          await visit(locale, width, target);
          await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
          await expect(main.getByRole("link", { name: copy[locale].browse })).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (width === 375) await screenshot(page, `empty-${locale}-375`);
        }
      }
    }

    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const other = await outsider.newPage();
    await other.goto(target);
    await expect(other.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(other.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(other.getByRole("button", { name: copy.en.clone })).toHaveCount(0);
    expect((await outsider.request.get(catalog, { headers })).status()).toBe(404);

    const zh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(`/dashboard/content?brandId=${id}`);
    await activate(page, main.getByRole("link", { name: zh.title, exact: true }));
    await expect(page).toHaveURL(origin + target);

    if (!useSystemTemplate) {
      await verifyRecovery(target);
      return;
    }

    const now = new Date().toISOString();
    await sql`insert into content_template (
      id, brand_id, owner_id, is_system, source_template_id, fact_gate, public_license_gate, review_gate,
      status, asks_to_invent_case_study, name, created_at, updated_at
    ) values
      (${sourceId}, null, null, 1, null, 1, 1, 1, 'published', 1, ${sourceName}, ${now}, ${now}),
      (${approvalSource}, null, null, 1, null, 1, 1, 1, 'published', 0, 'Synthetic approval gate', ${now}, ${now})`;
    const initialSource = await source();
    await page.reload();
    await screenshot(page, "entry-zh-CN-375");

    for (const locale of locales) {
      for (const width of widths) {
        const words = copy[locale];
        await visit(locale, width, target);
        const browse = main.getByRole("link", { name: words.browse });
        await layout(page, browse);
        await expect(card(sourceName).getByRole("button", { name: words.clone })).toBeVisible();
        await expect(card(sourceName).getByText(words.readonly, { exact: true })).toBeVisible();
        if (width === 375 || width === 1440) await screenshot(page, `ready-${locale}-${width}`);
        if (width === 375) {
          await activate(page, browse);
          await expect(main.getByRole("heading", { level: 2, name: words.list })).toBeFocused();
        }
      }
    }

    await visit("zh-CN", 375, target);
    const sourceCard = card(sourceName);
    const name = sourceCard.getByRole("textbox", { name: zh.name });
    const fact = sourceCard.getByRole("checkbox", { name: zh.fact });
    const clone = sourceCard.getByRole("button", { name: zh.clone });
    await name.fill(cloneName);
    await fact.focus();
    await page.keyboard.press("Space");
    await expect(fact).not.toBeChecked();
    await activate(page, clone);
    await expect(sourceCard.getByRole("alert")).toHaveText(zh.required);
    await expect(name).toHaveValue(cloneName);
    await expect(fact).not.toBeChecked();
    expect(await sql`select id from content_template where source_template_id = ${sourceId}`).toHaveLength(0);
    await screenshot(page, "gate-denied-zh-CN-375");

    const language = page.getByRole("combobox");
    await language.selectOption("en");
    await expect(sourceCard.getByRole("alert")).toHaveText(copy.en.required);
    await expect(sourceCard.getByRole("textbox", { name: copy.en.name })).toHaveValue(cloneName);
    await expect(sourceCard.getByRole("checkbox", { name: copy.en.fact })).not.toBeChecked();
    await language.selectOption("zh-CN");
    await expect(sourceCard.getByRole("alert")).toHaveText(zh.required);

    await fact.focus();
    await page.keyboard.press("Space");
    await expect(fact).toBeChecked();
    let submits = 0;
    await page.route((url) => url.pathname === path, async (route) => {
      if (route.request().method() === "POST") {
        submits += 1;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      await route.continue();
    });
    await activate(page, clone);
    const pending = sourceCard.getByRole("button", { name: zh.pending });
    await expect(pending).toBeFocused();
    await expect(pending).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await screenshot(page, "pending-zh-CN-375");
    await expect(sourceCard.getByRole("status")).toContainText(zh.success);
    await expect(card(cloneName).getByText(zh.draft, { exact: true })).toBeVisible();
    expect(submits).toBe(1);

    const clones = await sql`select id, owner_id, brand_id, status, fact_gate, public_license_gate, review_gate
      from content_template where source_template_id = ${sourceId}`;
    expect(clones).toHaveLength(1);
    expect(clones[0]).toMatchObject({ owner_id: owner, brand_id: id, status: "draft", fact_gate: 1, public_license_gate: 1, review_gate: 1 });
    const listing = await context.request.get(catalog, { headers });
    expect((await listing.json()).templates).toContainEqual(expect.objectContaining({
      id: clones[0].id, name: cloneName, sourceTemplateId: sourceId, status: "draft", asksToInventCaseStudy: true,
    }));
    const readOnly = await context.request.post(scope, { headers, data: {
      brandId: id, name: "Edit must fail", status: "retired", gates: { fact: true, publicLicense: true, review: true },
    } });
    expect(readOnly.status()).toBe(409);
    expect((await readOnly.json()).error.code).toBe("SYSTEM_READONLY");
    expect(await source()).toEqual(initialSource);

    for (const locale of locales) {
      const words = copy[locale];
      await visit(locale, 375, target);
      await activate(page, card(cloneName).getByRole("button", { name: words.export }));
      await expect(main.getByRole("alert")).toContainText(words.factDenied);
    }
    await visit("en", 375, target);
    await activate(page, card("Synthetic approval gate").getByRole("button", { name: copy.en.export }));
    await expect(main.getByRole("alert")).toContainText(copy.en.approvalDenied);
    expect(await packages()).toHaveLength(0);

    await other.reload();
    await expect(other.getByText(cloneName, { exact: true })).toHaveCount(0);
    await expect(other.getByRole("button", { name: copy.en.clone })).toHaveCount(0);
    expect((await outsider.request.get(catalog, { headers })).status()).toBe(404);
    expect((await outsider.request.post(`${scope}/clone`, { headers, data: {
      brandId: id, gates: { fact: true, publicLicense: true, review: true },
    } })).status()).toBe(404);

    await verifyRecovery(target);
  } finally {
    await outsider.close();
    try {
      if (brandId) {
        if (useSystemTemplate) await sql`delete from content_template where brand_id = ${brandId}`;
        await sql`delete from brand where id = ${brandId}`;
        expect(await sql`select id from content_template where brand_id = ${brandId}`).toHaveLength(0);
        expect(await sql`select id from brand where id = ${brandId}`).toHaveLength(0);
      }
      if (useSystemTemplate) {
        await sql`delete from content_template where id in (${sourceId}, ${approvalSource})`;
        expect(await sql`select id from content_template where id in (${sourceId}, ${approvalSource})`).toHaveLength(0);
      }
      for (const id of accounts) await sql`delete from "user" where id = ${id}`;
      if (accounts.length) {
        expect(await sql`select id from "user" where id in ${sql(accounts)}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
