import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const path = "/dashboard/settings/delegations";
const api = "/api/settings/delegations";
const headers = { Origin: origin };
const shots = ".cache/issue-135/delegations";
const probeCookie = "geo-delegations-read";
const brandName = `Fixture-${"brand".repeat(13)}`;
const evidenceId = `evidence-${"x".repeat(55)}`;
const locales = ["zh-CN", "en"] as const;
const widths = [375, 768, 1440];
const en: typeof import("../../src/lib/i18n/messages/en.json") = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
const zhCN: typeof import("../../src/lib/i18n/messages/zh-CN.json") = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
const messages = { "zh-CN": zhCN, en };
const zh = zhCN.delegations;

type Locale = typeof locales[number];

async function register(context: BrowserContext) {
  const email = `delegation-${randomUUID()}@example.invalid`;
  const response = await registerTestAccount(context, {
    name: "Delegation fixture", email, password: randomBytes(24).toString("base64url"),
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

async function visit(page: Page, locale: Locale, width: number, viaSettings = false) {
  await page.context().addCookies([{ name: "geo-locale", value: locale, url: origin }]);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(viaSettings ? "/dashboard/settings" : path);
  if (viaSettings) {
    await activate(page, page.getByRole("link", { name: messages[locale].settings.openDelegations, exact: true }));
  }
  await expect(page).toHaveURL(origin + path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator('[data-workspace-section="settings"]')).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 1, name: messages[locale].delegations.title, exact: true })).toBeVisible();
}

async function checkLayout(page: Page, actionName: string, width: number, shot: string) {
  const action = page.getByRole("main").getByRole("link", { name: actionName, exact: true });
  await expect(action).toBeInViewport({ ratio: 1 });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width !== 768) await page.screenshot({ path: `${shots}/${shot}-${width}.png`, animations: "disabled" });
}

async function failOnce(page: Page, endpoint: string) {
  await page.route(`**${endpoint}`, (route) => route.fulfill({
    status: 503, json: { error: { code: "SERVICE_UNAVAILABLE" } },
  }), { times: 1 });
}

