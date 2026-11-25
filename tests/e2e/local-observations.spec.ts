import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const entryPath = "/dashboard/brands/local-observations";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440] as const;
const brandName = `合成观察品牌-${"LongBrand_".repeat(6)}end`;
const longCity = `合成目标城市-${"LongCity_".repeat(6)}end`;
const askedCity = "杭州";

const copy = {
  "zh-CN": {
    brandsNav: "品牌资料",
    brandsEntry: "登记本地观察",
    title: "本地观察",
    noBrand: "还没有活跃品牌。下一步是先建立品牌，再登记本地观察。",
    openBrand: "去建档",
    emptyTask: "还没有本地观察。下一步是填写目标城市。实际采样位置可以留空。",
    savedTask: "已有本地观察。下一步是查看目标城市和实际采样位置。",
    fill: "填写观察",
    view: "查看观察",
    related: "相关入口",
    target: "目标城市",
    sampled: "实际采样城市",
    save: "保存观察",
    saving: "正在保存…",
    saved: "已保存这条本地观察。采样位置未知时不会写成排名。",
    invalid: "请检查品牌和城市。要求排名或本地用户真实结果的请求不会保存。",
    listTitle: "已保存观察",
    unknownLine: "实际采样位置 未知",
    unranked: "未排名，不是本地用户的真实结果。",
    loading: "正在加载本地观察…",
    unavailable: "本地观察暂时不可用，请稍后重试。",
    reload: "重新载入",
    privateFailure: "Private local observations fixture failure",
    rankingClaim: "杭州用户真实排名",
  },
  en: {
    brandsNav: "Brand information",
    brandsEntry: "Record a local observation",
    title: "Local observations",
    noBrand: "No active brand yet. The next step is to set up a brand before recording a local observation.",
    openBrand: "Open brands",
    emptyTask: "No local observation yet. The next step is to enter the target city. The sampled place can stay empty.",
    savedTask: "A local observation is saved. The next step is to check the target city and the sampled place.",
    fill: "Enter an observation",
    view: "View observations",
    related: "Related entries",
    target: "Target city",
    sampled: "Sampled city",
    save: "Save observation",
    saving: "Saving…",
    saved: "Saved this local observation. An unknown sampled place is not written as a ranking.",
    invalid: "Check the brand and cities. A request for a ranking or a real local-user result is not saved.",
    listTitle: "Saved observations",
    unknownLine: "Sampled place Unknown",
    unranked: "Unranked. This is not a real result from local users.",
    loading: "Loading local observations…",
    unavailable: "Local observations are temporarily unavailable. Try again shortly.",
    reload: "Reload",
    privateFailure: "Private local observations fixture failure",
    rankingClaim: "Hangzhou users' real ranking",
  },
} as const;

function targetLine(locale: "zh-CN" | "en", city: string) {
  return locale === "zh-CN" ? `目标城市 ${city}` : `Target city ${city}`;
}

function openTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Browser flow tests require local PostgreSQL");
  }
  return postgres(url, { max: 1 });
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Local observations visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
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

