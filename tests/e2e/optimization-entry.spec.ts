import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { initialBrandFields } from "../../src/features/brands/contracts";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const baseURL = "http://localhost:3100";
const optimizationPath = "/dashboard/optimization";
const restrictedURL = `https://example.invalid/${"restricted".repeat(80)}`;
const taskTitle = "公开页面受限，待核验";
const copy = {
  "zh-CN": {
    title: "优化任务", location: "当前位置: 优化建议", brands: "前往品牌",
    evidence: "查看证据概览", open: "开放任务", checks: "公开页面检查", status: "待处理",
    missing: "未找到资源或无权访问。", empty: "暂无开放优化任务。",
    detail: "优化任务详情", back: "返回任务列表", update: "更新状态", state: "状态", rank: "名次",
    reason: "改序理由", completion: "完成说明 / 证据", dismiss: "驳回理由", save: "保存",
    invalid: "请检查状态更新要求后重试。", saved: "任务更新已保存。", savedDetails: "已保存的更新详情",
    pageRecords: "页面检查记录", restricted: "受限 · isolated-fixture", language: "界面语言", changed: "已记录修改",
  },
  en: {
    title: "Optimization tasks", location: "Current location: Optimization suggestions", brands: "Go to brands",
    evidence: "View evidence overview", open: "Open tasks", checks: "Public page checks", status: "To do",
    missing: "Resource not found or not accessible.", empty: "No open optimization tasks.",
    detail: "Optimization task detail", back: "Back to tasks", update: "Update status", state: "Status", rank: "Rank",
    reason: "Reason for changing rank", completion: "Completion note / evidence", dismiss: "Dismiss reason", save: "Save",
    invalid: "Review the status update requirements and try again.", saved: "Task update saved.", savedDetails: "Saved update details",
    pageRecords: "Page check records", restricted: "Restricted · isolated-fixture", language: "Interface language", changed: "Dismissed",
  },
} as const;

