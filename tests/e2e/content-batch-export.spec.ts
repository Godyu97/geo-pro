import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const titles = {
  eligibleA: `合成稿件甲${"稿".repeat(36)}`,
  blocked: "合成稿件乙",
  eligibleC: "合成稿件丙",
} as const;

const copy = {
  "zh-CN": {
    title: "内容计划与草稿",
    versions: "稿件版本",
    hint: "勾选多篇稿件后先预检。有阻塞时不会自动导出，必须再明确勾选合格子集才会生成交付包。导出成功不等于公开发布。",
    run: "运行批量预检",
    none: "请至少勾选一篇稿件。未勾选不会导出。",
    preflight: "批量预检结果",
    eligible: "可导出",
    blocked: "被阻塞",
    formal: "正式包",
    fact: "绑定的事实已撤销、过期或不可公开。",
    subset: "所选版本必须是预检通过的子集。",
    confirm: "确认导出已勾选的合格稿件",
    done: "导出完成",
    emptyPackages: "暂无交付包。",
    download: "下载 content.md",
    mode: "导出类型",
    single: "运行预检",
  },
  en: {
    title: "Content plans and drafts",
    versions: "Content versions",
    hint: "Select drafts and run preflight first. Blocked drafts are not skipped silently. Check the eligible subset yourself before a package is created. Exporting is not publishing.",
    run: "Run batch preflight",
    none: "Select at least one draft. Nothing is exported when none are selected.",
    preflight: "Batch preflight result",
    eligible: "Eligible",
    blocked: "Blocked",
    formal: "Formal package",
    fact: "A bound fact is revoked, expired, or not public.",
    subset: "The chosen versions must be a subset that passed preflight.",
    confirm: "Export the checked eligible drafts",
    done: "Export complete",
    emptyPackages: "No delivery packages yet.",
    download: "Download content.md",
    mode: "Export kind",
    single: "Run preflight",
  },
} as const;

function preflightName(locale: keyof typeof copy, title: string) {
  return locale === "zh-CN" ? `将「${title}」纳入预检` : `Include "${title}" in preflight`;
}

function exportName(locale: keyof typeof copy, title: string) {
  return locale === "zh-CN" ? `导出「${title}」` : `Export "${title}"`;
}

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content batch export test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(path, { headers: { Origin: origin }, data });
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

async function checkFromKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Space");
  await expect(control).toBeChecked();
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) return null;
    return { scrollWidth: document.documentElement.scrollWidth, width };
  });
  expect(overflow).toBeNull();
}

