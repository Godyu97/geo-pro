import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { initialBrandFields } from "../src/features/brands/contracts.ts";
import { changeMaintenanceGrant } from "../src/features/maintenance/core.ts";
import { applyQuotaLedger } from "../src/features/quotas/ledger.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const baseURL = "http://localhost:3107";
const quotaPath = "/api/maintenance/quotas";
const settingsPath = "/dashboard/settings?source=pilot#pilot-quotas";

async function signUp(browser, name) {
  const context = await browser.newContext({ baseURL });
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: { Origin: baseURL },
    data: { name, email: randomUUID() + "@example.invalid", password: randomBytes(24).toString("base64url") },
  });
  assert.equal(response.status(), 200);
  await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
  return { context, id: (await response.json()).user.id };
}

async function brandFor({ context, id }) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: baseURL },
    data: {
      action: "submit", target: null, expectedDraft: null, actorId: id, operationId: randomUUID(),
      fields: { ...initialBrandFields, name: "Synthetic quota brand", description: "Synthetic test data for the quota fixture" },
    },
  });
  assert.equal(response.status(), 200);
  return (await response.json()).id;
}

function change(context, data, origin = baseURL) {
  return context.request.post(quotaPath, { headers: { Origin: origin }, data });
}

async function reject(response, status, code) {
  assert.equal(response.status(), status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(body), /Synthetic quota brand|INSERT|SELECT|session_token/);
  return body;
}

async function accessFor(db, account, action, permission) {
  const result = await changeMaintenanceGrant(db, {
    action, operatorId: account.id, userId: account.id, permission, reason: "initial-setup",
  });
  assert.equal(result.status, "allowed");
}

async function presentation(quotas) {
  const result = await quotas.evaluate((root) => {
    const context = document.createElement("canvas").getContext("2d");
    function srgb(color) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data;
    }
    function luminance(sample) {
      const [r, g, b] = [...sample].slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const contrast = [...root.querySelectorAll("h2,h3,p,dt,dd")].map((element) => {
      const foreground = luminance(srgb(getComputedStyle(element).color));
      for (let parent = element; parent; parent = parent.parentElement) {
        const sample = srgb(getComputedStyle(parent).backgroundColor);
        if (sample[3] !== 255) continue;
        const background = luminance(sample);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }
      return 0;
    });
    return { minContrast: Math.min(...contrast), noOverflow: document.documentElement.scrollWidth <= innerWidth && root.scrollWidth <= root.clientWidth };
  });
  assert.ok(result.noOverflow);
  assert.ok(result.minContrast >= 4.5, `Quota text contrast ${result.minContrast}`);
}

async function verifyLoading(db, page, label) {
  // PostgreSQL table lock delays only quota queries. Auth and the page shell
  // stay responsive, and the lock is always released before fixture cleanup.
  const locked = Promise.withResolvers();
  const release = Promise.withResolvers();
  const work = db.transaction(async (transaction) => {
    await transaction.query("LOCK TABLE quota_grant IN ACCESS EXCLUSIVE MODE");
    locked.resolve();
    await release.promise;
  });
  work.catch(locked.reject);
  try {
    await locked.promise;
    await page.reload({ waitUntil: "commit" });
    await expect(page.getByText(label, { exact: true })).toBeVisible({ timeout: 2500 });
  } finally {
    release.resolve();
    await work;
  }
}

async function verifyBrowser(db, owner, command) {
  const page = await owner.context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  const locales = [{
    id: "en", title: "Pilot quotas", missing: "No grant", active: "Active", loading: "Loading pilot quotas…",
    pending: "Pending reconciliation", reload: "Reload quotas", unavailable: "Pilot quotas are temporarily unavailable",
  }, {
    id: "zh-CN", title: "试点额度", missing: "尚未授予", active: "当前有效", loading: "正在读取额度…",
    pending: "待核对", reload: "重新加载额度", unavailable: "暂时无法读取或更新试点额度",
  }];
  await page.goto(settingsPath);
  for (const locale of locales) {
    await owner.context.addCookies([{ name: "geo-locale", value: locale.id, url: baseURL }]);
    const quotas = page.getByRole("region", { name: locale.title });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale.id);
      await expect(quotas.getByText(locale.active, { exact: true })).toBeVisible();
      await expect(quotas.getByText(locale.missing, { exact: true })).toBeVisible();
      await expect(quotas.getByText(locale.pending, { exact: true })).toBeVisible();
      await presentation(quotas);
    }
    if (db.kind === "postgresql") {
      await verifyLoading(db, page, locale.loading);
      await expect(quotas.getByText(locale.active, { exact: true })).toBeVisible();
    }
    await db.query("ALTER TABLE quota_grant RENAME TO quota_grant_test_unavailable");
    const retry = quotas.getByRole("button", { name: locale.reload });
    try {
      await page.reload();
      await expect(quotas.getByRole("alert")).toContainText(locale.unavailable);
      await retry.focus();
      await expect(retry).toBeFocused();
    } finally {
      await db.query("ALTER TABLE quota_grant_test_unavailable RENAME TO quota_grant");
    }
    await page.keyboard.press("Enter");
    await expect(quotas.getByText(locale.active, { exact: true })).toBeVisible();
  }
  await page.getByRole("combobox").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL(baseURL + settingsPath);
  await expect(page.getByRole("region", { name: "Pilot quotas" }).getByText("Pending reconciliation", { exact: true })).toBeVisible();
  assert.deepEqual(problems, []);

  await queryWithParameters(db, "UPDATE quota_grant SET expires_at = ? WHERE brand_id = ? AND version = 1",
    [new Date(Date.now() - 60_000).toISOString(), command.brandId]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Pilot quotas" }).getByText("Expired", { exact: true })).toBeVisible();
  return page;
}

