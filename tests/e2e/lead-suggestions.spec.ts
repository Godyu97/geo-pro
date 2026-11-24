import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/reports/lead-suggestions";
const api = "/api/reports/lead-suggestions";
const headers = { Origin: origin };
const shots = ".cache/issue-135/lead-suggestions";
const brandName = `Synthetic-${"brand".repeat(14)}`;
const model = `fixture-${"model".repeat(22)}`;
const questions = [{ text: `WhichCriteria${"Matter".repeat(23)}?`, frozen: false }];
const copy = {
  "zh-CN": {
    title: "下轮问题建议", entry: "打开下轮问题建议", start: "填写线索汇总", review: "查看待处理草稿",
    empty: "还没有问题草稿。", draft: "草稿", accepted: "已接受", discarded: "已丢弃",
    unfrozen: "未冻结，不会写入题集。", brand: "去建档", reload: "重新载入",
  },
  en: {
    title: "Next-question drafts", entry: "Open next-question drafts", start: "Enter a lead summary", review: "Review a pending draft",
    empty: "No question drafts yet.", draft: "Draft", accepted: "Accepted", discarded: "Discarded",
    unfrozen: "Not frozen, and not written into the question set.", brand: "Open brand setup", reload: "Reload",
  },
} as const;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];

async function register(context: BrowserContext) {
  const email = `lead-suggestions-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Lead suggestions test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: keyof typeof copy, width: number, viaReports = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaReports ? "/dashboard/reports" : path);
  if (viaReports) await activate(page, page.getByRole("link", { name: copy[locale].entry, exact: true }));
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="reports"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375) await page.screenshot({ path: `${shots}/${shot}.png` });
}

async function startMock() {
  const calls: Array<{ method?: string; url?: string; payload: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({ method: request.method, url: request.url, payload: JSON.parse(Buffer.concat(chunks).toString()) });
    response.setHeader("Content-Type", "application/json");
    if (calls.length === 1) {
      response.writeHead(502).end(JSON.stringify({ error: { message: "Private mock failure" } }));
      return;
    }
    response.end(JSON.stringify({
      id: "resp_lead_suggestions_fixture",
      model,
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ questions }) }] }],
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Responses mock requires a loopback port");
  return { calls, server, port: address.port };
}

test("lead suggestions expose a keyboard action and keep decisions out of the question set", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  const outsider = await browser.newContext({ baseURL: origin });
  const mock = await startMock();
  const sql = postgres(databaseURL, { max: 1 });
  const accounts: Array<{ userId: string; email: string }> = [];
  let brandId: string | undefined;
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    await context.addCookies([{ name: "geo-lead-suggestions-mock-port", value: String(mock.port), url: origin }]);
    await outsider.addCookies([{ name: "geo-lead-suggestions-mock-port", value: String(mock.port), url: origin }]);
    const brand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "Synthetic brand for lead suggestion acceptance.",
          website: "https://suggestions.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const id: string = (await brand.json()).id;
    brandId = id;
    const list = async () => {
      const response = await context.request.get(`${api}?brandId=${id}`, { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).suggestions;
    };
    const baseline = await sql`
      select revision, (select count(*) from prompt_set where brand_id = ${id}) as sets,
             (select count(*) from monitoring_run where brand_id = ${id}) as runs,
             (select count(*) from quota_grant where brand_id = ${id}) as grants
      from brand where id = ${id}`;
    expect(baseline).toHaveLength(1);
    expect(await list()).toEqual([]);

    for (const locale of locales) {
      for (const width of widths) {
        const main = await visit(page, locale, width, locale === "zh-CN" && width === 375);
        await checkLayout(page, main.getByRole("link", { name: copy[locale].start, exact: true }), width, `empty-${locale}`);
        await expect(main.getByText(brandName, { exact: true })).toBeInViewport();
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
      }
    }

    const main = await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].start, exact: true }));
    const form = main.getByRole("form", { name: "起草建议" });
    const summary = form.getByRole("textbox", { name: "线索汇总" });
    const generate = form.getByRole("button", { name: "生成草稿", exact: true });
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAccessibleDescription(/不含手机号/);
    const invalid = "合成汇总误含邮箱 example@example.invalid";
    await summary.fill(invalid);
    await activate(page, generate);
    await expect(form.getByRole("alert")).toContainText("汇总无效");
    await expect(summary).toHaveValue(invalid);
    expect(await list()).toEqual([]);
    expect(mock.calls).toHaveLength(0);

    const input = "合成反馈显示采购团队关注长期安装与维护";
    await summary.fill(input);
    await activate(page, generate);
    await expect(form.getByRole("alert")).toContainText("暂时无法生成问题建议");
    await expect(summary).toHaveValue(input);
    await expect(generate).toBeFocused();
    expect(await list()).toEqual([]);
    await activate(page, generate);
    await expect(form.getByRole("status")).toHaveText("已保存草稿。这些建议尚未进入题集。");
    await expect(generate).toBeFocused();
    const [first] = await list();
    expect(first).toMatchObject({ status: "draft", questions, modelName: model });
    expect(first).not.toHaveProperty("summary");

    for (const locale of locales) {
      for (const width of widths) {
        const content = await visit(page, locale, width);
        const review = content.getByRole("link", { name: copy[locale].review, exact: true });
        await checkLayout(page, review, width, `draft-${locale}`);
        const card = content.getByRole("article", { name: copy[locale].draft, exact: true });
        await expect(card.getByText(questions[0].text, { exact: true })).toBeVisible();
        await expect(card.getByText(copy[locale].unfrozen, { exact: true })).toBeVisible();
        if (width === 375) {
          await activate(page, review);
          await expect(card.getByRole("heading", { name: copy[locale].draft })).toBeFocused();
          await page.screenshot({ path: `${shots}/review-${locale}.png` });
        }
      }
    }

    await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: copy["zh-CN"].review }));
    const firstCard = main.getByRole("article").filter({ has: page.locator(`#lead-suggestion-${first.id}`) });
    const accept = firstCard.getByRole("button", { name: "接受", exact: true });
    await expect(firstCard.getByRole("heading", { name: copy["zh-CN"].draft })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(accept).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(firstCard.getByRole("heading", { name: copy["zh-CN"].accepted })).toBeFocused();
    await expect(main.getByRole("link", { name: copy["zh-CN"].start })).toBeVisible();
    expect(await list()).toEqual([{ ...first, status: "accepted" }]);

    await summary.fill("合成反馈显示采购团队还想了解保养服务");
    await activate(page, generate);
    await expect(main.getByRole("link", { name: copy["zh-CN"].review })).toBeVisible();
    const secondCard = main.getByRole("article", { name: copy["zh-CN"].draft, exact: true });
    const [second] = (await list()).filter((suggestion: { status: string }) => suggestion.status === "draft");
    await activate(page, secondCard.getByRole("button", { name: "丢弃", exact: true }));
    await expect(main.getByRole("heading", { name: copy["zh-CN"].discarded })).toBeFocused();
    await expect(main.getByRole("link", { name: copy["zh-CN"].start })).toBeVisible();
    const settled = await list();
    expect(settled).toEqual(expect.arrayContaining([{ ...first, status: "accepted" }, { ...second, status: "discarded" }]));
    expect(settled).toHaveLength(2);
    const repeated = await context.request.post(`${api}/${first.id}`, { headers, data: { action: "discard" } });
    expect(repeated.status()).toBe(409);

    for (const locale of locales) {
      for (const width of widths) {
        const content = await visit(page, locale, width);
        await checkLayout(page, content.getByRole("link", { name: copy[locale].start }), width, `settled-${locale}`);
        await expect(content.getByRole("article", { name: copy[locale].accepted, exact: true })).toBeVisible();
        await expect(content.getByRole("article", { name: copy[locale].discarded, exact: true })).toBeVisible();
        await expect(content.getByText(copy[locale].unfrozen, { exact: true })).toHaveCount(2);
      }

      await context.addCookies([{ name: "geo-lead-suggestions-read", value: "unavailable", url: origin }]);
      const failed = await visit(page, locale, 375);
      await expect(failed.getByRole("alert")).toBeVisible();
      for (const value of [brandName, model, questions[0].text, copy[locale].empty, "Private lead suggestions fixture failure"]) {
        await expect(failed).not.toContainText(value);
      }
      await expect(failed.getByRole("form")).toHaveCount(0);
      const reload = failed.getByRole("link", { name: copy[locale].reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: "geo-lead-suggestions-read" });
      await activate(page, reload);
      await expect(main.getByRole("heading", { name: copy[locale].accepted })).toBeVisible();
    }

    await context.addCookies([{ name: "geo-lead-suggestions-read", value: "not-found", url: origin }]);
    await visit(page, "en", 375);
    await expect(main.getByRole("alert")).toContainText("was not found");
    await expect(main).not.toContainText(brandName);
    await expect(main.getByRole("form")).toHaveCount(0);
    await expect(main.getByRole("link", { name: copy.en.brand, exact: true })).toBeInViewport();
    await context.clearCookies({ name: "geo-lead-suggestions-read" });

    const stranger = await outsider.newPage();
    for (const locale of locales) {
      for (const width of widths) {
        const empty = await visit(stranger, locale, width);
        await expect(empty).not.toContainText(brandName);
        await expect(empty.getByRole("form")).toHaveCount(0);
        await checkLayout(stranger, empty.getByRole("link", { name: copy[locale].brand }), width, `no-brand-${locale}`);
      }
    }
    expect((await outsider.request.get(`${api}?brandId=${id}`, { headers })).status()).toBe(404);
    expect((await outsider.request.post(api, { headers, data: { brandId: id, summary: input } })).status()).toBe(404);
    expect((await outsider.request.post(`${api}/${first.id}`, { headers, data: { action: "discard" } })).status()).toBe(404);
    expect(await list()).toEqual(settled);
    expect(mock.calls).toHaveLength(3);
    for (const call of mock.calls) {
      expect(call).toMatchObject({ method: "POST", url: "/v1/responses", payload: { store: false } });
    }
    expect(await sql`
      select revision, (select count(*) from prompt_set where brand_id = ${id}) as sets,
             (select count(*) from monitoring_run where brand_id = ${id}) as runs,
             (select count(*) from quota_grant where brand_id = ${id}) as grants
      from brand where id = ${id}`).toEqual(baseline);
  } finally {
    await outsider.close();
    mock.server.close();
    try {
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${account.email}) as account,
                 exists (select 1 from brand where owner_id = ${account.userId}) as brand,
                 exists (select 1 from lead_question_suggestion where owner_id = ${account.userId}) as suggestion`;
        expect(remaining).toEqual({ account: false, brand: false, suggestion: false });
      }
      if (brandId) expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
