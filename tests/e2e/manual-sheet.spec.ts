import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const latestText = "门店如何安排设备巡检";
const secondText = "离线巡检的产品怎么比较";
const oldText = "旧版门店巡检题目不该显示";
const deletedText = "已从最新题集删除的题目";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [] }),
  ], { stdio: "inherit" });
}

function question(id: string, clusterId: string, text: string) {
  return {
    id, clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false,
  };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

async function dueCounts(brandId: string) {
  const db = postgres(localDatabaseURL(), { max: 1 });
  try {
    const runs = await db<{ kind: string; count: number }[]>`
      select kind, count(*)::int as count from sampling_due_run where brand_id = ${brandId} group by kind order by kind
    `;
    const [attempts] = await db<{ count: number }[]>`
      select count(*)::int as count from monitoring_run where brand_id = ${brandId}
    `;
    return { runs, attempts: attempts?.count ?? 0 };
  } finally {
    await db.end();
  }
}

test("a due manual sheet lists frozen questions and stays manual in English", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `sheet-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let userId = "";
  const clusterId = randomUUID();
  const setId = randomUUID();
  const currentA = randomUUID();
  const currentB = randomUUID();
  const deletedId = randomUUID();
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "题单验收", email, password });
    expect(registered.status()).toBe(200);
    userId = (await registered.json()).user.id as string;
    const sql = postgres(localDatabaseURL(), { max: 1 });
    try {
      await sql`update "user" set email_verified = true where id = ${userId}`;
    } finally {
      await sql.end();
    }
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/brands/new");
    await page.getByLabel("品牌名称", { exact: true }).fill("题单验收品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于人工题单验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://manual-sheet.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "题单验收品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();

    const db = postgres(localDatabaseURL(), { max: 1 });
    try {
      const [brand] = await db<{ entity_version: number }[]>`
        select entity_version from brand where id = ${brandId!} and owner_id = ${userId}
      `;
      expect(brand?.entity_version).toBeGreaterThan(0);
      const older = {
        clusters: [{ id: clusterId, audience: "门店负责人", intent: "安排巡检", primaryPage: "", conversionAction: "" }],
        questions: [question(currentA, clusterId, oldText), question(deletedId, clusterId, deletedText)],
      };
      const latest = {
        clusters: older.clusters,
        questions: [question(currentA, clusterId, latestText), question(currentB, clusterId, secondText)],
      };
      await db`
        insert into prompt_set (
          brand_id, id, set_id, version, entity_version, region, language, content, created_at
        ) values
          (${brandId!}, ${randomUUID()}, ${setId}, 1, ${brand!.entity_version}, 'CN', 'zh-CN', ${JSON.stringify(older)}, '2026-11-01T00:00:00.000Z'),
          (${brandId!}, ${randomUUID()}, ${setId}, 2, ${brand!.entity_version}, 'CN', 'zh-CN', ${JSON.stringify(latest)}, '2026-11-24T01:00:00.000Z')
      `;
    } finally {
      await db.end();
    }

    await page.goto("/dashboard/monitoring/plans");
    await page.getByLabel("币种", { exact: true }).fill("CNY");
    await page.getByLabel("预算（最小货币单位）", { exact: true }).fill("100");
    await page.getByLabel("已花费", { exact: true }).fill("0");
    await page.getByLabel("待对账", { exact: true }).fill("0");
    await page.locator('input[name="nextAt"]').fill("2026-12-01T00:00:00.000Z");
    const manual = page.getByRole("group", { name: "槽位 1", exact: true });
    await manual.getByRole("textbox", { name: "通道", exact: true }).fill("consumer-sheet");
    await manual.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2026-11-20T02:00:00.000Z");
    await manual.getByRole("textbox", { name: "槽位费用", exact: true }).fill("0");
    const official = page.getByRole("group", { name: "槽位 2", exact: true });
    await official.getByRole("textbox", { name: "通道", exact: true }).fill("official-api");
    await official.getByRole("textbox", { name: "槽位时间", exact: true }).fill("2026-11-20T02:00:00.000Z");
    await official.getByRole("combobox", { name: "人工", exact: true }).selectOption("0");
    await official.getByRole("textbox", { name: "槽位费用", exact: true }).fill("10");
    await page.getByRole("button", { name: "保存计划", exact: true }).click();
    await expect(page.getByRole("heading", { name: "当前版本 1", exact: true })).toBeVisible();

    await page.getByLabel("人工题单的问题编号", { exact: true }).fill(`${currentA} ${currentB} ${deletedId}`);
    await page.getByRole("button", { name: "处理到期窗口", exact: true }).click();
    await expect(page.getByText(latestText, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(secondText, { exact: true })).toBeVisible();
    await expect(page.getByText(deletedId, { exact: true })).toBeVisible();
    await expect(page.getByText("题目缺失", { exact: true })).toBeVisible();
    await expect(page.getByText("人工，非自动采集", { exact: true })).toHaveCount(3);
    await expect(page.getByText(/人工题单 .+ 已生成，不会记成自动采集。/)).toBeVisible();
    await expect(page.getByText(oldText, { exact: true })).toHaveCount(0);
    await expect(page.getByText(deletedText, { exact: true })).toHaveCount(0);
    await expectNoOverflow(page);
    const first = await dueCounts(brandId!);
    expect(first.runs).toEqual([{ kind: "manual", count: 1 }]);
    expect(first.attempts).toBe(0);

    await page.getByLabel("人工题单的问题编号", { exact: true }).fill(randomUUID());
    await page.getByRole("button", { name: "处理到期窗口", exact: true }).click();
    await expect(page.getByText(latestText, { exact: true })).toBeVisible();
    await expect(page.getByText("题目缺失", { exact: true })).toHaveCount(1);
    const second = await dueCounts(brandId!);
    expect(second.runs).toEqual([{ kind: "manual", count: 1 }]);
    expect(second.attempts).toBe(0);

    await page.setViewportSize({ width: 768, height: 900 });
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sampling plans", exact: true })).toBeVisible();
    const sheet = page.locator("#main-content");
    await expect(sheet.getByRole("listitem").filter({ hasText: latestText })).toHaveCount(1);
    await expect(sheet.getByRole("listitem").filter({ hasText: secondText })).toHaveCount(1);
    await expect(sheet.getByRole("listitem").filter({ hasText: "Question missing" })).toHaveCount(1);
    await expect(sheet.getByText("Manual, not automatic collection", { exact: true })).toHaveCount(3);
    await expect(sheet.getByText(oldText, { exact: true })).toHaveCount(0);
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoOverflow(page);
  } finally {
    if (userId) cleanupAccount(userId, email);
  }
});
