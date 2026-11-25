import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";

const origin = "http://localhost:3100";
const maintenance = "/dashboard/maintenance";
const path = `${maintenance}/support`;
const api = "/api/maintenance/support";
const shots = ".cache/issue-135/support";
const execute = promisify(execFile);
const locales = ["zh-CN", "en"] as const;
const copy = {
  "zh-CN": {
    title: "支持定位", open: "打开支持定位", operation: "操作编号", lookup: "定位",
    results: "定位结果", deletion: "品牌删除", frozen: "已冻结",
    empty: "没有找到该操作编号对应的支持元信息。", invalid: "操作编号无效",
    unavailable: "暂时无法定位该操作", loading: "正在定位支持信息…",
    retry: "重新定位", back: "返回维护权限", denied: "当前账号没有支持元信息权限",
  },
  en: {
    title: "Support lookup", open: "Open support lookup", operation: "Operation id", lookup: "Look up",
    results: "Lookup result", deletion: "Brand deletion", frozen: "Frozen",
    empty: "No support metadata was found for this operation id.", invalid: "The operation id is invalid",
    unavailable: "This operation cannot be located right now", loading: "Locating support metadata…",
    retry: "Retry lookup", back: "Back to maintenance access", denied: "This account does not have support metadata access",
  },
};

const test = base.extend<{ support: { id: string; change: (action: "grant" | "revoke") => Promise<void> } }>({
  support: async ({ context, browser }, provide) => {
    const url = process.env.DATABASE_URL;
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
      throw new Error("Support browser tests require local PostgreSQL");
    }
    const sql = postgres(url, { max: 1 });
    const operatorContext = await browser.newContext({ baseURL: origin });
    const users: string[] = [];
    const id = `support-${randomBytes(60).toString("hex")}`;
    async function register(target: BrowserContext) {
      const response = await registerTestAccount(target, {
        name: "Synthetic support tester", email: `support-${randomUUID()}@example.invalid`,
        password: randomBytes(24).toString("base64url"),
      });
      expect(response.status()).toBe(200);
      const userId: string = (await response.json()).user.id;
      users.push(userId);
      return userId;
    }
    try {
      const operatorId = await register(operatorContext);
      const maintainerId = await register(context);
      const now = Date.now();
      const frozenAt = new Date(now).toISOString();
      const restoreUntil = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      await sql`insert into brand (id, owner_id, status, revision, entity_version, created_at, frozen_at, restore_until)
        values (${id}, ${operatorId}, 'active', 2, 1, ${frozenAt}, ${frozenAt}, ${restoreUntil})`;
      await provide({ id, change: async (action) => {
        const { stdout } = await execute(process.execPath, [
          "--conditions=react-server", "scripts/maintenance-access.mjs", action,
          operatorId, maintainerId, "support.read", action === "grant" ? "initial-setup" : "offboarding",
        ]);
        expect(JSON.parse(stdout).status).toBe("allowed");
      } });
    } finally {
      try {
        if (users.length) {
          await sql`delete from brand where id = ${id} and owner_id in ${sql(users)}`;
          await sql`delete from maintenance_grant where user_id in ${sql(users)}`;
          await sql`delete from maintenance_audit where actor_id in ${sql(users)} or subject_id in ${sql(users)}`;
          await sql`delete from "user" where id in ${sql(users)}`;
          expect(await sql`select id from "user" where id in ${sql(users)}`).toHaveLength(0);
          expect(await sql`select id from brand where id = ${id}`).toHaveLength(0);
          expect(await sql`select user_id from maintenance_grant where user_id in ${sql(users)}`).toHaveLength(0);
          expect(await sql`select id from maintenance_audit where actor_id in ${sql(users)} or subject_id in ${sql(users)}`).toHaveLength(0);
        }
      } finally {
        await operatorContext.close();
        await sql.end();
      }
    }
  },
});