test("brand owners register and end scoped access, and agency members can see the effect", async ({ context, page, browser }) => {
  test.setTimeout(180_000);
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Brand delegation browser tests require a loopback PostgreSQL database");
  }
  const sql = postgres(databaseURL, { max: 1 });
  const agency = await browser.newContext({ baseURL: origin });
  const outsider = await browser.newContext({ baseURL: origin });
  const accounts: Awaited<ReturnType<typeof register>>[] = [];
  const org = randomUUID();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  let createdBrandId: string | undefined;
  try {
    const owner = await register(context);
    accounts.push(owner);
    const member = await register(agency);
    accounts.push(member, await register(outsider));
    const brand = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(), target: null, expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName, description: "Synthetic brand for delegation testing.",
          website: "https://delegation.example.com", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(brand.status()).toBe(200);
    const brandId: string = (await brand.json()).id;
    createdBrandId = brandId;
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/);
    const stored = () => sql`
      select d.id, d.active, d.scope, d.expires_at, d.expired_at, a.id as action_id, a.status
      from brand_delegation d join delegation_action a on a.delegation_id = d.id
      where d.brand_id = ${brandId} and d.organization_id = ${org}`;

    const main = page.getByRole("main");
    const agencyPage = await agency.newPage();
    for (const locale of locales) {
      const copy = messages[locale].delegations;
      for (const width of widths) {
        await visit(page, locale, width, width === 375);
        await expect(main.getByText(copy.emptyManaged, { exact: true })).toBeVisible();
        await checkLayout(page, copy.startRegistration, width, `empty-owner-${locale}`);
        await visit(agencyPage, locale, width);
        await expect(agencyPage.getByText(copy.noBrands, { exact: true })).toBeVisible();
        await expect(agencyPage.getByRole("form", { name: copy.delegationTitle, exact: true })).toHaveCount(0);
        await checkLayout(agencyPage, copy.startMembership, width, `empty-agency-${locale}`);
      }
    }

    await visit(agencyPage, "zh-CN", 375);
    await activate(agencyPage, agencyPage.getByRole("link", { name: zh.startMembership, exact: true }));
    const members = agencyPage.getByRole("form", { name: zh.membershipTitle, exact: true });
    const memberOrg = members.getByRole("textbox", { name: zh.organizationId, exact: true });
    await expect(memberOrg).toBeFocused();
    await memberOrg.fill(org);
    await members.getByRole("textbox", { name: zh.userId, exact: true }).fill(member.userId);
    await activate(agencyPage, members.getByRole("button", { name: zh.registerMembership, exact: true }));
    await expect(members.getByRole("status")).toHaveText(zh.saved);
    const memberships = () => sql`select user_id, active from agency_membership where organization_id = ${org}`;
    expect(await memberships()).toEqual([{ user_id: member.userId, active: 1 }]);

    await visit(page, "zh-CN", 375);
    const form = main.getByRole("form", { name: zh.delegationTitle, exact: true });
    const brandField = form.getByRole("combobox", { name: zh.brand, exact: true });
    const submit = form.getByRole("button", { name: zh.registerDelegation, exact: true });
    await activate(page, main.getByRole("link", { name: zh.startRegistration, exact: true }));
    await expect(brandField).toBeFocused();
    await expect(brandField).toHaveValue(brandId);
    await form.getByRole("textbox", { name: zh.organizationId, exact: true }).fill(org);
    await form.getByRole("textbox", { name: zh.expiresAtUtc, exact: true }).fill(expiresAt);
    await form.getByRole("textbox", { name: zh.scope, exact: true }).fill("Invalid-Id");
    await activate(page, submit);
    await expect(form.getByRole("status")).toHaveText(zh.INVALID_INPUT);
    expect(await stored()).toHaveLength(0);
    await form.getByRole("textbox", { name: zh.scope, exact: true }).fill(evidenceId);
    await failOnce(page, api);
    await activate(page, submit);
    await expect(form.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(submit).toBeFocused();
    expect(await stored()).toHaveLength(0);

    await page.getByRole("combobox", { name: zhCN.common.language, exact: true }).selectOption("en");
    const englishForm = main.getByRole("form", { name: en.delegations.delegationTitle, exact: true });
    await expect(englishForm.getByRole("status")).toHaveText(en.delegations.SERVICE_UNAVAILABLE);
    await expect(englishForm.getByRole("textbox", { name: en.delegations.scope, exact: true })).toHaveValue(evidenceId);
    await expect(englishForm.getByRole("textbox", { name: en.delegations.expiresAtUtc, exact: true })).toHaveValue(expiresAt);
    await expect(englishForm.getByRole("textbox", { name: en.delegations.organizationId, exact: true })).toHaveValue(org);
    await activate(page, englishForm.getByRole("button", { name: en.delegations.registerDelegation, exact: true }));
    await expect(englishForm.getByRole("status")).toHaveText(en.delegations.saved);
    await expect(englishForm.getByRole("textbox", { name: en.delegations.scope, exact: true })).toHaveValue("");
    const registered = await stored();
    expect(registered).toMatchObject([{ active: 1, scope: evidenceId, expires_at: expiresAt, expired_at: null, status: "queued" }]);
    const delegationId: string = registered[0].id;
    const actionId: string = registered[0].action_id;
    const expirePath = `${api}/${delegationId}/expire`;
    const actionPath = `${api}/actions/${actionId}/execute`;
    const brandPath = `${api}/portfolio?brandId=${brandId}`;
    const ownerCard = main.getByRole("article", { name: brandName, exact: true });
    const ownerHeading = ownerCard.getByRole("heading", { name: brandName, exact: true });
    const portfolio = agencyPage.getByRole("article", { name: brandId, exact: true });

    for (const locale of locales) {
      const copy = messages[locale].delegations;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(ownerCard.getByText(copy.statusActive, { exact: true })).toBeVisible();
        await expect(ownerCard.getByText(org, { exact: true })).toBeVisible();
        await expect(ownerCard.locator("time")).toHaveAttribute("datetime", expiresAt);
        await checkLayout(page, copy.manageDelegations, width, `active-owner-${locale}`);
        await visit(agencyPage, locale, width);
        await expect(portfolio.getByText(copy.summaryVisible, { exact: true })).toBeVisible();
        await expect(portfolio.getByText(evidenceId, { exact: true })).toBeVisible();
        await expect(portfolio).not.toContainText(brandName);
        await checkLayout(agencyPage, copy.viewPortfolio, width, `active-agency-${locale}`);
      }
    }
    const scoped = await agency.request.get(brandPath, { headers });
    expect(scoped.status()).toBe(200);
    expect(await scoped.json()).toMatchObject({ summary: "visible", evidenceIds: [evidenceId] });
    expect((await outsider.request.get(brandPath, { headers })).status()).toBe(404);
    expect((await outsider.request.post(expirePath, { headers, data: {} })).status()).toBe(404);
    expect((await outsider.request.post(actionPath, { headers, data: {} })).status()).toBe(404);
    expect(await stored()).toEqual(registered);

    for (const locale of locales) {
      const copy = messages[locale].delegations;
      await visit(page, locale, 375);
      await activate(page, main.getByRole("link", { name: copy.manageDelegations, exact: true }));
      await expect(main.getByRole("heading", { name: copy.managedTitle, exact: true })).toBeFocused();
      const expire = ownerCard.getByRole("button", { name: copy.expire, exact: true });
      await activate(page, expire);
      const dialog = page.getByRole("dialog", { name: copy.expire, exact: true });
      await expect(dialog.getByRole("button", { name: copy.cancel, exact: true })).toBeFocused();
      await expect(dialog).toHaveAccessibleDescription(copy.expireImpact);
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${shots}/confirm-${locale}-375.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(expire).toBeFocused();
      expect(await stored()).toEqual(registered);
    }

    await visit(page, "zh-CN", 375);
    await activate(page, ownerCard.getByRole("button", { name: zh.expire, exact: true }));
    const dialog = page.getByRole("dialog", { name: zh.expire, exact: true });
    const confirm = dialog.getByRole("button", { name: zh.confirmExpiry, exact: true });
    await failOnce(page, expirePath);
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText(zh.SERVICE_UNAVAILABLE);
    await expect(confirm).toBeFocused();
    expect(await stored()).toEqual(registered);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(ownerHeading).toBeFocused();
    await expect(ownerCard.getByText(zh.statusEnded, { exact: true })).toBeVisible();
    await expect(ownerCard.getByRole("button", { name: zh.expire, exact: true })).toHaveCount(0);
    const ended = await stored();
    expect(ended).toEqual([{ ...registered[0], active: 0, expired_at: expect.any(String), status: "stopped" }]);
    expect(await memberships()).toEqual([{ user_id: member.userId, active: 1 }]);
    const refused = await agency.request.get(brandPath, { headers });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: "grant" });
    const deniedAction = await agency.request.post(actionPath, { headers, data: {} });
    expect(deniedAction.status()).toBe(200);
    const result = await deniedAction.json();
    expect(result).toMatchObject({ reason: "grant", action: { id: actionId, status: "stopped" } });
    expect(result).not.toHaveProperty("evidenceIds");
    expect(await stored()).toEqual(ended);

    for (const locale of locales) {
      const copy = messages[locale].delegations;
      for (const width of widths) {
        await visit(page, locale, width);
        await expect(ownerCard.getByText(copy.statusEnded, { exact: true })).toBeVisible();
        await checkLayout(page, copy.reviewHistory, width, `ended-owner-${locale}`);
        await visit(agencyPage, locale, width);
        await expect(portfolio.getByText(copy.summaryBlocked, { exact: true })).toBeVisible();
        await expect(portfolio).not.toContainText(evidenceId);
        await expect(portfolio.getByRole("button", { name: copy.execute, exact: true })).toBeDisabled();
        await checkLayout(agencyPage, copy.viewPortfolio, width, `blocked-agency-${locale}`);
      }

      await visit(page, locale, 375);
      await context.addCookies([{ name: probeCookie, value: "slow", url: origin }]);
      await page.reload({ waitUntil: "commit" });
      await expect(main.getByRole("status").filter({ hasText: copy.loading })).toBeInViewport();
      await page.screenshot({ path: `${shots}/loading-${locale}-375.png` });
      await expect(ownerCard).toBeVisible();
      await context.addCookies([{ name: probeCookie, value: "unavailable", url: origin }]);
      await visit(page, locale, 375);
      await expect(main.getByRole("alert")).toHaveText(copy.SERVICE_UNAVAILABLE);
      await expect(main.getByRole("form")).toHaveCount(0);
      for (const hidden of [brandName, org, "Private brand delegation fixture failure"]) await expect(main).not.toContainText(hidden);
      await checkLayout(page, copy.reload, 375, `failure-${locale}`);
      await context.clearCookies({ name: probeCookie });
      await activate(page, main.getByRole("link", { name: copy.reload, exact: true }));
      await expect(ownerCard.getByText(copy.statusEnded, { exact: true })).toBeVisible();
    }

    const otherOrg = randomUUID();
    expect((await agency.request.post(api, { headers, data: { organizationId: otherOrg, userId: member.userId } })).status()).toBe(200);
    const secondGrant = await context.request.post(api, { headers, data: { brandId, organizationId: otherOrg, expiresAt, scope: evidenceId } });
    expect(secondGrant.status()).toBe(200);
    const naturallyExpiring: string = (await secondGrant.json()).delegation.id;
    // Advance only this fixture's expiry to exercise the clock-driven state without waiting a day.
    const elapsed = new Date(Date.now() - 1000).toISOString();
    expect(await sql`update brand_delegation set expires_at = ${elapsed} where id = ${naturallyExpiring} and brand_id = ${brandId} returning id`).toHaveLength(1);
    await visit(page, "en", 375);
    await expect(ownerCard.filter({ hasText: otherOrg }).getByText(en.delegations.statusExpired, { exact: true })).toBeVisible();
    expect((await agency.request.get(brandPath, { headers })).status()).toBe(403);
  } finally {
    await agency.close();
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
                 exists (select 1 from agency_membership where user_id = ${userId}) as membership`;
        expect(remaining).toEqual({ account: false, brand: false, membership: false });
      }
      if (createdBrandId) {
        expect(await sql`select 1 from brand_version where brand_id = ${createdBrandId}`).toHaveLength(0);
        expect(await sql`select 1 from brand_delegation where brand_id = ${createdBrandId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
