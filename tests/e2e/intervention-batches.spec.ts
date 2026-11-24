import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import type { InterventionBatchView } from "../../src/features/formal-retest/intervention-commands";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const href = "/dashboard/reports/interventions";
const shots = ".cache/issue-135/intervention-batches";
const brandName = "合成干预品牌";
const pages = [`https://intervention.example.com/${"x".repeat(240)}`, "second-page", "third-page"];
const times = ["2026-11-02T12:00:00.000Z", "2026-11-06T13:00:00.000Z", "2026-11-04T14:00:00.000Z"];
const latestTime = times[1];
const copy = {
  "zh-CN": {
    title: "干预批次",
    create: "保存批次",
    empty: "还没有干预批次。先保存批次，再登记要核验的页面。",
    register: "登记或更新页面",
    pending: "未生效",
    pendingLine: "生效点为空。",
    unverified: "尚未核验",
    review: "查看页面核验",
    effective: "已生效",
    effectiveLine: `生效点 ${latestTime}`,
    save: "保存核验",
    invalid: "批次或页面核验无效。请检查页面键和 UTC 核验时间。",
    openBrand: "去建档",
  },
  en: {
    title: "Intervention batches",
    create: "Save batch",
    empty: "There are no intervention batches yet. Save a batch, then record the pages to verify.",
    register: "Record or update a page",
    pending: "Not effective",
    pendingLine: "The effective point is empty.",
    unverified: "Not verified yet",
    review: "Review page verification",
    effective: "Effective",
    effectiveLine: `Effective point ${latestTime}`,
    save: "Save verification",
    invalid: "The batch or page verification is invalid. Check the page key and the UTC verification time.",
    openBrand: "Open brand setup",
  },
} as const;