async function keyboardActivate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("support lookup can be retried at the same operation id", async ({ page, context, support }) => {
  test.setTimeout(60_000);
  await support.change("grant");
  const target = `${path}?operationId=${support.id}`;
  for (const locale of locales) {
    const messages = copy[locale];
    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([
      { name: "geo-locale", value: locale, url: origin },
      { name: "geo-support-read", value: "slow-unavailable", url: origin },
    ]);
    await page.goto(target, { waitUntil: "commit" });
    const main = page.getByRole("main");
    await expect(main.getByRole("status", { name: messages.loading })).toBeVisible();
    await page.screenshot({ path: `${shots}/loading-${locale}.png` });
    const alert = main.getByRole("alert");
    await expect(alert).toContainText(messages.unavailable);
    await expect(main.getByRole("heading", { name: messages.title })).toBeVisible();
    await expect(main.getByText("Private support fixture failure")).toHaveCount(0);
    await expect(main.getByRole("heading", { name: messages.deletion })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/unavailable-${locale}.png` });
    const retry = main.getByRole("link", { name: messages.retry });
    await expect(retry).toBeInViewport({ ratio: 1, timeout: 2500 });
    await expect(retry).toHaveAttribute("href", target);
    await context.clearCookies({ name: "geo-support-read" });
    await keyboardActivate(page, retry);
    await expect(page).toHaveURL(origin + target);
    await expect(main.getByRole("heading", { name: messages.deletion })).toBeVisible();
    await expect(main.getByRole("textbox", { name: messages.operation })).toHaveValue(support.id);
  }
});

test("support lookup keeps roles, results and keyboard actions clear at each viewport", async ({ page, context, support }) => {
  test.setTimeout(90_000);
  await support.change("grant");
  const target = `${path}?operationId=${support.id}`;
  const apiTarget = `${api}?operationId=${support.id}`;

  for (const locale of locales) {
    const messages = copy[locale];
    await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
    await page.goto(maintenance);
    const main = page.getByRole("main");
    await keyboardActivate(page, main.getByRole("link", { name: messages.open }));
    await expect(page).toHaveURL(origin + path);
    await expect(main.getByRole("heading", { level: 1, name: messages.title })).toBeVisible();

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(new RegExp(messages.title));
      await expect(page.locator('[data-workspace-section="maintenance"]')).toBeVisible();
      await expect(main).toHaveCount(1);
      const input = main.getByRole("textbox", { name: messages.operation });
      const submit = main.getByRole("button", { name: messages.lookup });
      await expect(input).toBeInViewport({ ratio: 1 });
      await expect(submit).toBeInViewport({ ratio: 1 });
      await noOverflow(page);
      if (width === 375) {
        await input.fill("invalid id");
        await input.press("Enter");
        expect(await input.evaluate((field: HTMLInputElement) => field.validity.patternMismatch)).toBe(true);
        await expect(page).toHaveURL(origin + path);
      }
      await input.fill(support.id);
      await input.focus();
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
      expect(await submit.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      if (width === 375) await page.screenshot({ path: `${shots}/focus-${locale}.png` });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(origin + target);
      const results = main.getByRole("region", { name: messages.results });
      await expect(results.getByRole("heading", { name: messages.deletion })).toBeVisible();
      await expect(results.getByText(messages.frozen, { exact: true })).toBeVisible();
      await expect(results.getByText(support.id, { exact: true })).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `${shots}/result-${locale}-${width}.png`, fullPage: true });
    }

    const response = await context.request.get(apiTarget);
    expect(response.status()).toBe(200);
    const { matches, cache, traceId } = await response.json();
    expect(matches).toEqual([{
      kind: "brand-deletion", subjectId: support.id, status: "frozen",
      failure: "deletion-frozen", reconciliation: "clear",
      remaining: ["contents", "exports", "objects", "costs"],
      recovery: "owner.recover",
    }]);
    expect(["origin", "hit"]).toContain(cache);
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);

    await page.setViewportSize({ width: 375, height: 800 });
    const alternate = locale === "zh-CN" ? "en" : "zh-CN";
    const language = page.getByRole("combobox").first();
    await language.selectOption(alternate);
    await expect(page.locator("html")).toHaveAttribute("lang", alternate);
    await expect(page).toHaveURL(origin + target);
    await expect(main.getByRole("heading", { name: copy[alternate].deletion })).toBeVisible();
    await language.selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.goto(`${path}?operationId=${randomUUID()}`);
    await expect(main.getByRole("region", { name: messages.results })).toContainText(messages.empty);
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/empty-${locale}.png` });
    await page.goto(`${path}?operationId=%20`);
    await expect(main.getByRole("alert")).toContainText(messages.invalid);
    await expect(main.getByRole("textbox", { name: messages.operation })).toHaveValue("");
    expect((await context.request.get(`${api}?operationId=%20`)).status()).toBe(400);

    await context.addCookies([{ name: "geo-maintenance-unavailable", value: "1", url: origin }]);
    await page.goto(target);
    await expect(main.getByRole("alert")).toContainText(messages.unavailable);
    await expect(main.getByRole("textbox", { name: messages.operation })).toHaveCount(0);
    const retry = main.getByRole("link", { name: messages.retry });
    await expect(retry).toHaveAttribute("href", target);
    await context.clearCookies({ name: "geo-maintenance-unavailable" });
    await keyboardActivate(page, retry);
    await expect(main.getByRole("heading", { name: messages.deletion })).toBeVisible();

    await support.change("revoke");
    await page.reload();
    await expect(main.getByRole("status")).toContainText(messages.denied);
    await expect(main.getByRole("textbox", { name: messages.operation })).toHaveCount(0);
    await expect(main.getByRole("region", { name: messages.results })).toHaveCount(0);
    expect((await context.request.get(apiTarget)).status()).toBe(403);
    const back = main.getByRole("link", { name: messages.back });
    await expect(back).toBeInViewport({ ratio: 1 });
    await noOverflow(page);
    await page.screenshot({ path: `${shots}/denied-${locale}.png` });
    await keyboardActivate(page, back);
    await expect(page).toHaveURL(origin + maintenance);
    if (locale === "zh-CN") await support.change("grant");
  }
});
