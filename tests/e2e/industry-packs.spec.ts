import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const loadMessageFile = createRequire(import.meta.url);
const en: typeof import("../../src/lib/i18n/messages/en.json") = loadMessageFile("../../src/lib/i18n/messages/en.json");
const zh: typeof import("../../src/lib/i18n/messages/zh-CN.json") = loadMessageFile("../../src/lib/i18n/messages/zh-CN.json");

const origin = "http://localhost:3100";
const entry = "/dashboard/brands/industry-packs";
const scope = `合成安装范围${"IndustrialFixtureScope".repeat(15)}`;
const question = `安装前要预留多少空间？${"FixtureQuestion".repeat(16)}`;

async function register(context: BrowserContext) {
  const email = `industry-pack-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Industry pack fixture", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  const userId: string = (await response.json()).user.id;
  return { userId, email };
}

async function activate(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

test("industry packs guide setup, protect the registered scope and keep generated questions as drafts", async ({ page, context, browser }) => {
  test.setTimeout(100_000);
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Requires loopback PostgreSQL");
  const sql = postgres(url, { max: 1 });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  const guest = await browser.newContext({ baseURL: origin });
  let modelCalls = 0;
  let releaseModel = () => {};
  const answerReady = new Promise<void>((resolve) => { releaseModel = resolve; });
  const model = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    modelCalls += 1;
    request.resume();
    void answerReady.then(() => {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        id: "resp_fixture", status: "completed", output: [{ type: "message", content: [{ type: "output_text",
          text: JSON.stringify({ questions: [question, "保证排名。"] }),
        }] }],
      }));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  try {
    const address = model.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback port");
    const account = await register(context);
    accounts.push(account);
    await context.addCookies([{ name: "geo-industry-pack-mock-port", value: String(address.port), url: origin }]);
    const main = page.getByRole("main");
    const action = (name: string) => main.locator("header").getByRole("link", { name, exact: true });
    const show = async (locale: string, width: number) => {
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(entry);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(main).toHaveCount(1);
      await expect(page.locator("[data-workspace-section=brands]")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    };
    for (const [locale, t] of [["zh-CN", zh.industryPacks], ["en", en.industryPacks]] as const) {
      for (const width of [375, 768, 1440]) {
        await show(locale, width);
        await expect(main.getByRole("heading", { name: t.title })).toBeVisible();
        await expect(action(t.openBrands)).toBeInViewport();
        await expect(main.getByText(t.noBrands)).toBeVisible();
        if (width === 375) {
          await activate(page, action(t.openBrands));
          await expect(page).toHaveURL("/dashboard/brands");
        }
      }
    }

    const brand = await context.request.post("/api/brands", { headers: { Origin: origin }, data: {
      action: "submit", actorId: account.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: { name: "合成行业题包品牌", description: "合成安装资料", website: "https://industry-fixture.example.com",
        aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] },
    } });
    expect(brand.status()).toBe(200);
    const brandId: string = (await brand.json()).id;
    const t = zh.industryPacks;
    await show("zh-CN", 375);
    await expect(action(t.enterScope)).toBeInViewport();
    await activate(page, action(t.enterScope));
    const input = main.getByRole("textbox", { name: t.scope, exact: true });
    await expect(input).toBeFocused();
    await input.fill("   ");
    await activate(page, main.getByRole("button", { name: t.registerAction, exact: true }));
    await expect(main.getByRole("alert")).toHaveText(t.INVALID_INPUT);
    await expect(input).toHaveValue("   ");
    await input.fill(scope);
    await activate(page, main.getByRole("button", { name: t.registerAction, exact: true }));
    await expect(main.getByRole("status")).toHaveText(t.saved);
    await expect(main.getByText(t.scopeLine.replace("{scope}", scope))).toBeVisible();

    await main.getByRole("combobox", { name: t.scenario }).selectOption("regulated");
    const materials = main.getByRole("textbox", { name: t.materials });
    await materials.fill("合成安装资料");
    const draft = main.getByRole("button", { name: t.draftAction, exact: true });
    await activate(page, draft);
    await expect(main.getByRole("alert")).toHaveText(t.SCOPE_BLOCKED);
    await expect(materials).toHaveValue("合成安装资料");
    expect(modelCalls).toBe(0);
    await main.getByRole("combobox", { name: t.scenario }).selectOption("general");
    await activate(page, draft);
    const drafting = main.getByRole("button", { name: t.drafting, exact: true });
    await expect(drafting).toBeFocused();
    await expect(drafting).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => modelCalls).toBe(1);
    await page.keyboard.press("Enter");
    releaseModel();
    await expect(main.getByText(t.draftSaved, { exact: true })).toBeVisible();
    expect(modelCalls).toBe(1);
    await expect(main.getByText(question, { exact: true })).toBeVisible();
    await expect(main.getByText("保证排名。", { exact: true })).toHaveCount(0);

    for (const [locale, copy] of [["zh-CN", t], ["en", en.industryPacks]] as const) {
      for (const width of [375, 768, 1440]) {
        await show(locale, width);
        await expect(action(copy.viewPacks)).toBeInViewport();
        if (width === 375) {
          await activate(page, action(copy.viewPacks));
          await expect(main.getByRole("region", { name: copy.savedPacks })).toBeFocused();
        }
        await expect(main.getByText(copy.statusLine.replace("{status}", copy.statusDraft))).toBeVisible();
        await expect(main.getByText(question, { exact: true })).toBeVisible();
      }
    }

    expect(await sql`SELECT scope, covers_regulated, status FROM industry_pack WHERE owner_id = ${account.userId}`)
      .toEqual([{ scope, covers_regulated: 0, status: "draft" }]);
    expect(await sql`SELECT q.body, q.status FROM industry_pack_question q JOIN industry_pack p ON q.pack_id = p.id WHERE p.owner_id = ${account.userId}`)
      .toEqual([{ body: question, status: "draft" }]);
    expect(await sql`SELECT id FROM prompt_set WHERE brand_id = ${brandId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM monitoring_run WHERE brand_id = ${brandId}`).toHaveLength(0);

    accounts.push(await register(guest));
    await guest.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    const other = await guest.newPage();
    await other.goto(entry);
    await expect(other.getByText(en.industryPacks.noBrands)).toBeVisible();
    await expect(other.getByText(scope, { exact: false })).toHaveCount(0);
  } finally {
    releaseModel();
    await guest.close();
    for (const account of accounts) {
      execFileSync(process.execPath, ["--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account)]);
      expect(await sql`SELECT id FROM "user" WHERE id = ${account.userId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM industry_pack WHERE owner_id = ${account.userId}`).toHaveLength(0);
    }
    await sql.end();
    await new Promise<void>((resolve, reject) => model.close((error) => error ? reject(error) : resolve()));
  }
});