async function register(context: BrowserContext) {
  const email = `intervention-batches-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Intervention batch visual test", email, password: randomBytes(24).toString("base64url"),
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

async function visit(page: Page, locale: keyof typeof copy, width: number) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(href);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="reports"]')).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
}

async function checkLayout(page: Page, primary: Locator, width: number, shot: string) {
  await expect(primary).toHaveCount(1);
  await expect(primary).toBeInViewport();
  expect((await primary.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375) await page.screenshot({ path: `${shots}/${shot}.png` });
}

async function readBatch(context: BrowserContext, batchId: string) {
  const response = await context.request.get(`/api/reports/interventions/${batchId}`, { headers: { Origin: origin } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { batch: InterventionBatchView }).batch;
}

async function savePage(page: Page, key: string, time = "") {
  const main = page.getByRole("main");
  await page.locator("input[name='pageKey']").fill(key);
  await page.locator("input[name='verifiedAt']").fill(time);
  await activate(page, main.getByRole("button", { name: copy["zh-CN"].save, exact: true }));
  await expect(page.locator("input[name='pageKey']")).toHaveValue("");
  await expect(page.locator("input[name='verifiedAt']")).toHaveValue("");
}

test("intervention batches show the next action and keep the verified effective point", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(12_000);
  mkdirSync(shots, { recursive: true });
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Array<{ userId: string; email: string }> = [];
  let brandId: string | undefined;
  const main = page.getByRole("main");
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    const brand = await context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "仅用于干预批次隔离验收的合成品牌。",
          website: "https://intervention.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    brandId = (await brand.json()).id as string;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        await visit(page, locale, width);
        const current = copy[locale];
        await expect(main.getByText(current.empty, { exact: true })).toBeVisible({ timeout: 3000 });
        await checkLayout(page, main.getByRole("button", { name: current.create, exact: true }), width, `empty-${locale}-375`);
      }
    }

    await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("button", { name: copy["zh-CN"].create, exact: true }));
    await expect(main.getByText(copy["zh-CN"].pendingLine, { exact: true })).toBeVisible();
    const batchId = await page.locator("input[name='batchId']").inputValue();
    const emptyBatch = await readBatch(context, batchId);
    expect(emptyBatch).toMatchObject({ status: "pending", effectiveAt: null, pages: [] });
    const registerLink = main.getByRole("link", { name: copy["zh-CN"].register, exact: true });
    await activate(page, registerLink);
    await expect(page.locator("input[name='pageKey']")).toBeFocused();

    for (const key of pages) await savePage(page, key);
    await savePage(page, pages[0], times[0]);
    await savePage(page, pages[1], times[1]);
    const pending = await readBatch(context, batchId);
    expect(pending.status).toBe("pending");
    expect(pending.effectiveAt).toBeNull();
    expect(pending.pages).toHaveLength(3);
    expect(pending.pages.find((item) => item.pageKey === pages[2])?.verifiedAt).toBeNull();

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        await visit(page, locale, width);
        const current = copy[locale];
        await expect(main.getByText(current.pending, { exact: true })).toBeVisible();
        await expect(main.getByText(current.pendingLine, { exact: true })).toBeVisible();
        await expect(main.getByText(current.unverified, { exact: true })).toHaveCount(1);
        await expect(main.getByText(pages[0], { exact: true })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: current.register, exact: true }), width, `pending-${locale}-375`);
      }
    }

    await visit(page, "zh-CN", 375);
    await savePage(page, pages[2], "2026-11-04");
    await expect(main.getByRole("alert")).toHaveText(copy["zh-CN"].invalid);
    expect(await readBatch(context, batchId)).toEqual(pending);

    await savePage(page, pages[2], times[2]);
    await expect(main.getByText(copy["zh-CN"].effectiveLine, { exact: true })).toBeVisible();
    const effective = await readBatch(context, batchId);
    expect(effective.status).toBe("effective");
    expect(effective.effectiveAt).toBe(latestTime);
    expect(effective.pages).toHaveLength(3);
    for (const [index, key] of pages.entries()) {
      expect(effective.pages.find((item) => item.pageKey === key)?.verifiedAt).toBe(times[index]);
    }

    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        await visit(page, locale, width);
        const current = copy[locale];
        await expect(main.getByText(current.effective, { exact: true })).toBeVisible();
        await expect(main.getByText(current.effectiveLine, { exact: true })).toBeVisible();
        await expect(main.getByText(current.unverified, { exact: true })).toHaveCount(0);
        await checkLayout(page, main.getByRole("link", { name: current.review, exact: true }), width, `effective-${locale}-375`);
      }
    }

    await visit(page, "en", 375);
    await activate(page, main.getByRole("link", { name: copy.en.review, exact: true }));
    await expect(main.getByRole("heading", { name: copy.en.effective, exact: true })).toBeFocused();
    await expect(main.getByText(copy.en.effectiveLine, { exact: true })).toBeInViewport();
    await activate(page, main.getByText("How the effective point is set", { exact: true }));
    await expect(main.getByText(/does not fetch pages/)).toBeVisible();

    await context.addCookies([{ name: "geo-interventions-unavailable", value: "1", url: origin }]);
    await visit(page, "en", 375);
    await expect(main.getByRole("alert")).toHaveText("Intervention batches are temporarily unavailable. Try again later.");
    for (const value of [brandName, pages[0], latestTime, batchId, "Private intervention fixture failure"]) {
      await expect(main).not.toContainText(value);
    }
    await expect(main.locator("input[name='batchId']")).toHaveCount(0);
    const reload = main.getByRole("link", { name: "Reload", exact: true });
    await checkLayout(page, reload, 375, "failure-en-375");
    await context.clearCookies({ name: "geo-interventions-unavailable" });
    await activate(page, reload);
    await expect(main.getByText(copy.en.effectiveLine, { exact: true })).toBeVisible();
    expect(await readBatch(context, batchId)).toEqual(effective);

    const stranger = await outsider.newPage();
    for (const locale of ["zh-CN", "en"] as const) {
      for (const width of [375, 768, 1440]) {
        await visit(stranger, locale, width);
        const strangerMain = stranger.getByRole("main");
        await expect(strangerMain.getByText(brandName)).toHaveCount(0);
        await expect(strangerMain.getByText(pages[0])).toHaveCount(0);
        await expect(strangerMain.getByRole("button", { name: copy[locale].create })).toHaveCount(0);
        await checkLayout(stranger, strangerMain.getByRole("link", { name: copy[locale].openBrand }), width, `no-brand-${locale}-375`);
      }
    }
    const refused = await outsider.request.get(`/api/reports/interventions/${batchId}`, { headers: { Origin: origin } });
    expect(refused.status()).toBe(404);
    const refusedWrite = await outsider.request.post(`/api/reports/interventions/${batchId}/pages`, {
      headers: { Origin: origin }, data: { pageKey: pages[2], verifiedAt: null },
    });
    expect(refusedWrite.status()).toBe(404);
    expect(await readBatch(context, batchId)).toEqual(effective);
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
    const sql = postgres(databaseURL, { max: 1 });
    try {
      for (const { userId, email } of accounts) {
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from intervention_batch where owner_id = ${userId}) as batch,
                 exists (select 1 from intervention_batch_page where owner_id = ${userId}) as page`;
        expect(remaining).toEqual({ account: false, brand: false, batch: false, page: false });
      }
      if (brandId) {
        const versions = await sql`select 1 from brand_version where brand_id = ${brandId}`;
        expect(versions).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
