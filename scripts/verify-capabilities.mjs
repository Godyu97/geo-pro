import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { changeMaintenanceGrant } from "../src/features/maintenance/core.ts";
import { queryWithParameters } from "../src/lib/db/connection.ts";
import { testDatabase } from "../tests/maintenance/helpers.mjs";

const baseURL = "http://localhost:3108";
const capabilityPath = "/api/maintenance/capabilities";
const runPath = "/api/monitoring/runs";
const settingsPath = "/dashboard/settings?source=capability#monitoring-capabilities";

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

function change(context, data, origin = baseURL) {
  return context.request.post(capabilityPath, { headers: { Origin: origin }, data });
}

async function reject(response, status, code) {
  assert.equal(response.status(), status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(body), /sk-|BEGIN |session_token|INSERT INTO/);
  return body;
}

async function accessFor(db, account, action, permission) {
  const result = await changeMaintenanceGrant(db, {
    action, operatorId: account.id, userId: account.id, permission, reason: "initial-setup",
  });
  assert.equal(result.status, "allowed");
}

function command(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 1, citationCapability: "partial",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Operator SOP without secrets", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

async function presentation(root) {
  const result = await root.evaluate((node) => {
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
    const contrast = [...node.querySelectorAll("h2,h3,p,dt,dd,legend,label")].map((element) => {
      const foreground = luminance(srgb(getComputedStyle(element).color));
      for (let parent = element; parent; parent = parent.parentElement) {
        const sample = srgb(getComputedStyle(parent).backgroundColor);
        if (sample[3] !== 255) continue;
        const background = luminance(sample);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }
      return 0;
    });
    return { minContrast: Math.min(...contrast), noOverflow: document.documentElement.scrollWidth <= innerWidth && node.scrollWidth <= node.clientWidth };
  });
  assert.ok(result.noOverflow);
  assert.ok(result.minContrast >= 4.5, `Capability text contrast ${result.minContrast}`);
}

async function verifyBrowser(owner, apiName, consumerName) {
  const page = await owner.context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  const locales = [{
    id: "en", title: "Monitoring capabilities", emptyFormal: "No verified, unexpired channels",
    api: "Official API", consumer: "Consumer entry", run: "Open run confirmation",
    confirm: "Confirm formal run", blocked: "An unverified, expired, degraded or disabled channel",
    loading: "Loading monitoring capabilities…",
  }, {
    id: "zh-CN", title: "监测能力", emptyFormal: "当前没有未过期的已验证通道",
    api: "官方 API", consumer: "消费者入口", run: "打开运行确认",
    confirm: "确认正式运行", blocked: "存在未验证、过期、降级或已禁用的通道",
    loading: "正在读取监测能力…",
  }];
  await page.goto(settingsPath);
  for (const locale of locales) {
    await owner.context.addCookies([{ name: "geo-locale", value: locale.id, url: baseURL }]);
    const panel = page.getByRole("region", { name: locale.title });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale.id);
      await expect(panel.getByRole("heading", { name: apiName })).toBeVisible();
      await expect(panel.getByRole("heading", { name: consumerName })).toBeVisible();
      await expect(panel.getByText(locale.api)).toBeVisible();
      await expect(panel.getByText(locale.consumer)).toBeVisible();
      await presentation(panel);
    }
  }
  await page.getByRole("combobox").selectOption("en");
  await expect(page).toHaveURL(baseURL + settingsPath);
  await page.getByRole("link", { name: "Open run confirmation" }).click();
  await expect(page.getByRole("heading", { name: "Run confirmation" })).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Confirm formal run" }).click();
  await expect(page.getByRole("status")).toContainText("unverified, expired, degraded or disabled");
  assert.deepEqual(problems, []);
  return page;
}

