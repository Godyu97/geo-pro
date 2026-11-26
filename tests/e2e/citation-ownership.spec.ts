import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const shareUrl = "https://share-platform.example.com/brand-north?utm_source=e2e";
const mediaUrl = "https://third-media.example.org/north-review";
const searchUrl = "https://north.example.com/search-only";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

async function provision(browser: Browser, email: string, name: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 } });
  const response = await registerTestAccount(context, {
    name,
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { user: { id: string } };
  return { context, userId: body.user.id, email };
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
      ? null
      : { scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }
  ));
  expect(overflow).toBeNull();
}

test("native citation ownership updates Jo in both locales and respects brand access", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const token = randomUUID().slice(0, 8);
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const accounts: Array<{ context: BrowserContext; userId: string; email: string }> = [];

  try {
    const owner = await provision(browser, `citation-owner-${token}@example.invalid`, "Owner");
    accounts.push(owner);
    const reader = await provision(browser, `citation-readonly-${token}@example.invalid`, "ReadOnly");
    accounts.push(reader);
    const outsider = await provision(browser, `citation-outsider-${token}@example.invalid`, "Outsider");
    accounts.push(outsider);

    const brandRes = await owner.context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit",
        actorId: owner.userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: `合成归属品牌${token}`,
          description: "合成品牌，仅用于引用归属与自有页指标验收。",
          website: "https://north.example.com",
          aliases: ["北岸"],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(brandRes.status()).toBe(200);
    const brandId = (await brandRes.json() as { id: string }).id;

    const grantedAt = new Date().toISOString();
    await sql`
      insert into brand_member_grant (id, brand_id, user_id, role, active, created_at)
      values
        (${randomUUID()}, ${brandId}, ${owner.userId}, ${"owner"}, ${1}, ${grantedAt}),
        (${randomUUID()}, ${brandId}, ${reader.userId}, ${"read_only"}, ${1}, ${grantedAt})`;

    const savedRes = await owner.context.request.post("/api/monitoring/answers", {
      headers: { Origin: origin },
      data: {
        action: "submit-manual",
        brandId,
        operationId: randomUUID(),
        questionText: "工业监测方案如何选择？",
        answerText: "可参考北岸品牌在行业平台上的介绍页面。",
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: "off",
        targetRegion: "CN",
        observedRegion: "unknown",
        newSession: "unknown",
        productMode: "unknown",
        entityVersion: 1,
        citationSetState: "complete",
        citations: [
          { rawUrl: shareUrl, citationOrigin: "consumer_visible", ownership: "unknown", pageStatus: "unknown" },
          { rawUrl: mediaUrl, citationOrigin: "provider_native", ownership: "unknown", pageStatus: "unknown" },
        ],
        locatorRef: "fixture://citation-e2e/1",
        collectorId: "collector-e2e",
        brandName: `合成归属品牌${token}`,
        aliases: ["北岸"],
        officialWebsite: "https://north.example.com",
      },
    });
    expect(savedRes.status()).toBe(200);
    const saved = await savedRes.json() as {
      observation: { id: string; answerText: string; citationSetState: string };
      citations: Array<{ id: string; rawUrl: string; ownership: string; pageStatus: string }>;
    };
    const observationId = saved.observation.id;
    const shareCitation = saved.citations.find((item) => item.rawUrl === shareUrl);
    if (!shareCitation) throw new Error("Expected the saved shared-platform citation");
    const detailPath = `/dashboard/monitoring/evidence/${observationId}`;
    const overviewPath = `/dashboard/monitoring/overview?brandId=${brandId}&sourceMode=consumer_ui`;
    const answersPath = "/api/monitoring/answers";
    const readPath = `${answersPath}/${observationId}`;

    const refRes = await owner.context.request.post(answersPath, {
      headers: { Origin: origin },
      data: {
        action: "append-reference",
        brandId,
        observationId,
        operationId: randomUUID(),
        rawUrl: searchUrl,
        citationOrigin: "search_candidate",
      },
    });
    expect(refRes.status()).toBe(200);

    const page = await owner.context.newPage();
    page.setDefaultTimeout(20_000);
    await owner.context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const main = page.getByRole("main");
    const joCell = page.locator("#overview-question-table tbody tr").first().getByRole("cell").nth(3);

    await page.goto(overviewPath);
    await expect(main.getByText("自有页引用率", { exact: true }).first()).toBeVisible();
    await expect(joCell).toContainText("N/A");

    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(detailPath);
    await expect(main.getByText("存在原生引用", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "保存归属与状态", exact: true })).toHaveCount(2);
    await expectNoOverflow(page);
    const ownershipSelect = main.locator(`#citation-ownership-${shareCitation.id}`);
    const pageStatusSelect = main.locator(`#citation-page-status-${shareCitation.id}`);
    await ownershipSelect.focus();
    await ownershipSelect.press("Home");
    await ownershipSelect.press("ArrowDown");
    await expect(ownershipSelect).toHaveValue("owned_account");
    await page.keyboard.press("Tab");
    await expect(pageStatusSelect).toBeFocused();
    await pageStatusSelect.press("Home");
    await pageStatusSelect.press("ArrowDown");
    await expect(pageStatusSelect).toHaveValue("reachable");
    const form = ownershipSelect.locator("xpath=ancestor::form");
    const saveButton = form.getByRole("button", { name: "保存归属与状态", exact: true });
    await page.keyboard.press("Tab");
    await expect(saveButton).toBeFocused();
    const savedCitationResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === answersPath,
    );
    await page.keyboard.press("Enter");
    expect((await savedCitationResponse).status()).toBe(200);
    await expect(form.getByRole("status")).toHaveText("已保存引用归属与页面状态。");
    await expect(main.getByText("自有账号或页面 · 可访问", { exact: true })).toBeVisible();
    await expect(main.getByText(saved.observation.answerText, { exact: true })).toBeVisible();
    await testInfo.attach("zh-CN citation confirmation at 375px", {
      body: await form.screenshot({ timeout: 10_000 }), contentType: "image/png",
    });

    const afterSave = await owner.context.request.get(readPath, { headers: { Origin: origin } });
    expect(afterSave.status()).toBe(200);
    expect(await afterSave.json()).toMatchObject({
      observation: saved.observation,
      citations: expect.arrayContaining([{ ...shareCitation, ownership: "owned_account", pageStatus: "reachable" }]),
    });

    await main.getByRole("link", { name: "返回概览", exact: true }).press("Enter");
    await expect(joCell).toHaveText("1/1 (100.0%)");
    for (const [locale, label, rateLabel] of [
      ["zh-CN", "自有账号或页面 · 可访问", "自有页引用率"],
      ["en", "Owned account or page · Reachable", "Owned-page citation rate"],
    ]) {
      await owner.context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(detailPath);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(main.getByText(label, { exact: true })).toBeVisible();
        await expectNoOverflow(page);
        await page.goto(overviewPath);
        const card = main.getByRole("heading", { name: rateLabel, exact: true }).locator("..");
        await expect(card.getByText("100.0%", { exact: true })).toBeVisible();
        await expect(joCell).toHaveText("1/1 (100.0%)");
        await expectNoOverflow(page);
      }
    }
    await testInfo.attach("en Jo and per-question metrics at 1440px", {
      body: await page.locator("#overview-question-table").screenshot({ timeout: 10_000 }), contentType: "image/png",
    });

    await page.goto(detailPath);
    await expect(ownershipSelect).toHaveAccessibleName("Citation ownership");
    await expect(pageStatusSelect).toHaveAccessibleName("Page status");
    await pageStatusSelect.focus();
    await pageStatusSelect.press("ArrowDown");
    await expect(pageStatusSelect).toHaveValue("restricted");
    await page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Save ownership & status", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form.getByRole("status")).toHaveText("Saved citation ownership and page status.");
    await expect(main.getByText("Owned account or page · Restricted", { exact: true })).toBeVisible();
    await main.getByRole("link", { name: "Back to overview", exact: true }).press("Enter");
    await expect(joCell).toHaveText("1/1 (100.0%)");

    const confirmation = {
      action: "update-citation",
      brandId,
      observationId,
      citationId: shareCitation.id,
      operationId: randomUUID(),
      ownership: "owned_account",
      pageStatus: "reachable",
    };
    const firstApi = await owner.context.request.post(answersPath, {
      headers: { Origin: origin },
      data: confirmation,
    });
    expect(firstApi.status()).toBe(200);
    const result = await firstApi.json();
    expect(result).toEqual({
      citation: { id: shareCitation.id, ownership: "owned_account", pageStatus: "reachable" },
      replayed: false,
    });
    const replayApi = await owner.context.request.post(answersPath, {
      headers: { Origin: origin },
      data: confirmation,
    });
    expect(replayApi.status()).toBe(200);
    expect(await replayApi.json()).toEqual({ ...result, replayed: true });

    const conflictApi = await owner.context.request.post(answersPath, {
      headers: { Origin: origin },
      data: { ...confirmation, ownership: "competitor" },
    });
    expect(conflictApi.status()).toBe(409);
    expect((await conflictApi.json() as { error: { code: string } }).error.code).toBe("OPERATION_CONFLICT");

    for (const actor of [reader, outsider]) {
      await actor.context.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
      const deniedPage = await actor.context.newPage();
      await deniedPage.goto(detailPath);
      await expect(deniedPage.getByText("Evidence was not found or does not belong to your brand.")).toBeVisible();
      expect(await deniedPage.content()).not.toContain(shareUrl);

      const headers = { Origin: origin };
      const deniedRead = await actor.context.request.get(readPath, { headers });
      const deniedWrite = await actor.context.request.post(answersPath, { headers, data: confirmation });
      const missing = await actor.context.request.post(answersPath, {
        headers, data: { ...confirmation, citationId: randomUUID() },
      });
      for (const response of [deniedRead, deniedWrite, missing]) {
        expect(response.status()).toBe(404);
        expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" }, next: null });
        expect(await response.text()).not.toMatch(/share-platform|owned_account|reachable/);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
    for (const account of accounts) {
      await account.context.close();
      execFileSync(process.execPath, [
        "--conditions=react-server",
        "scripts/e2e-m0-fixture.mjs",
        "cleanup",
        JSON.stringify({ userId: account.userId, email: account.email }),
      ], { stdio: "inherit" });
    }
  }
});