test("local observations keep the next action, unknown place, isolation, and read recovery", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const screenshotDir = process.env.GEO_LOCAL_OBSERVATION_SCREENSHOTS || ".cache/issue-135/local-observations";
  const ownerEmail = `local-observations-${randomUUID()}@example.invalid`;
  const outsiderEmail = `local-observations-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  const sql = openTestDatabase();
  let ownerId = "";
  let brandId = "";

  try {
    ownerId = await register(context, ownerEmail);
    accounts.push({ userId: ownerId, email: ownerEmail });
    accounts.push({
      userId: await register(outsider, outsiderEmail),
      email: outsiderEmail,
    });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/brands");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].brandsEntry, exact: true }));
    await expect(page).toHaveURL(entryPath);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=brands]")).toContainText(t.brandsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.noBrand, { exact: true })).toBeVisible();
        const openBrand = main.getByRole("link", { name: t.openBrand, exact: true });
        await expect(openBrand).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expect(main.getByLabel(t.target)).toHaveCount(0);
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(openBrand).toBeInViewport();
          await capture(page, screenshotDir, `nobrand-${locale}-375.png`);
        }
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: copy["zh-CN"].openBrand, exact: true }));
    await expect(page).toHaveURL("/dashboard/brands");

    const createdBrand = await context.request.post("/api/brands", {
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
          description: "合成本地观察视觉验收资料。",
          website: "https://local-observations.example.com/guide",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(createdBrand.status()).toBe(200);
    brandId = (await createdBrand.json()).id as string;

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        if (locale === "zh-CN" && width === 375) {
          await page.goto("/dashboard/brands");
          await activateFromKeyboard(page, page.getByRole("main").getByRole("link", { name: t.brandsEntry, exact: true }));
          await expect(page).toHaveURL(entryPath);
        } else {
          await page.goto(entryPath);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(page.locator("[data-workspace-section=brands]")).toContainText(t.brandsNav);
        await expect(main.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
        await expect(main.getByText(t.emptyTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true })).toHaveCount(1);
        await expect(main.getByText(t.noBrand, { exact: true })).toHaveCount(0);
        const fill = main.getByRole("link", { name: t.fill, exact: true });
        await expect(fill).toBeVisible();
        await expect(main.getByRole("navigation", { name: t.related })).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(fill).toBeInViewport();
          await capture(page, screenshotDir, `empty-${locale}-375.png`);
          await activateFromKeyboard(page, fill);
          await expect(page.locator("#local-observation-target")).toBeFocused();
        }
      }
    }

    const tZh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    const saveForm = page.locator("#local-observation-form");
    await saveForm.getByLabel(tZh.target, { exact: true }).fill("   ");
    await saveForm.getByLabel(tZh.sampled, { exact: true }).fill("保留这段采样");
    let rejectedPosts = 0;
    const countRejected = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/brands/local-observations") {
        rejectedPosts += 1;
      }
    };
    page.on("request", countRejected);
    await saveForm.getByRole("button", { name: tZh.save, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(tZh.invalid);
    await expect(saveForm.getByLabel(tZh.target, { exact: true })).toHaveValue("   ");
    await expect(saveForm.getByLabel(tZh.sampled, { exact: true })).toHaveValue("保留这段采样");
    expect(rejectedPosts).toBe(0);
    page.off("request", countRejected);

    const createdObservation = await context.request.post("/api/brands/local-observations", {
      headers,
      data: { brandId, targetCity: longCity, sampledCity: null },
    });
    expect(createdObservation.status()).toBe(200);

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(entryPath);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(t.savedTask, { exact: true })).toBeVisible();
        await expect(main.getByText(brandName, { exact: true }).first()).toBeVisible();
        await expect(main.getByRole("heading", { level: 2, name: t.listTitle, exact: true })).toBeVisible();
        await expect(main.getByText(targetLine(locale, longCity), { exact: true })).toBeVisible();
        await expect(main.getByText(t.unknownLine, { exact: true })).toBeVisible();
        await expect(main.getByText(t.unranked, { exact: true })).toBeVisible();
        await expect(main.getByText(t.rankingClaim, { exact: true })).toHaveCount(0);
        const view = main.getByRole("link", { name: t.view, exact: true });
        await expect(view).toBeVisible();
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(view).toBeInViewport();
          await capture(page, screenshotDir, `populated-${locale}-375.png`);
          await activateFromKeyboard(page, view);
          await expect(page.locator("#main-content #local-observation-list")).toBeFocused();
        }
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "zh-CN", url: origin },
      { name: "geo-local-observations-write", value: "slow", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    const slowSave = page.locator("#local-observation-form");
    await slowSave.getByLabel(tZh.target, { exact: true }).fill(askedCity);
    await slowSave.getByLabel(tZh.sampled, { exact: true }).fill("");
    let slowPosts = 0;
    const countSlow = (request: { method: () => string; url: () => string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/brands/local-observations") {
        slowPosts += 1;
      }
    };
    page.on("request", countSlow);
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/brands/local-observations" && response.request().method() === "POST"
    ));
    const saveButton = slowSave.getByRole("button", { name: tZh.save, exact: true });
    await saveButton.focus();
    await page.keyboard.press("Enter");
    const saving = slowSave.getByRole("button", { name: tZh.saving, exact: true });
    await expect(saving).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("main").getByText(tZh.saved, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(targetLine("zh-CN", askedCity), { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(tZh.unknownLine, { exact: true })).toHaveCount(2);
    await expect(page.getByRole("main").getByText(tZh.rankingClaim, { exact: true })).toHaveCount(0);
    await expect(slowSave.getByLabel(tZh.target, { exact: true })).toHaveValue("");
    expect(slowPosts).toBe(1);
    page.off("request", countSlow);
    const stored = await sql`
      SELECT target_city, sampled_city, ranked, claimed_local_users
      FROM local_observation
      WHERE brand_id = ${brandId}
      ORDER BY target_city ASC
    `;
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row.sampled_city).toBeNull();
      expect(Number(row.ranked)).toBe(0);
      expect(Number(row.claimed_local_users)).toBe(0);
    }
    expect(stored.map((row) => row.target_city).sort()).toEqual([askedCity, longCity].sort());
    await context.clearCookies({ name: "geo-local-observations-write" });

    await context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(entryPath);
    await expect(page.getByRole("main").getByText(targetLine("en", askedCity), { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(copy.en.unknownLine, { exact: true })).toHaveCount(2);
    await expect(page.getByRole("main").getByText(copy.en.unranked, { exact: true })).toHaveCount(2);
    await expect(page.getByRole("main").getByText(copy.en.rankingClaim, { exact: true })).toHaveCount(0);
    await expectNoOverflow(page);

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(entryPath);
    await expect(stranger.getByRole("main").getByText(copy.en.noBrand, { exact: true })).toBeVisible();
    await expect(stranger.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(stranger.getByText(longCity)).toHaveCount(0);
    await expect(stranger.getByText(askedCity)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.close();

    for (const locale of locales) {
      const t = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-local-observations-read", value: "slow-unavailable", url: origin },
      ]);
      await page.setViewportSize({ width: 375, height: 800 });
      const nav = page.goto(entryPath, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("status", { name: t.loading })).toBeVisible();
      await capture(page, screenshotDir, `loading-${locale}-375.png`);
      await nav;
      const failed = page.getByRole("main");
      await expect(failed.getByRole("heading", { level: 1, name: t.title, exact: true })).toBeVisible();
      await expect(failed.getByRole("alert")).toContainText(t.unavailable);
      await expect(failed.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(failed.getByText(longCity)).toHaveCount(0);
      await expect(failed.getByText(askedCity)).toHaveCount(0);
      await expect(failed.getByText(t.privateFailure)).toHaveCount(0);
      await expect(failed.getByLabel(t.target)).toHaveCount(0);
      const reload = failed.getByRole("link", { name: t.reload, exact: true });
      await expect(reload).toBeInViewport();
      await expectNoOverflow(page);
      await capture(page, screenshotDir, `unavailable-${locale}-375.png`);
      await context.clearCookies({ name: "geo-local-observations-read" });
      await activateFromKeyboard(page, reload);
      await expect(page.getByRole("main").getByText(brandName, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("main").getByText(targetLine(locale, askedCity), { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(targetLine(locale, longCity), { exact: true })).toBeVisible();
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
      expect(await sql`SELECT id FROM local_observation WHERE owner_id = ${ownerId}`).toHaveLength(0);
    }
    await sql.end();
  }
});
