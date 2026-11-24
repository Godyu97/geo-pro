import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const longTitle = `w${"w".repeat(179)}`;

const copy = {
  "zh-CN": {
    title: "渠道变体",
    emptyTask: "还没有渠道变体。先钉住已发布的画像版本，再保存这个渠道的草稿。导出还不是下一步。",
    divergedTask: "这条变体的正文与主稿不同，不能继承主稿批准，也不能导出已批准包。下一步是核对正文后保存草稿。",
    unapprovedTask: "主稿已批准，但这个渠道还要单独批准。单独批准前，不要导出已批准包。",
    exportTask: "这个渠道已有单独批准，且正文与主稿一致。下一步是导出该变体。",
    divergedReason: "变体正文与主稿不同，需要独立重审，不能继承主稿批准。",
    save: "保存渠道草稿",
    approve: "单独批准该变体",
    export: "导出该变体",
    saved: "渠道变体草稿已保存。",
    draft: "草稿",
    approved: "已单独批准",
    related: "相关入口",
    unavailable: "暂时无法读取渠道变体。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
    channelKey: "渠道键",
    note: "说明",
    publish: "发布新版本",
    published: "已发布新的画像版本。旧版本的字数上限没有改动。",
  },
  en: {
    title: "Channel variants",
    emptyTask: "There is no channel variant yet. Pin a published profile version, then save this channel draft. Export is not the next step.",
    divergedTask: "This variant body differs from the master. It cannot inherit the master approval or export an approved package. Review the body, then save the draft.",
    unapprovedTask: "The master is approved, but this channel still needs its own approval. Do not export an approved package before that.",
    exportTask: "This channel has its own approval and the body matches the master. Export this variant next.",
    divergedReason: "The variant body differs from the master and needs its own review. It cannot inherit the master approval.",
    save: "Save channel draft",
    approve: "Approve this variant",
    export: "Export this variant",
    saved: "The channel variant draft is saved.",
    draft: "Draft",
    approved: "Approved separately",
    related: "Related entries",
    unavailable: "Channel variants could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
    channelKey: "Channel key",
    note: "Note",
    publish: "Publish new version",
    published: "A new profile version was published. Older character limits were left unchanged.",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Channel variant visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function post(context: BrowserContext, url: string, data: unknown) {
  const response = await context.request.post(url, { headers: { Origin: origin }, data });
  expect(response.ok(), response.ok() ? "" : await response.text()).toBeTruthy();
  return response.json();
}

async function activateFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

test("channel variants keep the next approval action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  const shots = ".cache/issue-135/channel-variants";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-variant-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-variant-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await post(context, "/api/brands", {
      action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: "合成变体品牌", description: "仅用于渠道变体隔离验收的合成品牌。",
        website: "https://content-variant.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const brandId = savedBrand.id as string;
    const factId = randomUUID();
    const factFields = {
      category: "price", title: "合成报价", claim: "合成说明售价 100 CNY",
      sourceType: "internal", sourceReference: "合成附件说明", sourceLocator: "第 1 节",
      sourceExcerpt: "仅用于隔离验收的报价摘录", sourceDate: "2026-11-20",
      permission: "public", validity: "dated", validThrough: "2027-06-30",
      pasteId: null, pasteSpan: null,
    };
    for (const command of [
      { action: "create", id: factId, previousId: null, fields: factFields },
      { action: "submit", id: factId, revision: 1 },
      { action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false },
    ]) {
      await post(context, `/api/brands/${brandId}/facts`, command);
    }
    const brief = await post(context, "/api/content", {
      action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: "渠道变体",
      fields: {
        audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
        applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: "https://content-variant.example.com/faq",
        conversionAction: "阅读合成说明", templateKind: "fact_faq",
        titleCandidates: [longTitle], factVersionIds: [factId], competitorSource: null,
      },
    });
    await post(context, "/api/content", {
      action: "confirm-brief", brandId, briefId: brief.briefId, operationId: randomUUID(),
    });
    const generated = await post(context, "/api/content", {
      action: "generate-batch", brandId, operationId: randomUUID(), briefIds: [brief.briefId],
    });
    const versionId = (generated.units as Array<{ contentVersionId: string | null }>)
      .find((unit) => unit.contentVersionId)?.contentVersionId ?? "";
    expect(versionId).toMatch(/^[0-9a-f-]{36}$/);
    await post(context, "/api/content", {
      action: "submit-review", brandId, versionId, operationId: randomUUID(),
    });
    await post(context, "/api/content", {
      action: "approve-content", brandId, versionId, operationId: randomUUID(),
    });
    const versionResponse = await context.request.get(`/api/content/versions/${versionId}`);
    expect(versionResponse.ok(), versionResponse.ok() ? "" : await versionResponse.text()).toBeTruthy();
    const master = await versionResponse.json();
    const masterBody = master.version.bodyMarkdown as string;
    expect(master.version.title).toBe(longTitle);
    expect(master.version.status).toBe("approved");
    expect(masterBody).toContain("100");
    const divergedBody = masterBody.replace("100", "101");
    expect(divergedBody).not.toBe(masterBody);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dashboard/content/channel-profiles?brandId=${brandId}`);
    const profileForm = page.getByRole("main").locator("form").first();
    await profileForm.locator('input[name="channelKey"]').fill("zhihu");
    await profileForm.locator('textarea[name="note"]').fill("隔离验收不设字数上限");
    await profileForm.getByRole("button", { name: copy["zh-CN"].publish, exact: true }).click();
    await expect(page.getByRole("main").getByText(copy["zh-CN"].published, { exact: true })).toBeVisible();

    const href = `/dashboard/content/versions/${versionId}/variants`;
    await page.goto(href);
    await page.locator('input[name="channel"]').fill("zhihu");
    const profileOption = page.locator('select[name="profileVersionId"] option').nth(1);
    await expect(profileOption).toHaveAttribute("value", /^[0-9a-f-]{36}$/);
    const profileVersionId = await profileOption.getAttribute("value");
    await post(context, "/api/content", {
      action: "save-channel-variant", brandId, operationId: randomUUID(), versionId,
      channel: "zhihu", bodyMarkdown: divergedBody, profileVersionId,
    });

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        await expect(main.getByText(current.divergedTask, { exact: true })).toBeVisible();
        const save = main.getByRole("button", { name: current.save, exact: true });
        await expect(save).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.export, exact: true })).toHaveCount(0);
        await expect(main.getByText(current.divergedReason).first()).toBeVisible();
        await expect(main.getByText(current.draft, { exact: true }).first()).toBeVisible();
        await expect(main.getByText("zhihu", { exact: true }).first()).toBeVisible();
        await expect(main.getByText(longTitle, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        if (width === 375) {
          await expect(save).toBeInViewport();
          await page.screenshot({ path: `${shots}/channel-variants-diverged-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].save, exact: true }));
    await expect(page.getByText(copy["zh-CN"].saved, { exact: true })).toBeVisible();
    await expect(page.getByText(copy["zh-CN"].divergedTask, { exact: true })).toBeVisible();

    await post(context, "/api/content", {
      action: "save-channel-variant", brandId, operationId: randomUUID(), versionId,
      channel: "zhihu", bodyMarkdown: masterBody,
    });

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(current.unapprovedTask, { exact: true })).toBeVisible();
        const approve = main.getByRole("button", { name: current.approve, exact: true });
        await expect(approve).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.export, exact: true })).toHaveCount(0);
        await expect(main.getByText(longTitle, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(approve).toBeInViewport();
          await page.screenshot({ path: `${shots}/channel-variants-unapproved-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].approve, exact: true }));
    await expect(page.getByText(copy["zh-CN"].exportTask, { exact: true })).toBeVisible();
    await expect(page.getByText(copy["zh-CN"].approved, { exact: true }).first()).toBeVisible();
    const listed = await context.request.get(`/api/content/versions/${versionId}/variants`);
    expect(listed.ok(), listed.ok() ? "" : await listed.text()).toBeTruthy();
    const savedVariant = (await listed.json()).variants.find((item: { channel: string }) => item.channel === "zhihu");
    expect(savedVariant.approvalStatus).toBe("approved");
    expect(savedVariant.rejection).toBeNull();
    expect(savedVariant.bodyMarkdown).toBe(masterBody);

    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main.getByText(current.exportTask, { exact: true })).toBeVisible();
        const exportButton = main.getByRole("button", { name: current.export, exact: true });
        await expect(exportButton).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.approve, exact: true })).toHaveCount(0);
        await expect(main.getByText(current.approved, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(longTitle, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(exportButton).toBeInViewport();
          await page.screenshot({ path: `${shots}/channel-variants-export-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-variant-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(longTitle)).toHaveCount(0);
    await expect(failed.getByText("zhihu")).toHaveCount(0);
    await expect(failed.getByText("101")).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/channel-variants-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-variant-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText(copy.en.exportTask, { exact: true })).toBeVisible();
    await expect(page.getByText(longTitle, { exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(longTitle)).toHaveCount(0);
    await expect(stranger.getByText("zhihu")).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/channel-variants-hidden-en-375.png`, fullPage: false });
  } finally {
    await outsider.close();
    for (const { userId, email } of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify({ userId, email }),
      ], { stdio: "inherit" });
    }
  }
});