test("optimization entry prioritizes scoped tasks and recovery in both languages", async ({ page, context, browser }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const url = URL.parse(process.env.DATABASE_URL ?? "");
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Optimization browser tests require local PostgreSQL");
  }
  const sql = postgres(url.href, { max: 1 });
  const email = `optimization-${randomUUID()}@example.invalid`;
  const outsiderEmail = `optimization-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const main = page.getByRole("main");
  const locales = ["zh-CN", "en"] as const;
  const widths = [375, 768, 1440];

  const expectNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(main).toHaveCount(1);
  };

  try {
    const registered = await registerTestAccount(context, { name: "优化验收", email, password });
    expect(registered.status()).toBe(200);
    const { user } = await registered.json();

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(optimizationPath);
      await expect(main.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
      await expect(main.getByRole("link", { name: copy[locale].brands, exact: true })).toHaveAttribute("href", "/dashboard/brands");
      await expectNoOverflow();
    }

    const created = await context.request.post("/api/brands", {
      headers: { Origin: baseURL },
      data: {
        actorId: user.id, operationId: randomUUID(), action: "submit", target: null, expectedDraft: null,
        fields: { ...initialBrandFields, name: "优化验收品牌", description: "本地隔离验收使用的合成资料" },
        acceptedPolicyVersion: publishedRetentionVersion(),
      },
    });
    expect(created.status()).toBe(200);
    const { id: brandId } = await created.json();
    const scopedPath = `${optimizationPath}?brandId=${brandId}`;
    const overviewPath = `/dashboard/monitoring/overview?brandId=${brandId}`;

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(scopedPath);
        const evidence = main.getByRole("link", { name: copy[locale].evidence, exact: true });
        await expect(evidence).toHaveAttribute("href", overviewPath);
        await expect(evidence).toBeInViewport();
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expectNoOverflow();
        if (width === 375) {
          await page.screenshot({ path: testInfo.outputPath(`optimization-empty-${locale}.png`) });
          await evidence.focus();
          await expect(evidence).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(overviewPath);
        }
      }
    }

    await page.getByLabel("Public URLs (one per line)", { exact: true }).fill(restrictedURL);
    await main.getByRole("combobox", { name: "Isolated fixture status", exact: true }).selectOption("restricted");
    await page.getByLabel("Isolated fixture body (optional)", { exact: true }).fill("Synthetic fixture, no network request.");
    const check = main.getByRole("button", { name: "Run check", exact: true });
    await check.focus();
    await page.keyboard.press("Enter");
    await expect(main.getByRole("link", { name: taskTitle, exact: true })).toBeVisible();
    const detailPath = await main.getByRole("link", { name: taskTitle, exact: true }).getAttribute("href");
    expect(detailPath).toMatch(/\/dashboard\/optimization\/[0-9a-f-]{36}$/);
    const taskId = detailPath!.split("/").at(-1)!;

    const [record] = await sql`
      select public_status, access_condition from page_check_record
      where owner_id = ${user.id} and brand_id = ${brandId} and url = ${restrictedURL}
    `;
    expect(record).toEqual({ public_status: "restricted", access_condition: "isolated-fixture" });

    const linkedCheck = await context.request.post("/api/optimization/tasks", {
      headers: { Origin: baseURL },
      data: {
        action: "check-pages", brandId, taskId, operationId: randomUUID(), urls: [restrictedURL],
        fixtures: [{ url: restrictedURL, status: "restricted", accessCondition: "isolated-fixture" }],
      },
    });
    expect(linkedCheck.status()).toBe(200);

    for (const locale of locales) {
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(scopedPath);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByText(copy[locale].location, { exact: true })).toBeVisible();
        const open = main.getByRole("region", { name: copy[locale].open });
        const task = open.getByRole("link", { name: taskTitle, exact: true });
        await expect(open.getByText(copy[locale].status, { exact: true })).toBeVisible();
        await expect(open.getByText(restrictedURL, { exact: true })).toBeVisible();
        await expect(task).toBeInViewport();
        await expectNoOverflow();

        await main.getByRole("link", { name: copy[locale].evidence, exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(task).toBeFocused();
        await expect(task).not.toHaveCSS("box-shadow", "none");
        if (width === 375) {
          await page.screenshot({ path: testInfo.outputPath(`optimization-task-${locale}.png`) });
        }
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(detailPath!);
        await expect(main.getByRole("heading", { name: taskTitle, exact: true })).toBeVisible();
        const pageRecords = main.getByRole("region", { name: copy[locale].pageRecords, exact: true });
        await expect(pageRecords.getByText(copy[locale].restricted, { exact: true })).toBeVisible();
        const longText = main.getByText(restrictedURL, { exact: false });
        expect(await longText.count()).toBeGreaterThanOrEqual(3);
        for (const element of await longText.all()) {
          await expect(element).toBeVisible();
          expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        }
        await expectNoOverflow();

        const back = main.getByRole("link", { name: copy[locale].back, exact: true });
        const update = main.getByRole("link", { name: copy[locale].update, exact: true });
        await expect(back).toHaveAttribute("href", scopedPath);
        await expect(update).toBeInViewport();
        await back.focus();
        await page.keyboard.press("Tab");
        await expect(update).toBeFocused();
        await expect(update).not.toHaveCSS("box-shadow", "none");
        if (width === 375) {
          await page.screenshot({ path: testInfo.outputPath(`optimization-detail-${locale}.png`) });
        }
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(`${detailPath}#update-status`);
        await page.keyboard.press("Tab");
        await expect(main.getByRole("combobox", { name: copy[locale].state, exact: true })).toBeFocused();
        await expectNoOverflow();
      }
    }

    await page.setViewportSize({ width: 375, height: 900 });
    const note = `隔离完成说明 ${restrictedURL}`;
    const dismissal = "Synthetic dismissal reason";
    const readUpdate = async () => {
      const [task] = await sql`
        select status, completion_note, dismiss_reason, manual_rank, reorder_reason from optimization_task
        where owner_id = ${user.id} and brand_id = ${brandId} and id = ${taskId}
      `;
      return task;
    };
    let savedTask = await readUpdate();
    for (const locale of locales) {
      const localized = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
      await page.goto(detailPath!);
      const section = main.getByRole("region", { name: localized.update, exact: true });
      const status = section.getByRole("combobox", { name: localized.state, exact: true });
      const rank = section.getByRole("spinbutton", { name: localized.rank, exact: true });
      const reason = section.getByRole("textbox", { name: localized.reason, exact: true });
      const save = section.getByRole("button", { name: localized.save, exact: true });
      const nextStatus = locale === "zh-CN" ? "implemented" : "dismissed";
      const nextRank = locale === "zh-CN" ? 2 : 3;
      const nextReason = `Synthetic rank reason ${nextRank}`;
      await status.selectOption(nextStatus);
      await rank.fill(String(nextRank));
      await reason.fill(nextReason);
      await reason.focus();
      await page.keyboard.press("Tab");
      await expect(save).toBeFocused();
      await expect(save).not.toHaveCSS("box-shadow", "none");
      await page.keyboard.press("Enter");
      const invalid = section.getByRole("alert").filter({ hasText: localized.invalid });
      await expect(invalid).toBeVisible();
      expect(await readUpdate()).toEqual(savedTask);
      await expect(status).toHaveValue(nextStatus);
      await expect(rank).toHaveValue(String(nextRank));
      await expect(reason).toHaveValue(nextReason);
      await invalid.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`optimization-detail-invalid-${locale}.png`) });

      if (locale === "zh-CN") {
        await page.getByRole("combobox", { name: localized.language, exact: true }).selectOption("en");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page).toHaveURL(detailPath!);
        await expect(main.getByRole("spinbutton", { name: copy.en.rank, exact: true })).toHaveValue(String(nextRank));
        await expect(main.getByRole("alert").filter({ hasText: copy.en.invalid })).toBeVisible();
        await page.getByRole("combobox", { name: copy.en.language, exact: true }).selectOption("zh-CN");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      }

      const requiredLabel = locale === "zh-CN" ? localized.completion : localized.dismiss;
      await section.getByRole("textbox", { name: requiredLabel, exact: true }).fill(locale === "zh-CN" ? note : dismissal);
      await save.focus();
      await page.keyboard.press("Enter");
      const saved = section.getByRole("status").filter({ hasText: localized.saved });
      await expect(saved).toBeVisible();
      await expect(main.locator("header").getByText(localized.changed, { exact: true })).toBeVisible();
      await expect(invalid).toHaveCount(0);
      savedTask = {
        status: nextStatus, completion_note: note, dismiss_reason: locale === "en" ? dismissal : null,
        manual_rank: nextRank, reorder_reason: nextReason,
      };
      expect(await readUpdate()).toEqual(savedTask);
      await saved.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`optimization-detail-saved-${locale}.png`) });
      await page.reload();
      await expect(status).toHaveValue(nextStatus);
      const savedDetails = section.getByRole("group", { name: localized.savedDetails, exact: true });
      await expect(savedDetails.getByText(note, { exact: true })).toBeVisible();
      await expect(savedDetails.getByText(nextReason, { exact: true })).toBeVisible();
      await expectNoOverflow();
    }

    const outsider = await browser.newContext({ baseURL });
    try {
      const other = await registerTestAccount(outsider, { name: "优化隔离验收", email: outsiderEmail, password });
      expect(other.status()).toBe(200);
      const denied = await outsider.newPage();
      await denied.setViewportSize({ width: 375, height: 900 });
      for (const locale of locales) {
        await outsider.addCookies([{ name: "geo-locale", value: locale, url: baseURL }]);
        await denied.goto(scopedPath);
        await expect(denied.getByRole("heading", { name: copy[locale].title, exact: true })).toBeVisible();
        await expect(denied.getByRole("alert").filter({ hasText: copy[locale].missing })).toBeVisible();
        await expect(denied.getByRole("link", { name: copy[locale].brands, exact: true })).toHaveAttribute("href", "/dashboard/brands");
        await expect(denied.getByRole("link", { name: taskTitle, exact: true })).toHaveCount(0);
        await expect(denied.getByRole("heading", { name: copy[locale].checks, exact: true })).toHaveCount(0);

        for (const path of [detailPath!, `${optimizationPath}/${randomUUID()}`]) {
          await denied.goto(path);
          const deniedMain = denied.getByRole("main");
          await expect(deniedMain).toHaveCount(1);
          await expect(deniedMain.getByRole("heading", { name: copy[locale].detail, exact: true })).toBeVisible();
          await expect(deniedMain.getByRole("alert").filter({ hasText: copy[locale].missing })).toBeVisible();
          await expect(deniedMain.getByRole("link", { name: copy[locale].back, exact: true })).toHaveAttribute("href", optimizationPath);
          await expect(deniedMain.getByText(restrictedURL, { exact: false })).toHaveCount(0);
          await expect(deniedMain.getByRole("button", { name: copy[locale].save, exact: true })).toHaveCount(0);
        }
      }
    } finally {
      await outsider.close();
    }
  } finally {
    try {
      await sql`delete from "user" where email in (${email}, ${outsiderEmail})`;
    } finally {
      await sql.end();
    }
  }
});
