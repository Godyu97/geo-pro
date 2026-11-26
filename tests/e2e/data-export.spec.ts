import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { initialBrandFields } from "../../src/features/brands/contracts";
import { expectTextContrast } from "./appearance-helpers";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const settings = "/dashboard/settings?source=workspace#data-management";
const name = "合成账户 É 🚀";
const fields = { ...initialBrandFields, name: "合成品牌 É 🚀", description: "用于浏览器验收的合成资料" };

const test = base.extend<{
  account: { id: string; email: string; invalidateBrand: (id: string) => Promise<void> };
}>({
  account: async ({ context }, provide) => {
    const url = URL.parse(process.env.DATABASE_URL ?? "");
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Export tests require local PostgreSQL");
    const sql = postgres(url.href, { max: 1 });
    const email = `b05-${randomUUID()}@example.invalid`;
    try {
      const response = await registerTestAccount(context, { name, email, password: randomBytes(24).toString("base64url") });
      expect(response.status()).toBe(200);
      const { user } = await response.json();
      await provide({
        id: user.id, email,
        async invalidateBrand(id) {
          await sql`update brand_version set content = '{' where brand_id = ${id}
            and exists (select 1 from brand where id = ${id} and owner_id = ${user.id})`;
        },
      });
    } finally {
      await sql`delete from "user" where email = ${email}`;
      await sql.end();
    }
  },
});

const copy = {
  "zh-CN": {
    management: "数据管理", language: "界面语言", profile: "个人资料", brands: "品牌数据",
    brandScope: "你的活跃及归档品牌、已保存版本和草稿。",
    facts: "事实与材料", monitoring: "监测与证据", content: "内容", reports: "报告", usage: "用量与费用",
    prepare: "生成导出文件", preparing: "正在生成导出文件…", download: "下载 JSON", empty: "尚未生成导出文件",
    ready: "导出文件已就绪", partial: "导出部分完成", failed: "导出文件生成失败",
    missing: "未能生成品牌数据。", fileUnavailable: "此下载已不可用。请重新生成导出文件。",
    unavailable: "导出暂时不可用。请刷新查看最近一次生成状态。", filename: /GeoPro-个人数据-\d{4}-\d{2}-\d{2}\.json/,
  },
  en: {
    management: "Data management", language: "Interface language", profile: "Personal profile", brands: "Brand data",
    brandScope: "Your active and archived brand profiles, saved versions and drafts.",
    facts: "Facts and materials", monitoring: "Monitoring and evidence", content: "Content", reports: "Reports", usage: "Usage and costs",
    prepare: "Prepare export", preparing: "Preparing your export…", download: "Download JSON", empty: "No export prepared yet",
    ready: "Export ready", partial: "Export partially ready", failed: "Export could not be prepared",
    missing: "Could not include Brand data.", fileUnavailable: "This download is unavailable. Prepare a new export.",
    unavailable: "Data export is temporarily unavailable. Refresh to check the latest status.", filename: /GeoPro-personal-data-\d{4}-\d{2}-\d{2}\.json/,
  },
} as const;

async function seedBrand(context: BrowserContext, actorId: string) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: baseURL },
    data: { actorId, operationId: randomUUID(), action: "submit", target: null, expectedDraft: null, fields, acceptedPolicyVersion: publishedRetentionVersion() },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

async function fileFromBrowser(page: Page, label: string, filename: RegExp) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(filename);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(await file.path())));
}

