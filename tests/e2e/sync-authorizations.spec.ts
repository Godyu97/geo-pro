import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/settings/sync-authorizations";
const api = "/api/settings/sync-authorizations";
const headers = { Origin: origin };
const shots = ".cache/issue-135/sync-authorizations";
const brandName = `Synthetic-${"brand".repeat(14)}`;

const sourceName = `Fixture-${"source".repeat(12)}`;
const probeCookie = "geo-sync-authorizations-read";
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const zhCN: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const copy = { "zh-CN": zhCN.syncAuthorizations, en: en.syncAuthorizations };

async function register(context: BrowserContext) {
  const email = `sync-authorizations-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Sync authorization visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  return { userId: (await response.json()).user.id as string, email };
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function visit(page: Page, locale: keyof typeof copy, width: number, viaSettings = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaSettings ? "/dashboard/settings" : path);
  if (viaSettings) {
    const settings = locale === "zh-CN" ? zhCN.settings : en.settings;
    await activate(page, page.getByRole("link", { name: settings.openSyncAuthorizations, exact: true }));
  }
  await expect(page).toHaveURL(`${origin}${path}`);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: copy[locale].title, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(copy[locale].title));
  return main;
}

async function checkLayout(page: Page, action: Locator, width: number, shot: string) {
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 375 || width === 1440) await page.screenshot({ path: `${shots}/${shot}-${width}.png` });
}

function nextResponse(page: Page, endpoint: string) {
  return page.waitForResponse((response) => response.url() === origin + endpoint && response.request().method() === "POST", { timeout: 10_000 });
}

test("sync authorizations have a keyboard path and retain history after revocation", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Sync authorization browser tests require a local PostgreSQL database");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  let brandId: string | undefined;
  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    const brand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "Synthetic brand for sync authorizations.",
          website: "https://sync-authorizations.example.com", aliases: [],
          region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const createdBrand: string = (await brand.json()).id;
    expect(createdBrand).toMatch(/^[0-9a-f-]{36}$/);
    brandId = createdBrand;
    const retainedRows = 1234;
    const readStored = async () => ({
      grants: await sql`select id, brand_id, source_name, revoked, retained_rows, history_deleted, updated_at
        from sync_authorization where owner_id = ${owner.userId}`,
      attempts: await sql`select id, authorization_id, result, attempted_at from sync_attempt
        where owner_id = ${owner.userId} order by attempted_at, id`,
    });
    const main = page.getByRole("main");
    const card = main.getByRole("article", { name: sourceName, exact: true });
    const heading = card.getByRole("heading", { name: sourceName, exact: true });
    const zh = copy["zh-CN"];

    for (const locale of locales) {
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByText(copy[locale].empty, { exact: true })).toBeVisible();
        await expect(main.getByText(copy[locale].fixtureNote, { exact: true })).toBeVisible();
        await checkLayout(page, main.getByRole("link", { name: copy[locale].startRegistration, exact: true }), width, `empty-${locale}`);
      }
    }

    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.register });
    const brandField = form.getByRole("combobox", { name: zh.brand, exact: true });
    await activate(page, main.getByRole("link", { name: "开始登记", exact: true }));
    await expect(brandField).toBeFocused();
    expect(await brandField.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    await expect(brandField).toHaveValue(createdBrand);
    const source = form.getByLabel(zh.sourceName, { exact: true });
    const retained = form.getByLabel(zh.retainedRows, { exact: true });
    const submit = form.getByRole("button", { name: zh.register, exact: true });
    await source.fill(sourceName);
    await retained.fill("-1");
    await activate(page, submit);
    expect(await retained.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
    expect(await readStored()).toEqual({ grants: [], attempts: [] });
    await retained.fill(String(retainedRows));

    await page.route(`**${api}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
    }), { times: 1 });
    await activate(page, submit);
    await expect(form.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(submit).toBeFocused();
    await expect(source).toHaveValue(sourceName);
    expect(await readStored()).toEqual({ grants: [], attempts: [] });
    await page.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishForm = main.getByRole("form", { name: en.syncAuthorizations.register });
    await expect(englishForm.getByRole("status")).toHaveText(en.syncAuthorizations.SERVICE_UNAVAILABLE);
    await expect(englishForm.getByLabel(en.syncAuthorizations.sourceName, { exact: true })).toHaveValue(sourceName);
    await expect(englishForm.getByLabel(en.syncAuthorizations.retainedRows, { exact: true })).toHaveValue(String(retainedRows));
    const registered = nextResponse(page, api);
    await activate(page, englishForm.getByRole("button", { name: en.syncAuthorizations.register }));
    expect((await registered).status()).toBe(200);
    await expect(englishForm.getByRole("status")).toHaveText(en.syncAuthorizations.saved);
    await expect(englishForm.getByLabel(en.syncAuthorizations.sourceName, { exact: true })).toHaveValue("");
    await expect(heading).toBeVisible();
    const created = await readStored();
    expect(created.grants).toHaveLength(1);
    expect(created.grants[0]).toMatchObject({
      brand_id: createdBrand, source_name: sourceName, revoked: 0, retained_rows: retainedRows, history_deleted: 0,
    });
    expect(created.attempts).toEqual([]);
    const id: string = created.grants[0].id;
    const pullPath = `${api}/${id}/pull`;
    const revokePath = `${api}/${id}/revoke`;

    async function checkRecord(state: "active" | "revoked") {
      for (const locale of locales) {
        const labels = copy[locale];
        for (const width of widths) {
          await visit(page, locale, width);
          await expect(card.getByText(brandName, { exact: true })).toBeVisible();
          await expect(card.getByText(state === "active" ? labels.statusActive : labels.statusRevoked, { exact: true })).toBeVisible();
          await expect(card.getByText(labels.historyKept, { exact: true })).toBeVisible();
          await expect(card.getByText(labels.retainedCount.replace("{count}", "1,234"), { exact: true })).toBeVisible();
          const review = main.getByRole("link", { name: state === "active" ? labels.reviewActive : labels.reviewHistory, exact: true });
          await checkLayout(page, review, width, `${state}-${locale}`);
          if (width === 375) {
            await activate(page, review);
            await expect(heading).toBeFocused();
            await expect(heading).toBeInViewport({ ratio: 1 });
            expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            if (state === "active") {
              const trigger = card.getByRole("button", { name: labels.revoke, exact: true });
              await activate(page, trigger);
              const dialog = page.getByRole("dialog", { name: labels.revoke });
              await expect(dialog.getByRole("button", { name: labels.cancel, exact: true })).toBeFocused();
              await expect(dialog).toContainText(labels.confirmDescription.replace("{source}", sourceName));
              await expect(dialog.getByRole("button", { name: labels.confirmRevoke, exact: true })).toBeInViewport({ ratio: 1 });
              await page.screenshot({ path: `${shots}/confirm-${locale}-375.png` });
              await page.keyboard.press("Escape");
              await expect(dialog).toHaveCount(0);
              await expect(trigger).toBeFocused();
            }
          }
          if (state === "revoked") {
            await expect(card.getByRole("listitem")).toHaveCount(2);
            await expect(card.getByText(labels.resultAllowed, { exact: true })).toBeVisible();
            await expect(card.getByText(labels.resultStopped, { exact: true })).toBeVisible();
          }
        }
      }
    }
    await checkRecord("active");
    expect(await readStored()).toEqual(created);

    await visit(page, "zh-CN", 375);
    await activate(page, main.getByRole("link", { name: zh.reviewActive, exact: true }));
    await page.keyboard.press("Tab");
    const pull = card.getByRole("button", { name: zh.pull, exact: true });
    await expect(pull).toBeFocused();
    const allowedResponse = nextResponse(page, pullPath);
    await page.keyboard.press("Enter");
    expect((await allowedResponse).status()).toBe(200);
    await expect(card.getByRole("status")).toHaveText(zh.pullSaved);
    await expect(card.getByText(zh.resultAllowed, { exact: true })).toBeVisible();
    const allowed = await readStored();
    expect(allowed.grants).toEqual(created.grants);
    expect(allowed.attempts).toMatchObject([{ authorization_id: id, result: "allowed" }]);

    const revoke = card.getByRole("button", { name: zh.revoke, exact: true });
    await activate(page, revoke);
    const dialog = page.getByRole("dialog", { name: zh.revoke });
    const cancel = dialog.getByRole("button", { name: zh.cancel, exact: true });
    const confirm = dialog.getByRole("button", { name: zh.confirmRevoke, exact: true });
    await expect(cancel).toBeFocused();
    await expect(dialog).toContainText(zh.confirmDescription.replace("{source}", sourceName));
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(revoke).toBeFocused();
    expect(await readStored()).toEqual(allowed);

    await page.keyboard.press("Enter");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.route(`**${revokePath}`, (route) => route.fulfill({
      status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
    }), { times: 1 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await readStored()).toEqual(allowed);
    const revokedResponse = nextResponse(page, revokePath);
    await page.keyboard.press("Enter");
    expect((await revokedResponse).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(heading).toBeFocused();
    await expect(card.getByText(zh.statusRevoked, { exact: true })).toBeVisible();
    await expect(card.getByRole("status")).toHaveText(zh.revocationSaved);
    await expect(revoke).toHaveCount(0);
    const revoked = await readStored();
    expect(revoked.grants).toMatchObject([{ id, revoked: 1, retained_rows: retainedRows, history_deleted: 0 }]);
    expect(revoked.attempts).toEqual(allowed.attempts);

    await page.keyboard.press("Tab");
    await expect(pull).toBeFocused();
    const stoppedResponse = nextResponse(page, pullPath);
    await page.keyboard.press("Enter");
    expect((await stoppedResponse).status()).toBe(200);
    await expect(card.getByText(zh.resultStopped, { exact: true })).toBeVisible();
    await expect(card.getByText(zh.resultAllowed, { exact: true })).toBeVisible();
    const stored = await readStored();
    expect(stored.grants).toEqual(revoked.grants);
    expect(stored.attempts).toEqual([allowed.attempts[0], expect.objectContaining({ authorization_id: id, result: "stopped" })]);
    const repeated = await context.request.post(revokePath, { headers, data: {} });
    expect(repeated.status()).toBe(200);
    expect(await repeated.json()).toMatchObject({ authorization: {
      id, revoked: true, pull: false, retainedRows, historyDeleted: false,
      attempts: expect.arrayContaining(stored.attempts.map((attempt) => ({
        id: attempt.id, result: attempt.result, attemptedAt: attempt.attempted_at,
      }))),
    } });
    expect(await readStored()).toEqual(stored);
    await checkRecord("revoked");

    for (const locale of locales) {
      const labels = copy[locale];
      await visit(page, locale, 375);
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: labels.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(heading).toBeVisible();

      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(labels.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      await expect(main.getByRole("region", { name: labels.recordsTitle })).toHaveCount(0);
      for (const hidden of [brandName, sourceName, "Private sync authorizations fixture failure"]) {
        await expect(main).not.toContainText(hidden);
      }
      const reload = main.getByRole("link", { name: labels.reload, exact: true });
      await checkLayout(page, reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, reload);
      await expect(heading).toBeVisible();
      expect(await readStored()).toEqual(stored);
    }

    const otherPage = await outsider.newPage();
    for (const locale of locales) {
      for (const width of widths) {
        const otherMain = await visit(otherPage, locale, width);
        await expect(otherMain.getByText(copy[locale].noBrands, { exact: true })).toBeVisible();
        await expect(otherMain.getByRole("form")).toHaveCount(0);
        await expect(otherMain).not.toContainText(sourceName);
        await checkLayout(otherPage, otherMain.getByRole("link", { name: copy[locale].goBrands, exact: true }), width, `no-brand-${locale}`);
      }
    }
    await activate(otherPage, otherPage.getByRole("link", { name: copy.en.goBrands, exact: true }));
    await expect(otherPage).toHaveURL(`${origin}/dashboard/brands`);
    expect((await outsider.request.post(api, { headers, data: { brandId, sourceName, retainedRows } })).status()).toBe(404);
    for (const command of [revokePath, pullPath]) {
      expect((await outsider.request.post(command, { headers, data: {} })).status()).toBe(404);
    }
    expect(await readStored()).toEqual(stored);
  } finally {
    await outsider.close();
    try {
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
        const { userId, email } = account;
        const [remaining] = await sql`
          select exists (select 1 from "user" where email = ${email}) as account,
                 exists (select 1 from brand where owner_id = ${userId}) as brand,
                 exists (select 1 from sync_authorization where owner_id = ${userId}) as authorization,
                 exists (select 1 from sync_attempt where owner_id = ${userId}) as attempt`;
        expect(remaining).toEqual({ account: false, brand: false, authorization: false, attempt: false });
      }
      if (brandId) expect(await sql`select 1 from brand_version where brand_id = ${brandId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  }
});
