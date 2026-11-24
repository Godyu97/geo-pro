import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const time = "2026-11-24T08:00:00.000Z";
const excerpt = "北岸保修两年";

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

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

test("import shows a page, a missing page, and an unapproved fact conflict", async ({ page, context }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const email = `sources-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  let userId = "";
  const factVersionId = randomUUID();
  try {
    const policyVersion = publishedRetentionVersion();
    const registered = await registerTestAccount(context, { name: "片段验收", email, password });
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
    await page.getByLabel("品牌名称", { exact: true }).fill("片段验收品牌");
    await page.getByLabel("一句话业务", { exact: true }).fill("合成品牌，仅用于资料片段验收。");
    await page.getByLabel("官网地址", { exact: true }).fill("https://source-fragments.example.com");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("竞品", { exact: true }).fill("对照品牌");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("checkbox", { name: `我接受保留策略版本 ${policyVersion}`, exact: true }).check();
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(page.getByRole("heading", { name: "片段验收品牌", exact: true })).toBeVisible();
    const brandId = page.url().match(/\/brands\/([0-9a-f-]{36})/)?.[1];
    expect(brandId).toBeTruthy();

    const db = postgres(localDatabaseURL(), { max: 1 });
    try {
      const [brand] = await db`select entity_version from brand where id = ${brandId!} and owner_id = ${userId}`;
      const content = {
        category: "specification",
        title: "保修",
        claim: "保修一年",
        sourceType: "internal",
        sourceReference: "fixture",
        sourceLocator: "第 1 页",
        sourceExcerpt: "fixture",
        sourceDate: "",
        permission: "unknown",
        validity: "unspecified",
        validThrough: "",
        pasteId: null,
        pasteSpan: null,
      };
      await db`
        insert into brand_fact_version (
          brand_id, id, fact_id, version, entity_version, revision, state, content, created_at, confirmed_by, confirmed_at
        ) values (
          ${brandId!}, ${factVersionId}, ${factVersionId}, 1, ${brand.entity_version}, 1, 'approved',
          ${JSON.stringify(content)}, ${time}, ${userId}, ${time}
        )`;
    } finally {
      await db.end();
    }

    await page.goto(`/dashboard/content/sources?brandId=${brandId}`);
    await expect(page.getByRole("heading", { name: "资料原件", exact: true })).toBeVisible();
    await page.locator('input[name="files"]').setInputFiles({
      name: "two.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`${excerpt}\f`),
    });
    await page.getByRole("button", { name: "导入原件", exact: true }).click();
    await expect(page.getByText("two.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("可识别部分已保留。缺失页面需要人工处理，系统没有补写页码。", { exact: true })).toBeVisible();
    await expect(page.getByText(excerpt, { exact: true })).toBeVisible();
    await expect(page.getByText("页码 1", { exact: true })).toBeVisible();
    await expect(page.getByText("这一段缺失。没有补写页码或正文。", { exact: true })).toBeVisible();
    await expect(page.getByText("页码 2", { exact: true })).toBeVisible();
    await expect(page.getByText(`与已批准事实版本 1（${factVersionId}）冲突，候选仍未批准。`, { exact: true })).toBeVisible();
    await expect(page.getByText("与已批准事实没有冲突，候选仍未批准。", { exact: true })).toBeVisible();
    await expect(page.getByText("这些原件还不是已批准事实。", { exact: true })).toBeVisible();
    await expectNoOverflow(page);

    const counted = postgres(localDatabaseURL(), { max: 1 });
    try {
      const [row] = await counted`select count(*)::int as count from brand_fact_version where brand_id = ${brandId!}`;
      expect(row.count).toBe(1);
    } finally {
      await counted.end();
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoOverflow(page);
    await context.addCookies([{ name: "geo-locale", value: "en", url: baseURL }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Source originals", exact: true })).toBeVisible();
    await expect(page.getByText(excerpt, { exact: true })).toBeVisible();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(page.getByText("This part is missing. No page number or text was added.", { exact: true })).toBeVisible();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(page.getByText(`Conflicts with approved fact version 1 (${factVersionId}). The candidate is not approved.`, { exact: true })).toBeVisible();
    await expect(page.getByText("No conflict with an approved fact. The candidate is not approved.", { exact: true })).toBeVisible();
    await expect(page.getByText("These originals are not approved facts.", { exact: true })).toBeVisible();
    await expectNoOverflow(page);
  } finally {
    if (userId) {
      const db = postgres(localDatabaseURL(), { max: 1 });
      try {
        await db`delete from stored_object where owner_id = ${userId}`;
      } finally {
        await db.end();
      }
      cleanupAccount(userId, email);
    }
  }
});