for (const locale of ["zh-CN", "en"] as const) {
  const current = copy[locale];
  const otherLocale = locale === "en" ? "zh-CN" : "en";
  const translated = copy[otherLocale];

  for (const width of [375, 768, 1440]) {
    test(`${locale}: keyboard, scope and export language at ${width}px`, async ({ page, context, account }) => {
      const brandId = await seedBrand(context, account.id);
      await page.setViewportSize({ width, height: 900 });
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      const pageErrors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/api/data-exports")) writes.push(request.url());
      });
      await page.goto(settings);
      const region = page.getByRole("region", { name: current.management, exact: true });
      const status = region.getByRole("status");
      await expect(status).toHaveText(current.empty);
      const profile = region.getByRole("checkbox", { name: current.profile, exact: true });
      const brands = region.getByRole("checkbox", { name: current.brands, exact: true });
      await expect(profile).toBeChecked();
      await expect(brands).toHaveAccessibleDescription(current.brandScope);
      for (const label of [current.facts, current.monitoring, current.content, current.reports, current.usage]) {
        await expect(region.getByRole("checkbox", { name: label, exact: true })).toBeEnabled();
      }
      await profile.focus();
      await page.keyboard.press("Space");
      await expect(region.getByRole("button", { name: current.prepare })).toBeDisabled();
      await page.keyboard.press("Tab");
      await expect(brands).toBeFocused();
      await expect(brands).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Space");

      await page.getByRole("combobox", { name: current.language, exact: true }).selectOption(otherLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", otherLocale);
      const switched = page.getByRole("region", { name: translated.management, exact: true });
      await expect(switched.getByRole("checkbox", { name: translated.brands })).toBeChecked();
      await expect(switched.getByRole("checkbox", { name: translated.profile })).not.toBeChecked();
      await expect(page).toHaveURL(baseURL + settings);
      expect(writes).toHaveLength(0);

      await page.getByRole("combobox", { name: translated.language, exact: true }).selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      let release = () => {};
      const paused = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/data-exports", async (route) => {
        await paused;
        await route.continue();
      }, { times: 1 });
      const prepare = region.getByRole("button", { name: current.prepare, exact: true });
      await prepare.focus();
      await page.keyboard.press("Enter");
      try { await expect(status).toHaveText(current.preparing); }
      finally { release(); }
      await expect(status).toContainText(current.ready);
      await expect(prepare).toBeFocused();
      expect(writes).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectTextContrast(page);

      await page.getByRole("combobox", { name: current.language, exact: true }).selectOption(otherLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", otherLocale);
      const file = await fileFromBrowser(page, translated.download, current.filename);
      expect(file).toMatchObject({ locale, status: "ready", requested: ["brands"], included: ["brands"], missing: [], unavailable: [] });
      expect(file.data).toEqual({ brands: { versions: [expect.objectContaining({ id: brandId, fields })], drafts: [] } });
      await page.reload();
      await expect(switched.getByRole("status")).toContainText(translated.ready);
      expect(writes).toHaveLength(1);
      expect(pageErrors).toEqual([]);
    });
  }

  test(`${locale}: partial, failed and unavailable downloads explain what to do`, async ({ page, context, account }) => {
    const brandId = await seedBrand(context, account.id);
    await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
    await page.goto(settings);
    const region = page.getByRole("region", { name: current.management, exact: true });
    await region.getByRole("checkbox", { name: current.brands }).check();
    const prepare = region.getByRole("button", { name: current.prepare });
    await page.route("**/api/data-exports", (route) => route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } } }), { times: 1 });
    await prepare.click();
    await expect(region.getByRole("alert")).toHaveText(current.unavailable);
    await expect(region.getByRole("checkbox", { name: current.brands })).toBeChecked();

    await account.invalidateBrand(brandId);
    await prepare.click();
    const status = region.getByRole("status");
    await expect(status).toContainText(current.partial);
    await expect(status).toContainText(current.missing);
    const file = await fileFromBrowser(page, current.download, current.filename);
    expect(file).toMatchObject({ status: "partial", missing: ["brands"], data: { profile: { name, email: account.email } } });
    expect(file.data.brands).toBeUndefined();

    const update = await context.request.post("/api/auth/update-user", {
      headers: { Origin: baseURL }, data: { name: "Edited synthetic profile" },
    });
    expect(update.status()).toBe(200);
    await region.getByRole("button", { name: current.download }).click();
    await expect(region.getByRole("alert")).toHaveText(current.fileUnavailable);

    await region.getByRole("checkbox", { name: current.profile }).uncheck();
    await prepare.click();
    await expect(status).toContainText(current.failed);
    await expect(region.getByRole("button", { name: current.download })).toHaveCount(0);
  });
}