async function verifyIntegration(db, browser) {
  const [owner, maintainer, anonymous] = await Promise.all([
    signUp(browser, "Synthetic B09 owner"), signUp(browser, "Synthetic B09 maintainer"), browser.newContext({ baseURL }),
  ]);
  try {
    const create = command(maintainer.id);
    const settings = await owner.context.newPage();
    await settings.goto(settingsPath);
    await expect(settings.getByRole("region", { name: "监测能力" }).getByText("尚未登记监测通道。")).toBeVisible();
    await settings.close();
    assert.equal((await anonymous.request.get("/dashboard/settings", { maxRedirects: 0 })).status(), 307);
    await reject(await change(anonymous, create), 401, "SESSION_REQUIRED");
    await anonymous.addCookies([{ name: "better-auth.session_token", value: "forge-fixture", url: baseURL }]);
    await reject(await change(anonymous, create), 401, "SESSION_REQUIRED");
    await reject(await change(owner.context, { ...create, actorId: owner.id }), 403, "FORBIDDEN");
    await accessFor(db, maintainer, "grant", "quotas.manage");
    await reject(await change(maintainer.context, create), 403, "FORBIDDEN");
    await accessFor(db, maintainer, "grant", "capabilities.manage");
    await reject(await change(maintainer.context, create, "https://outside.example.invalid"), 403, "FORBIDDEN");
    await reject(await change(maintainer.context, { ...create, actorId: owner.id }), 409, "SESSION_CHANGED");

    const first = await change(maintainer.context, create);
    assert.equal(first.status(), 200);
    const { after } = await first.json();
    assert.equal(after.version, 1);
    assert.equal((await (await change(maintainer.context, create)).json()).after.channelId, after.channelId);
    const consumer = await change(maintainer.context, command(maintainer.id, {
      kind: "consumer_ui", displayName: "Acme chat", productEntry: "consumer-app", mode: "consumer-ui",
    }));
    assert.equal(consumer.status(), 200);
    const consumerBody = await consumer.json();
    const verified = await change(maintainer.context, command(maintainer.id, {
      expectedVersion: 1, channelId: after.channelId, reason: "verification", status: "verified",
      verifiedAt: new Date().toISOString(), publicVisible: 1,
    }));
    assert.equal(verified.status(), 200);

    const blocked = await owner.context.request.post(runPath, {
      headers: { Origin: baseURL },
      data: { space: "formal", channelIds: [consumerBody.after.channelId] },
    });
    await reject(blocked, 409, "CHANNEL_UNVERIFIED");
    const eligible = await owner.context.request.post(runPath, {
      headers: { Origin: baseURL },
      data: { space: "formal", channelIds: [after.channelId] },
    });
    const eligibleBody = await eligible.json();
    assert.equal(eligible.status(), 409);
    assert.equal(eligibleBody.eligible, true);
    assert.equal(eligibleBody.reason, "RUN_NOT_OPEN");
    assert.doesNotMatch(JSON.stringify(eligibleBody), /simulated success|模拟成功/);

    const page = await verifyBrowser(owner, "Acme API", "Acme chat");
    await owner.context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await page.goto("/dashboard/maintenance/capabilities");
    await expect(page.getByRole("heading", { name: "通道能力台账" })).toBeVisible();
    await expect(page.getByText("当前会话无法维护通道能力")).toBeVisible();
    const maintPage = await maintainer.context.newPage();
    await maintainer.context.addCookies([{ name: "geo-locale", value: "zh-CN", url: baseURL }]);
    await maintPage.goto("/dashboard/maintenance/capabilities");
    await expect(maintPage.getByRole("heading", { name: "通道能力台账" })).toBeVisible();
    await expect(maintPage.getByText("Operator SOP without secrets").first()).toBeVisible();
    await expect(maintPage.locator("body")).not.toContainText("customer body");
    await accessFor(db, maintainer, "revoke", "capabilities.manage");
    await reject(await change(maintainer.context, create), 403, "FORBIDDEN");
    const expiry = Date.now() - 60_000;
    await queryWithParameters(db, "UPDATE session SET expires_at = ? WHERE user_id = ?",
      [db.kind === "sqlite" ? expiry : new Date(expiry).toISOString(), maintainer.id]);
    await reject(await change(maintainer.context, create), 401, "SESSION_REQUIRED");
  } finally {
    await Promise.all([owner.context.close(), maintainer.context.close(), anonymous.close()]);
  }
}

async function run(kind, browser) {
  const fixture = await testDatabase(kind);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "3108"], {
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
    console.log(`PASS: ${kind} production capability HTTP, dual-track isolation and bilingual Chrome UI at 375/768/1440px`);
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
