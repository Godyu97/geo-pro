import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const versionTitle = `合成发布标题${"w".repeat(160)}`;
const longUrl = `https://content-publication.example.com/${"w".repeat(180)}`;
const claimedAt = "2026-11-20T10:00:00.000Z";

const copy = {
  "zh-CN": {
    title: "发布核验详情",
    checkTask: "这是发布回填，还不是公开核验。先运行公开核验。HTTP 成功本身不会写成已生效。",
    limitedTask: "页面受限，不能按公开发布成功处理，也没有生效时间。下一步是提交人工证据。",
    check: "运行公开核验（隔离页）",
    manual: "提交人工证据",
    accessClass: "访问类别",
    url: "公开 URL",
    version: "关联稿件",
    none: "无（草稿/受限不计生效）",
    related: "相关入口",
    unavailable: "暂时无法读取这条发布记录。请稍后重试。",
    reload: "重新载入",
    missing: "找不到这个页面",
    predecessorField: "前一条发布记录（选填）",
    predecessorPending: "查看选定的前版发布（待核验后替代）",
    predecessor: "查看已核验的前版发布",
    successor: "查看已登记的替代记录",
    submitBackfill: "提交发布回填",
  },
  en: {
    title: "Publication verification",
    checkTask: "This is a publication backfill, not a public verification. Run the public check first. HTTP success alone does not set an effective time.",
    limitedTask: "This page is restricted. It is not a successful public release and has no effective time. Submit manual evidence next.",
    check: "Run public check (fixture page)",
    manual: "Submit manual evidence",
    accessClass: "Access class",
    url: "Public URL",
    version: "Content version",
    none: "None (draft/restricted pages never set it)",
    related: "Related entries",
    unavailable: "This publication record could not be loaded. Try again shortly.",
    reload: "Reload",
    missing: "Page not found",
    predecessorField: "Previous publication (optional)",
    predecessorPending: "View the selected previous publication (replacement pending)",
    predecessor: "View the previous verified publication",
    successor: "View the recorded replacement",
    submitBackfill: "Submit publication backfill",
  },
} as const;

