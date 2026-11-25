import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const route = "/dashboard/monitoring/protocols";
const headers = { Origin: origin };
const brandName = `合成协议品牌-${"LongSegment_".repeat(4)}end`;
const copy = {
  "zh-CN": {
    title: "采样协议",
    openProtocols: "查看采样协议",
    goBrands: "前往品牌",
    startDraft: "填写协议草稿",
    browseProtocols: "查看协议版本",
    familiesHeading: "协议版本",
    backMonitoring: "返回监测",
    noBrands: "当前没有可保存协议的品牌。",
    empty: "还没有采样协议。",
    brand: "品牌",
    searchRequired: "采样要求联网",
    targetRegion: "目标地区",
    timezone: "时区",
    registerAction: "保存草稿",
    registering: "正在保存…",
    saved: "已保存草稿。这一版还不能钉到运行。",
    freezeAction: "冻结协议",
    frozenSaved: "已冻结。重复提交同一内容不会新增版本。",
    runId: "运行编号",
    pinAction: "钉住该版本",
    pinned: "已钉住该版本。运行的联网状态没有被改写。",
    invalid: "请检查地区、时区和运行编号。",
    loading: "正在加载采样协议…",
    unavailable: "采样协议暂时不可用，请稍后重试。",
    reload: "重新载入",
    pinLine: (runId: string, version: number) => `运行 ${runId} 钉住版本 ${version}`,
  },
  en: {
    title: "Sampling protocols",
    openProtocols: "View sampling protocols",
    goBrands: "Go to brands",
    startDraft: "Draft a protocol",
    browseProtocols: "View protocol versions",
    familiesHeading: "Protocol versions",
    backMonitoring: "Back to monitoring",
    noBrands: "There is no brand available for a protocol.",
    empty: "No sampling protocols yet.",
    brand: "Brand",
    searchRequired: "Sampling requires search",
    targetRegion: "Target region",
    timezone: "Time zone",
    registerAction: "Save draft",
    registering: "Saving…",
    saved: "Draft saved. This version cannot be pinned to a run yet.",
    freezeAction: "Freeze protocol",
    frozenSaved: "Frozen. Submitting the same fields again does not add a version.",
    runId: "Run id",
    pinAction: "Pin this version",
    pinned: "Pinned to this version. The run network state was not rewritten.",
    invalid: "Check the region, time zone, and run id.",
    loading: "Loading sampling protocols…",
    unavailable: "Sampling protocols are temporarily unavailable. Try again shortly.",
    reload: "Reload",
    pinLine: (runId: string, version: number) => `Run ${runId} pins version ${version}`,
  },
};