async function verifyIntegration(db, browser) {
  const [owner, maintainer, anonymous] = await Promise.all([
    signUp(browser, "Synthetic B10 owner"), signUp(browser, "Synthetic B10 maintainer"), browser.newContext({ baseURL }),
  ]);
  try {
    const brandId = await brandFor(owner);
    const command = {
      actorId: maintainer.id, brandId, action: "set", operationId: randomUUID(), expectedVersion: null, reason: "pilot-approval",
      kind: "sampling", countLimit: 3, budgetMinor: 12345, currency: "CNY", expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const settings = await owner.context.newPage();
    await settings.goto(settingsPath);
    await expect(settings.getByRole("region", { name: "试点额度" }).getByText("尚未授予", { exact: true })).toHaveCount(2);
    await settings.close();
    const signedOut = await anonymous.request.get("/dashboard/settings", { maxRedirects: 0 });
    assert.equal(signedOut.status(), 307);
    await reject(await change(anonymous, command), 401, "SESSION_REQUIRED");
    await anonymous.addCookies([{ name: "better-auth.session_token", value: "forge-fixture", url: baseURL }]);
    await reject(await change(anonymous, command), 401, "SESSION_REQUIRED");
    await reject(await change(owner.context, { ...command, actorId: owner.id }), 403, "FORBIDDEN");
    await accessFor(db, maintainer, "grant", "capabilities.manage");
    await reject(await change(maintainer.context, command), 403, "FORBIDDEN");
    await accessFor(db, maintainer, "grant", "quotas.manage");
    await reject(await change(maintainer.context, command, "https://outside.example.invalid"), 403, "FORBIDDEN");
    await reject(await change(maintainer.context, { ...command, details: "x".repeat(3000) }), 400, "INVALID_INPUT");
    await reject(await change(maintainer.context, { ...command, actorId: owner.id }), 409, "SESSION_CHANGED");

    const first = await change(maintainer.context, command);
    assert.equal(first.status(), 200);
    assert.equal(first.headers()["cache-control"], "private, no-store");
    const { after, before } = await first.json();
    assert.equal(before, null);
    assert.equal(after.version, 1);
    assert.equal(after.budgetMinor, command.budgetMinor);
    assert.deepEqual((await (await change(maintainer.context, command)).json()).after, after);
    assert.equal((await reject(await change(maintainer.context, { ...command, operationId: randomUUID() }), 409, "VERSION_CONFLICT")).error.current.version, 1);
    const unrelated = await maintainer.context.newPage();
    await unrelated.goto(settingsPath);
    const unrelatedQuotas = unrelated.getByRole("region", { name: "试点额度" });
    await expect(unrelatedQuotas.getByText("当前账号没有活跃品牌。")).toBeVisible();
    await expect(unrelatedQuotas.getByText("尚未授予", { exact: true })).toHaveCount(2);

    const slot = { brandId, kind: "sampling", reservationId: randomUUID() };
    assert.equal(await applyQuotaLedger(db, owner.id, { ...slot, action: "reserve", version: 1, upperMinor: 1000, currency: "CNY" }), "applied");
    assert.equal(await applyQuotaLedger(db, owner.id, { ...slot, action: "start", attemptId: randomUUID(), upperMinor: 900, currency: "CNY" }), "applied");
    const page = await verifyBrowser(db, owner, command);
    const adjust = await change(maintainer.context, {
      ...command, expectedVersion: 1, operationId: randomUUID(), countLimit: 1, reason: "budget-decrease",
    });
    assert.equal(adjust.status(), 200);
    await page.reload();
    const quotas = page.getByRole("region", { name: "Pilot quotas" });
    await expect(quotas.getByText("Count limit reached", { exact: true })).toBeVisible();
    const revoke = await change(maintainer.context, {
      action: "revoke", brandId, actorId: maintainer.id, kind: "sampling", operationId: randomUUID(),
      expectedVersion: 2, reason: "pilot-ended",
    });
    assert.equal(revoke.status(), 200);
    await page.reload();
    await expect(quotas.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(quotas.getByText("Pending reconciliation", { exact: true })).toBeVisible();
    await accessFor(db, maintainer, "revoke", "quotas.manage");
    await reject(await change(maintainer.context, command), 403, "FORBIDDEN");
    const expiry = Date.now() - 60_000;
    await queryWithParameters(db, "UPDATE session SET expires_at = ? WHERE user_id = ?",
      [db.kind === "sqlite" ? expiry : new Date(expiry).toISOString(), maintainer.id]);
    await reject(await change(maintainer.context, command), 401, "SESSION_REQUIRED");
  } finally {
    await Promise.all([owner.context.close(), maintainer.context.close(), anonymous.close()]);
  }
}

async function run(kind, browser) {
  const fixture = await testDatabase(kind);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "3107"], {
    env: { ...process.env, ...fixture.env, BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), GEO_BRANDS_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-12_000); });
  const stopped = new Promise((done) => child.once("exit", done));
  try {
    for (let attempt = 0; attempt < 100 && !output.includes("Ready"); attempt++) {
      assert.equal(child.exitCode, null);
      await setTimeout(100);
    }
    assert.ok(output.includes("Ready"));
    assert.equal((await fetch(baseURL + "/api/health")).status, 200);
    await verifyIntegration(fixture.connection, browser);
    console.log(`PASS: ${kind} production quota HTTP, session/permission isolation and bilingual Chrome UI at 375/768/1440px`);
  } catch (error) {
    console.error(kind, output);
    throw error;
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await stopped;
    await fixture.cleanup();
  }
}

await access(".next/BUILD_ID");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const kind of ["sqlite", "postgresql"]) await run(kind, browser);
} finally {
  await browser.close();
}