async function register(context: BrowserContext, email: string) {
  const response = await registerTestAccount(context, {
    name: "Content publication visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
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

test("publication backfill keeps the next check readable and recoverable", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const shots = ".cache/issue-135/content-publication";
  const replacementShots = `.cache/issue-171/content-publication/${process.env.DATABASE_PROVIDER ?? "postgresql"}`;
  mkdirSync(shots, { recursive: true });
  mkdirSync(replacementShots, { recursive: true });
  const ownerEmail = `content-publication-${randomUUID()}@example.invalid`;
  const outsiderEmail = `content-publication-other-${randomUUID()}@example.invalid`;
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<{ userId: string; email: string; brandId?: string }> = [];
  try {
    const ownerAccount: typeof accounts[number] = { userId: await register(context, ownerEmail), email: ownerEmail };
    accounts.push(ownerAccount);
    accounts.push({ userId: await register(outsider, outsiderEmail), email: outsiderEmail });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    const savedBrand = await context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: {
        action: "submit", actorId: accounts[0]?.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: "合成发布品牌", description: "仅用于发布回填隔离验收的合成品牌。",
          website: "https://content-publication.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(savedBrand.ok(), savedBrand.ok() ? "" : await savedBrand.text()).toBeTruthy();
    const brandId = (await savedBrand.json()).id as string;
    ownerAccount.brandId = brandId;
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
      const saved = await context.request.post(`/api/brands/${brandId}/facts`, {
        headers: { Origin: origin }, data: command,
      });
      expect(saved.ok(), saved.ok() ? "" : await saved.text()).toBeTruthy();
    }
    const brief = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: {
        action: "save-brief-draft", brandId, operationId: randomUUID(), questionCluster: "发布回填",
        fields: {
          audience: "连锁门店设备负责人", targetGap: "FAQ 缺少可核验说明",
          applicableBoundary: "仅合成验收，不用于真实营销", primaryPage: "https://content-publication.example.com/faq",
          conversionAction: "阅读合成说明", templateKind: "fact_faq",
          titleCandidates: [versionTitle], factVersionIds: [factId], competitorSource: null,
        },
      },
    });
    expect(brief.ok(), brief.ok() ? "" : await brief.text()).toBeTruthy();
    const briefId = (await brief.json()).briefId as string;
    const confirmed = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "confirm-brief", brandId, briefId, operationId: randomUUID() },
    });
    expect(confirmed.ok(), confirmed.ok() ? "" : await confirmed.text()).toBeTruthy();
    const generated = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "generate-batch", brandId, operationId: randomUUID(), briefIds: [briefId] },
    });
    expect(generated.ok(), generated.ok() ? "" : await generated.text()).toBeTruthy();
    const generatedBody = await generated.json();
    const versionId = (generatedBody.units as Array<{ contentVersionId: string | null }>)
      .find((unit) => unit.contentVersionId)?.contentVersionId ?? "";
    expect(versionId).toMatch(/^[0-9a-f-]{36}$/);
    const reviewed = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "submit-review", brandId, versionId, operationId: randomUUID() },
    });
    expect(reviewed.ok(), reviewed.ok() ? "" : await reviewed.text()).toBeTruthy();
    const approved = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: { action: "approve-content", brandId, versionId, operationId: randomUUID() },
    });
    expect(approved.ok(), approved.ok() ? "" : await approved.text()).toBeTruthy();
    const ownerId = accounts[0]?.userId ?? "";
    const published = await context.request.post("/api/content", {
      headers: { Origin: origin },
      data: {
        action: "submit-publication", brandId, operationId: randomUUID(), versionId,
        targetAccount: "合成账号", pageUrl: longUrl, publisherId: ownerId,
        claimedPublishedAt: claimedAt, channelDeclaration: "合成渠道，仅隔离验收",
      },
    });
    expect(published.ok(), published.ok() ? "" : await published.text()).toBeTruthy();
    const publicationId = (await published.json()).publicationId as string;
    expect(publicationId).toMatch(/^[0-9a-f-]{36}$/);
    const href = `/dashboard/content/publications/${publicationId}`;

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
        await expect(main.getByText(current.checkTask, { exact: true })).toBeVisible();
        const check = main.getByRole("button", { name: current.check, exact: true });
        await expect(check).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.manual, exact: true })).toHaveCount(0);
        await expect(main.getByText("submitted", { exact: true })).toBeVisible();
        await expect(main.getByText(current.none, { exact: true })).toBeVisible();
        await expect(main.getByText(claimedAt, { exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: current.related })).toBeVisible();
        await expect(main.locator("section").filter({ hasText: current.url }).getByText(longUrl, { exact: true })).toBeVisible();
        await expect(main.locator("section").filter({ hasText: current.version }).getByText(versionTitle, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(check).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-publication-submitted-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("combobox", { name: copy["zh-CN"].accessClass }).selectOption("login_wall");
    await activateFromKeyboard(page, page.getByRole("main").getByRole("button", { name: copy["zh-CN"].check, exact: true }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole("main").getByText("access_limited", { exact: true })).toBeVisible();

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
        await expect(main.getByText(current.limitedTask, { exact: true })).toBeVisible();
        const manual = main.getByRole("button", { name: current.manual, exact: true });
        await expect(manual).toHaveCount(1);
        await expect(main.getByRole("button", { name: current.check, exact: true })).toHaveCount(1);
        await expect(main.getByText("access_limited", { exact: true })).toBeVisible();
        await expect(main.getByText(current.none, { exact: true })).toBeVisible();
        await expect(main.getByText(claimedAt, { exact: true })).toBeVisible();
        await expect(main.locator("section").filter({ hasText: current.url }).getByText(longUrl, { exact: true })).toBeVisible();
        if (width === 375) {
          await expect(manual).toBeInViewport();
          await page.screenshot({ path: `${shots}/content-publication-limited-${locale}-375.png`, fullPage: false });
        }
        await expectNoOverflow(page);
      }
    }

    await context.addCookies([
      { name: "geo-locale", value: "en", url: origin },
      { name: "geo-content-publication-unavailable", value: "1", url: origin },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(href);
    await page.evaluate(() => window.scrollTo(0, 0));
    const failed = page.getByRole("main");
    await expect(failed.getByRole("heading", { name: copy.en.title, exact: true })).toBeVisible();
    await expect(failed.getByRole("alert")).toContainText(copy.en.unavailable);
    await expect(failed.getByText(longUrl)).toHaveCount(0);
    await expect(failed.getByText(versionTitle)).toHaveCount(0);
    await expect(failed.getByText(publicationId)).toHaveCount(0);
    await expect(failed.getByText(claimedAt)).toHaveCount(0);
    const reload = failed.getByRole("link", { name: copy.en.reload, exact: true });
    await expect(reload).toBeInViewport();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${shots}/content-publication-failure-en-375.png`, fullPage: false });
    await context.clearCookies({ name: "geo-content-publication-unavailable" });
    await activateFromKeyboard(page, reload);
    await expect(page.getByText("access_limited", { exact: true })).toBeVisible();
    await expect(page.locator("section").filter({ hasText: copy.en.url }).getByText(longUrl, { exact: true })).toBeVisible();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.setViewportSize({ width: 375, height: 800 });
    await stranger.goto(href);
    await expect(stranger.getByRole("heading", { name: copy.en.missing, exact: true })).toBeVisible();
    await expect(stranger.getByText(longUrl)).toHaveCount(0);
    await expect(stranger.getByText(versionTitle)).toHaveCount(0);
    await expect(stranger.getByText(publicationId)).toHaveCount(0);
    await expectNoOverflow(stranger);
    await stranger.screenshot({ path: `${shots}/content-publication-hidden-en-375.png`, fullPage: false });

    const contentCommand = (data: object) => context.request.post("/api/content", { headers: { Origin: origin }, data });
    const checkPublic = (id: string) => contentCommand({
      action: "verify-publication", brandId, publicationId: id, operationId: randomUUID(),
      fixturePage: { accessClass: "public", httpStatus: 200, title: "合成报价", bodyText: factFields.claim },
    });
    const readRecord = async (id: string) => {
      const result = await context.request.get(`/api/content/publications/${id}`);
      expect(result.ok(), result.ok() ? "" : await result.text()).toBeTruthy();
      return (await result.json()).publication;
    };
    const verified = await checkPublic(publicationId);
    expect(verified.ok(), verified.ok() ? "" : await verified.text()).toBeTruthy();
    const original = await readRecord(publicationId);
    expect(original).toMatchObject({ status: "verified_public", evidenceGrade: "public", supersededBy: null });
    expect(original.effectiveAt).toEqual(expect.any(String));
    const versionHref = `/dashboard/content/versions/${versionId}`;
    for (const locale of ["zh-CN", "en"] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(versionHref);
        const predecessor = page.getByRole("combobox", { name: copy[locale].predecessorField });
        await expect(predecessor).toBeVisible();
        await expect(predecessor).toHaveValue("");
        await expect(page.locator(`#publication-predecessors option[value="${publicationId}"]`)).toHaveAttribute("label", new RegExp("合成账号"));
        await expectNoOverflow(page);
      }
    }
    await page.setViewportSize({ width: 375, height: 800 });
    const backfill = page.locator("#publication-backfill");
    await backfill.getByLabel(copy.en.url, { exact: true }).fill(longUrl);
    await backfill.getByLabel("Target account / page ownership").fill("合成账号");
    await backfill.getByLabel("User-claimed publish time").fill(claimedAt);
    await backfill.getByLabel("Channel declaration").fill("合成渠道，仅隔离验收");
    const predecessor = backfill.getByRole("combobox", { name: copy.en.predecessorField });
    await predecessor.focus();
    await page.keyboard.insertText(publicationId);
    await expect(predecessor).toHaveValue(publicationId);
    await activateFromKeyboard(page, backfill.getByRole("button", { name: copy.en.submitBackfill, exact: true }));
    await expect(page).toHaveURL(/\/dashboard\/content\/publications\/[0-9a-f-]{36}$/);
    const updateId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    expect(updateId).not.toBe(publicationId);
    const updateHref = `/dashboard/content/publications/${updateId}`;
    await expect(page.getByRole("link", { name: copy.en.predecessorPending })).toHaveAttribute("href", href);
    expect(await readRecord(updateId)).toMatchObject({ predecessorId: publicationId, status: "submitted", effectiveAt: null });
    expect(await readRecord(publicationId)).toMatchObject({ supersededBy: null, effectiveAt: original.effectiveAt });

    const restricted = await contentCommand({
      action: "verify-publication", brandId, publicationId: updateId, operationId: randomUUID(),
      fixturePage: { accessClass: "login_wall", httpStatus: 200, title: "合成报价", bodyText: factFields.claim },
    });
    expect(restricted.ok(), restricted.ok() ? "" : await restricted.text()).toBeTruthy();
    expect(await readRecord(updateId)).toMatchObject({ status: "access_limited", effectiveAt: null });
    expect(await readRecord(publicationId)).toMatchObject({ supersededBy: null, effectiveAt: original.effectiveAt });
    const manual = await contentCommand({
      action: "submit-manual-evidence", brandId, publicationId: updateId, operationId: randomUUID(),
      screenshotRef: "isolated-evidence", pageMarker: longUrl, observedAt: claimedAt, bodyExcerpt: factFields.claim,
    });
    expect(manual.ok(), manual.ok() ? "" : await manual.text()).toBeTruthy();
    const replacement = await readRecord(updateId);
    expect(replacement).toMatchObject({ predecessorId: publicationId, status: "verified_manual", evidenceGrade: "manual" });
    expect(replacement.effectiveAt).toEqual(expect.any(String));
    expect(replacement.approvalId).toBe(original.approvalId);
    expect(await readRecord(publicationId)).toMatchObject({ supersededBy: updateId, effectiveAt: original.effectiveAt, evidenceGrade: "public" });
    for (const locale of ["zh-CN", "en"] as const) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(updateHref);
        await expect(page.getByText("verified_manual", { exact: true })).toBeVisible();
        await expect(page.getByText(replacement.effectiveAt, { exact: true })).toBeVisible();
        await expect(page.getByText(replacement.approvalId, { exact: true })).toBeVisible();
        const previous = page.getByRole("link", { name: copy[locale].predecessor, exact: true });
        await expect(previous).toHaveAttribute("href", href);
        await expectNoOverflow(page);
        if (width === 375) {
          await expect(previous).toBeInViewport();
          await page.screenshot({ path: `${replacementShots}/successor-${locale}-375.png` });
          await activateFromKeyboard(page, previous);
          await expect(page).toHaveURL(href);
          const next = page.getByRole("link", { name: copy[locale].successor, exact: true });
          await expect(next).toHaveAttribute("href", updateHref);
          await expect(next).toBeInViewport();
          await expect(page.getByText(original.effectiveAt, { exact: true })).toBeVisible();
          await page.screenshot({ path: `${replacementShots}/predecessor-${locale}-375.png` });
        }
      }
    }
    console.log("#171 browser/API fixture", JSON.stringify({
      previous: publicationId.slice(0, 8), successor: updateId.slice(0, 8), approval: original.approvalId.slice(0, 8),
      before: { supersededBy: null, successorStatus: "submitted", successorEffectiveAt: null },
      after: { previousEffectiveAt: original.effectiveAt, successorEffectiveAt: replacement.effectiveAt, grades: ["public", "manual"] },
    }));
  } finally {
    await outsider.close();
    for (const account of accounts) {
      execFileSync(process.execPath, [
        "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
        JSON.stringify(account),
      ], { stdio: "inherit" });
    }
  }
});