async function activate(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.GEO_PROTOCOL_SCREENSHOTS;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function register(context: BrowserContext) {
  const email = `sampling-protocol-${randomUUID()}@example.invalid`;
  const signup = await registerTestAccount(context, {
    name: "Sampling protocol visual test",
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(signup.status()).toBe(200);
  const { user: { id } } = await signup.json();
  return { userId: String(id), email };
}

test("sampling protocols support bilingual drafting, freezing, pinning, isolation and recovery", async ({ context, page, browser }) => {
  test.setTimeout(180_000);
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<Awaited<ReturnType<typeof register>>> = [];
  const main = page.getByRole("main");
  const locales = ["zh-CN", "en"] as const;
  let brandId = "";
  let runId = "";

  const readProtocols = () => sql`
    SELECT id, protocol_id, version, status, search_required, target_region, timezone
    FROM sampling_protocol WHERE brand_id = ${brandId} ORDER BY version
  `;
  const readPins = () => sql`
    SELECT run_id, protocol_id, version FROM run_protocol_pin WHERE run_id = ${runId}
  `;

  async function checkLayout(action: "goBrands" | "startDraft" | "browseProtocols", shotPrefix: string) {
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: labels.title, level: 1 })).toBeVisible();
        await expect(main.getByRole("link", { name: labels[action], exact: true })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (action === "goBrands") {
          await expect(main.getByText(labels.noBrands, { exact: true })).toBeVisible();
          await expect(main.getByText(labels.empty, { exact: true })).toBeVisible();
        } else if (action === "startDraft") {
          await expect(main.getByText(labels.empty, { exact: true })).toBeVisible();
        } else {
          await expect(main.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
          await expect(main.getByText(labels.pinLine(runId, 1), { exact: true })).toBeVisible();
        }
        if (width === 375) await screenshot(page, `${shotPrefix}-${locale}-${width}`);
      }
    }
  }

  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));

    await checkLayout("goBrands", "nobrand");

    const saved = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit",
        actorId: owner.userId,
        operationId: randomUUID(),
        target: null,
        expectedDraft: null,
        acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: brandName,
          description: "用于采样协议浏览器验收的合成品牌。",
          website: "https://protocol-fixture.example.com",
          aliases: [],
          region: "CN",
          language: "zh-CN",
          competitors: [],
          questions: [],
        },
      },
    });
    expect(saved.status()).toBe(200);
    brandId = (await saved.json()).id;
    expect(brandId).toMatch(/^[a-f0-9-]{36}$/);

    runId = randomUUID();
    await sql`
      INSERT INTO monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) VALUES (
        ${runId}, ${brandId}, ${owner.userId}, ${randomUUID()}, ${"a".repeat(64)}, 'consumer_ui',
        ${randomUUID()}, 1, 1, 1, 0, 1, 1, 'CN', 'zh-CN', 'off', NULL, NULL, NULL, 0, 'queued', 0,
        '2026-11-25T00:00:00.000Z'
      )
    `;

    await checkLayout("startDraft", "empty");

    const zh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/monitoring/overview");
    await activate(page, main.getByRole("link", { name: zh.openProtocols, exact: true }));
    await expect(page).toHaveURL(route);
    await activate(page, main.getByRole("link", { name: zh.startDraft, exact: true }));

    const brandSelect = main.getByLabel(zh.brand, { exact: true });
    await expect(brandSelect).toBeFocused();
    const regionInput = main.getByLabel(zh.targetRegion, { exact: true }).first();
    const timezoneInput = main.getByLabel(zh.timezone, { exact: true }).first();
    const saveButton = main.getByRole("button", { name: zh.registerAction, exact: true });

    await regionInput.fill("cn");
    expect(await regionInput.evaluate((element: HTMLInputElement) => element.validity.patternMismatch)).toBe(true);
    await regionInput.fill("US");
    await timezoneInput.fill("Not/A_Zone");
    await activate(page, saveButton);
    await expect(main.getByRole("alert")).toHaveText(zh.invalid);
    await expect(regionInput).toHaveValue("US");
    await expect(timezoneInput).toHaveValue("Not/A_Zone");
    expect(await readProtocols()).toHaveLength(0);

    await timezoneInput.fill("America/New_York");
    await main.getByLabel(zh.searchRequired, { exact: true }).first().check();
    await context.addCookies([{ name: "geo-protocols-write", value: "slow", url: origin }]);
    let posts = 0;
    const countPosts = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/monitoring/protocols") posts += 1;
    };
    page.on("request", countPosts);
    await activate(page, saveButton);
    await expect(main.getByRole("button", { name: zh.registering, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(main.getByText(zh.saved, { exact: true })).toBeVisible();
    page.off("request", countPosts);
    expect(posts).toBe(1);
    await context.clearCookies({ name: "geo-protocols-write" });

    const drafted = await readProtocols();
    expect(drafted).toHaveLength(1);
    expect(drafted[0]).toMatchObject({
      version: 1,
      status: "draft",
      search_required: 1,
      target_region: "US",
      timezone: "America/New_York",
    });
    const protocolId = String(drafted[0].protocol_id);

    const draftPin = await context.request.post(`/api/monitoring/runs/${runId}/protocol`, {
      headers,
      data: { protocolId, version: 1 },
    });
    expect(draftPin.status()).toBe(409);
    expect(await readPins()).toHaveLength(0);

    await activate(page, main.getByRole("button", { name: zh.freezeAction, exact: true }));
    await expect(main.getByText(zh.frozenSaved, { exact: true })).toBeVisible();
    const runInput = main.getByLabel(zh.runId, { exact: true });
    await expect(runInput).toBeVisible();

    const pinButton = main.getByRole("button", { name: zh.pinAction, exact: true });
    await runInput.fill("bad-run-id");
    let pinPosts = 0;
    const countPinPosts = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/protocol")) pinPosts += 1;
    };
    page.on("request", countPinPosts);
    await activate(page, pinButton);
    await expect(main.getByRole("alert")).toHaveText(zh.invalid);
    await expect(runInput).toHaveValue("bad-run-id");
    expect(pinPosts).toBe(0);
    page.off("request", countPinPosts);

    await runInput.fill(runId);
    await activate(page, pinButton);
    await expect(main.getByText(zh.pinned, { exact: true })).toBeVisible();
    await expect(runInput).toHaveValue("");
    await expect(main.getByText(zh.pinLine(runId, 1), { exact: true })).toBeVisible();
    expect(await readPins()).toEqual([{ run_id: runId, protocol_id: protocolId, version: 1 }]);

    const [runRow] = await sql`
      SELECT requested_network_mode, customer_payable_minor FROM monitoring_run WHERE id = ${runId}
    `;
    expect(runRow).toEqual({ requested_network_mode: "off", customer_payable_minor: 0 });

    const familyCard = main.locator("section[aria-labelledby='protocol-families']");
    const freezeTz = familyCard.getByLabel(zh.timezone, { exact: true });
    await freezeTz.fill("Europe/London");
    await activate(page, familyCard.getByRole("button", { name: zh.freezeAction, exact: true }));
    await expect(familyCard.getByText(zh.frozenSaved, { exact: true })).toBeVisible();
    const versions = await readProtocols();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, status: "frozen", timezone: "America/New_York" });
    expect(versions[1]).toMatchObject({ version: 2, status: "frozen", timezone: "Europe/London" });
    expect(await readPins()).toEqual([{ run_id: runId, protocol_id: protocolId, version: 1 }]);

    await checkLayout("browseProtocols", "populated");
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(route);
    await activate(page, main.getByRole("link", { name: zh.browseProtocols, exact: true }));
    await expect(main.getByRole("heading", { name: zh.familiesHeading, exact: true })).toBeFocused();

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.goto(route);
    const restricted = stranger.getByRole("main");
    await expect(restricted.getByRole("heading", { name: copy.en.title, level: 1 })).toBeVisible();
    await expect(restricted.getByRole("link", { name: copy.en.goBrands, exact: true })).toBeInViewport();
    await expect(restricted.getByText(brandName, { exact: true })).toHaveCount(0);
    await expect(restricted.getByText(runId, { exact: true })).toHaveCount(0);
    const outsiderPin = await outsider.request.post(`/api/monitoring/runs/${runId}/protocol`, {
      headers,
      data: { protocolId, version: 1 },
    });
    expect(outsiderPin.status()).toBe(404);

    await page.setViewportSize({ width: 375, height: 800 });
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-protocols-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(route, { waitUntil: "commit" });
      await expect(main.getByText(labels.loading, { exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: labels.title, level: 1 })).toBeVisible();
      await expect(main.getByRole("alert")).toHaveText(labels.unavailable);
      await expect(main.getByText(brandName, { exact: true })).toHaveCount(0);
      await expect(main.getByText("Private sampling protocols fixture failure")).toHaveCount(0);
      const reload = main.getByRole("link", { name: labels.reload, exact: true });
      await expect(reload).toHaveAttribute("href", route);
      await expect(reload).toBeInViewport();
      await screenshot(page, `unavailable-${locale}-375`);
      await context.clearCookies({ name: "geo-protocols-read" });
      await activate(page, reload);
      await expect(main.getByRole("heading", { name: brandName, exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    try {
      if (runId) {
        await sql`DELETE FROM run_protocol_pin WHERE run_id = ${runId}`;
        await sql`DELETE FROM monitoring_run WHERE id = ${runId}`;
      }
      if (brandId) {
        await sql`DELETE FROM sampling_protocol WHERE brand_id = ${brandId}`;
      }
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
        const user = await sql`SELECT id FROM "user" WHERE id = ${account.userId}`;
        expect(user).toHaveLength(0);
      }
      if (brandId) {
        expect(await sql`SELECT id FROM brand WHERE id = ${brandId}`).toHaveLength(0);
        expect(await readProtocols()).toHaveLength(0);
      }
      if (runId) {
        expect(await readPins()).toHaveLength(0);
        expect(await sql`SELECT id FROM monitoring_run WHERE id = ${runId}`).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
