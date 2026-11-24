import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const longUrl = `https://content-calendar.example.com/${"w".repeat(180)}`;
const otherUrl = "https://content-calendar.example.com/zhihu";
const plannedOn = "2026-11-01";
const verifiedOn = "2026-11-20";

const copy = {
  "zh-CN": {
    title: "内容日历",
    plannedTask: "有页面尚未核验。计划日不是上线日期。先打开尚未核验的发布记录。",
    blockedTask: "已核验的渠道保持核验结果。受阻渠道单独标出，不会改掉其他渠道。下一步是查看受阻发布。",
    openPlanned: "打开尚未核验的发布",
    openBlocked: "查看受阻发布",
    planned: "计划中",
    verified: "已核验",
    blocked: "受阻",
    notLive: "未上线",
    live: "已按核验日上线",
    notVerified: "尚未核验",
    related: "相关入口",
    goBrands: "前往品牌",
    unavailable: "暂时无法读取内容日历。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
  },
  en: {
    title: "Content calendar",
    plannedTask: "Some pages are not verified yet. The planned date is not the go-live date. Open the unverified publication first.",
    blockedTask: "Verified channels keep their verification. The blocked channel stays separate and does not change the others. Open the blocked publication next.",
    openPlanned: "Open the unverified publication",
    openBlocked: "Open the blocked publication",
    planned: "Planned",
    verified: "Verified",
    blocked: "Blocked",
    notLive: "Not live",
    live: "Live from the verification date",
    notVerified: "Not verified yet",
    related: "Related entries",
    goBrands: "Go to brands",
    unavailable: "The content calendar could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content calendar visual test", email, password: randomBytes(24).toString("base64url"),
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

test("content calendar keeps the next maintenance action readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/content-calendar";
  mkdirSync(shots, { recursive: true });
  const ownerEmail = `content-calendar-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-calendar-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string }> = [];
  try {
    accounts.push({ userId: await register(context, ownerEmail), email: ownerEmail });
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });

    for (const locale of ["zh-CN", "en"] as const) {
      await outsider.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      const guest = await outsider.newPage();
      await guest.setViewportSize({ width: 375, height: 800 });
      await guest.goto("/dashboard/content/calendar");
      await expect(guest.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
      await expect(guest.getByRole("link", { name: copy[locale].goBrands, exact: true })).toBeVisible();
      await expectNoOverflow(guest);
      await guest.close();
    }

    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await post(context, "/api/brands", {
      action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name: "合成日历品牌", description: "仅用于内容日历隔离验收的合成品牌。",
        website: "https://content-calendar.example.com", aliases: [],
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
      action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: "内容日历",
      fields: {
        audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
        applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: "https://content-calendar.example.com/faq",
        conversionAction: "阅读合成说明", templateKind: "fact_faq",
        titleCandidates: ["合成日历稿"], factVersionIds: [factId], competitorSource: null,
      },
    });
    const confirmed = await post(context, "/api/content", {
      action: "confirm-brief", brandId, briefId: brief.briefId, operationId: randomUUID(),
    });
    expect(confirmed.briefId).toBe(brief.briefId);
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
    const ownerId = accounts[0]?.userId ?? "";
    const site = await post(context, "/api/content", {
      action: "submit-publication", brandId, operationId: randomUUID(), versionId,
      targetAccount: "合成站点", pageUrl: longUrl, publisherId: ownerId,
      claimedPublishedAt: "2026-11-20T10:00:00.000Z", channelDeclaration: "site",
    });
    const zhihu = await post(context, "/api/content", {
      action: "submit-publication", brandId, operationId: randomUUID(), versionId,
      targetAccount: "合成知乎", pageUrl: otherUrl, publisherId: ownerId,
      claimedPublishedAt: "2026-11-20T10:00:00.000Z", channelDeclaration: "zhihu",
    });
    const siteId = site.publicationId as string;
    const zhihuId = zhihu.publicationId as string;
    const fact = await context.request.get(`/api/brands/${brandId}/facts?fact=${factId}`);
    expect(fact.ok(), fact.ok() ? "" : await fact.text()).toBeTruthy();
    const revision = (await fact.json()).fact.revision as number;
    await post(context, `/api/brands/${brandId}/facts`, {
      action: "revoke", id: factId, revision, confirmed: true,
    });
    const opened = await post(context, "/api/content/maintenance", {
      action: "open-maintenance", brandId, factVersionId: factId, reason: "revoked",
      schedules: [
        { pageId: siteId, plannedOn, verifiedOn: null },
        { pageId: zhihuId, plannedOn, verifiedOn: null },
      ],
    });
    const taskId = opened.taskId as string;
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    const href = `/dashboard/content/calendar?brandId=${brandId}`;

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
        await expect(main.getByText(current.plannedTask, { exact: true })).toBeVisible();
        const open = main.getByRole("link", { name: current.openPlanned, exact: true });
        await expect(open).toHaveCount(1);
        await expect(open).toHaveAttribute("href", `/dashboard/content/publications/${siteId}`);
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        await expect(main.getByText(longUrl, { exact: true })).toBeVisible();
        await expect(main.getByText("site", { exact: true })).toBeVisible();
        await expect(main.getByText("zhihu", { exact: true })).toBeVisible();
        await expect(main.getByText(plannedOn, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(current.planned, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(current.notLive, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(current.notVerified, { exact: true }).first()).toBeVisible();
        if (width === 375) {
          await expect(open).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-calendar-planned-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    await activateFromKeyboard(page, page.getByRole("link", { name: copy["zh-CN"].openPlanned, exact: true }));
    await expect(page).toHaveURL(new RegExp(`/dashboard/content/publications/${siteId}$`));

    await post(context, "/api/content/maintenance", {
      action: "settle-maintenance", brandId, taskId,
      channels: [
        { channel: "site", state: "verified", verifiedOn },
        { channel: "zhihu", state: "blocked" },
      ],
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
        await expect(main.getByText(current.blockedTask, { exact: true })).toBeVisible();
        const open = main.getByRole("link", { name: current.openBlocked, exact: true });
        await expect(open).toHaveCount(1);
        await expect(open).toHaveAttribute("href", `/dashboard/content/publications/${zhihuId}`);
        await expect(main.getByRole("link", { name: current.openPlanned, exact: true })).toHaveCount(0);
        await expect(main.getByText(current.verified, { exact: true })).toBeVisible();
        await expect(main.getByText(verifiedOn, { exact: true })).toBeVisible();
        await expect(main.getByText(current.live, { exact: true })).toBeVisible();
        await expect(main.getByText(current.blocked, { exact: true })).toBeVisible();
        await expect(main.getByText(current.notLive, { exact: true })).toBeVisible();
        await expect(main.getByText(longUrl, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(open).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-calendar-blocked-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-calendar-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(longUrl)).toHaveCount(0);
    await expect(failed.getByText(otherUrl)).toHaveCount(0);
    await expect(failed.getByText(siteId)).toHaveCount(0);
    await expect(failed.getByText(zhihuId)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-calendar-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-calendar-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText(copy.en.blockedTask, { exact: true })).toBeVisible();
    await expect(page.getByText(longUrl, { exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(longUrl)).toHaveCount(0);
    await expect(stranger.getByText(siteId)).toHaveCount(0);
    await expect(stranger.getByText(zhihuId)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/content-calendar-hidden-en-375.png`, fullPage: false });
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