test("content list batch preflight shows blockers and exports only the checked subset", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-151/content-batch-export";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-export-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-export-other-${randomUUID()}@example.invalid`;
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
        name: "合成批量导出品牌", description: "仅用于批量导出预检验收的合成品牌。",
        website: "https://content-export.example.com", aliases: [],
        region: "CN", language: "zh-CN", competitors: [], questions: [],
      },
    });
    const brandId = savedBrand.id as string;
    const drafts: Array<{ title: string; factId: string; claim: string; briefId: string }> = [
      { title: titles.eligibleA, factId: randomUUID(), claim: "合成说明甲可公开核验", briefId: "" },
      { title: titles.blocked, factId: randomUUID(), claim: "合成说明乙可公开核验", briefId: "" },
      { title: titles.eligibleC, factId: randomUUID(), claim: "合成说明丙可公开核验", briefId: "" },
    ];
    for (const draft of drafts) {
      const fields = {
        category: "specification", title: draft.title, claim: draft.claim,
        sourceType: "url", sourceReference: "https://content-export.example.com/source",
        sourceLocator: "第 1 节", sourceExcerpt: draft.claim, sourceDate: "2026-11-20",
        permission: "public", validity: "dated", validThrough: "2027-06-30",
        pasteId: null, pasteSpan: null,
      };
      for (const command of [
        { action: "create", id: draft.factId, previousId: null, fields },
        { action: "submit", id: draft.factId, revision: 1 },
        { action: "approve", id: draft.factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false },
      ]) {
        await post(context, `/api/brands/${brandId}/facts`, command);
      }
      const brief = await post(context, "/api/content", {
        action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: draft.title,
        fields: {
          audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
          applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: "https://content-export.example.com/faq",
          conversionAction: "阅读合成说明", templateKind: "fact_faq",
          titleCandidates: [draft.title], factVersionIds: [draft.factId], competitorSource: null,
        },
      });
      await post(context, "/api/content", {
        action: "confirm-brief", brandId, briefId: brief.briefId, operationId: randomUUID(),
      });
      draft.briefId = brief.briefId as string;
    }
    const generated = await post(context, "/api/content", {
      action: "generate-batch", brandId, operationId: randomUUID(),
      briefIds: drafts.map((draft) => draft.briefId),
    });
    const units = generated.units as Array<{ briefId: string; contentVersionId: string | null; status: string }>;
    expect(units.every((unit) => unit.status === "succeeded" && unit.contentVersionId)).toBeTruthy();
    const versionByTitle = new Map<string, string>();
    for (const draft of drafts) {
      const unit = units.find((item) => item.briefId === draft.briefId);
      const versionId = unit?.contentVersionId ?? "";
      expect(versionId).toMatch(/^[0-9a-f-]{36}$/);
      versionByTitle.set(draft.title, versionId);
      await post(context, "/api/content", {
        action: "update-variant", brandId, operationId: randomUUID(), versionId,
        labelingProfileVersion: "m0-export", labelingProfileStatus: "verified",
      });
      await post(context, "/api/content", {
        action: "submit-review", brandId, operationId: randomUUID(), versionId,
      });
      await post(context, "/api/content", {
        action: "approve-content", brandId, operationId: randomUUID(), versionId,
      });
    }
    await post(context, `/api/brands/${brandId}/facts`, {
      action: "revoke", id: drafts[1]?.factId, revision: 3, confirmed: true,
    });

    const href = `/dashboard/content?brandId=${brandId}`;
    const main = page.getByRole("main");
    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
        const versions = main.locator("section").filter({ has: page.getByRole("heading", { name: current.versions, exact: true }) });
        await expect(versions.getByRole("heading", { name: current.versions, exact: true })).toBeVisible();
        await expect(versions.getByText(current.hint, { exact: true })).toBeVisible();
        await expect(versions.getByRole("button", { name: current.run, exact: true })).toBeVisible();
        await expect(main.getByRole("heading", { name: current.preflight, exact: true })).toHaveCount(0);
        for (const title of Object.values(titles)) {
          await expect(versions.getByRole("checkbox", { name: preflightName(locale, title), exact: true })).toBeVisible();
          await expect(versions.getByRole("link", { name: title, exact: true })).toBeVisible();
        }
        if (width === 375) {
          const run = versions.getByRole("button", { name: current.run, exact: true });
          await run.scrollIntoViewIfNeeded();
          await expect(run).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-export-select-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    const zh = copy["zh-CN"];
    await activateFromKeyboard(page, main.getByRole("button", { name: zh.run, exact: true }));
    await expect(main.getByRole("alert")).toHaveText(zh.none);
    await expect(main.getByRole("heading", { name: zh.preflight, exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: zh.download, exact: true })).toHaveCount(0);

    const mode = main.getByRole("combobox", { name: zh.mode, exact: true });
    await mode.focus();
    await expect(mode).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(mode).toHaveValue("formal");
    for (const title of Object.values(titles)) {
      await checkFromKeyboard(page, main.getByRole("checkbox", { name: preflightName("zh-CN", title), exact: true }));
    }
    await activateFromKeyboard(page, main.getByRole("button", { name: zh.run, exact: true }));
    const result = main.locator("section").filter({ has: page.getByRole("heading", { name: zh.preflight, exact: true }) });
    await expect(result.getByText(zh.eligible, { exact: true })).toHaveCount(2);
    await expect(result.getByText(zh.blocked, { exact: true })).toHaveCount(1);
    await expect(result.getByText(zh.formal, { exact: true })).toHaveCount(3);
    await expect(result.getByText("FACT_INVALID", { exact: true })).toBeVisible();
    await expect(result.getByText(zh.fact, { exact: false })).toBeVisible();
    await expect(result.getByText(titles.blocked, { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("link", { name: zh.download, exact: true })).toHaveCount(0);
    await expect(result.getByText(zh.emptyPackages, { exact: true })).toBeVisible();
    await expectNoOverflow(page);

    for (const title of Object.values(titles)) {
      await checkFromKeyboard(page, result.getByRole("checkbox", { name: exportName("zh-CN", title), exact: true }));
    }
    await activateFromKeyboard(page, result.getByRole("button", { name: zh.confirm, exact: true }));
    await expect(main.getByRole("alert")).toHaveText(zh.subset);
    await expect(main.getByRole("link", { name: zh.download, exact: true })).toHaveCount(0);
    await expect(result.getByText(zh.emptyPackages, { exact: true })).toBeVisible();
    await expect(result.getByText("FACT_INVALID", { exact: true })).toBeVisible();

    for (const title of [titles.eligibleA, titles.eligibleC]) {
      await checkFromKeyboard(page, result.getByRole("checkbox", { name: exportName("zh-CN", title), exact: true }));
    }
    await expect(result.getByRole("checkbox", { name: exportName("zh-CN", titles.blocked), exact: true })).not.toBeChecked();
    await activateFromKeyboard(page, result.getByRole("button", { name: zh.confirm, exact: true }));
    await expect(main.getByRole("status")).toHaveText(zh.done);
    await expect(main.getByRole("alert")).toHaveCount(0);
    const downloads = main.getByRole("link", { name: zh.download, exact: true });
    await expect(downloads).toHaveCount(2);
    const hrefs = await downloads.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    const bodies: string[] = [];
    for (const file of hrefs) {
      expect(file).toMatch(/^\/api\/content\/packages\/[0-9a-f-]{36}\?file=content\.md$/);
      const response = await context.request.get(file ?? "");
      expect(response.status()).toBe(200);
      bodies.push(await response.text());
    }
    expect(bodies.some((body) => body.includes(titles.eligibleA))).toBeTruthy();
    expect(bodies.some((body) => body.includes(titles.eligibleC))).toBeTruthy();
    expect(bodies.every((body) => !body.includes(titles.blocked))).toBeTruthy();
    const denied = await outsider.request.get(hrefs[0] ?? "");
    expect(denied.status()).toBe(404);
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-export-ready-zh-CN-375.png`, fullPage: false });

    const readyUrl = page.url();
    for (const locale of ["zh-CN", "en"] as const) {
      const current = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(readyUrl);
        await page.evaluate(() => window.scrollTo(0, 0));
        const ready = page.getByRole("main");
        await expect(ready.getByRole("heading", { name: current.preflight, exact: true })).toBeVisible();
        await expect(ready.getByText(current.done, { exact: true })).toBeVisible();
        await expect(ready.getByRole("link", { name: current.download, exact: true })).toHaveCount(2);
        await expect(ready.getByText("FACT_INVALID", { exact: true })).toBeVisible();
        await expect(ready.getByText(current.fact, { exact: false })).toBeVisible();
        if (width === 375) {
          await page.screenshot({ path: `${shots}/content-export-ready-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dashboard/content/versions/${versionByTitle.get(titles.eligibleA)}`);
    await expect(page.getByRole("button", { name: zh.single, exact: true })).toBeVisible();
    await expectNoOverflow(page);

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(readyUrl);
    await expect(stranger.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(stranger.getByText(titles.eligibleA)).toHaveCount(0);
    await expect(stranger.getByText(titles.blocked)).toHaveCount(0);
    await expect(stranger.getByRole("link", { name: copy.en.download, exact: true })).toHaveCount(0);
    await expectNoOverflow(stranger);
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
