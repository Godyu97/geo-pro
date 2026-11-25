import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";
const route = "/dashboard/content/channel-profiles";
const key = `e2e-${"profile_".repeat(6)}channel_keys`;
const firstNote = `FIRST-${"x".repeat(400)}`;
const secondNote = "Second example profile with no length cap.";
const headers = { Origin: origin };
const copy = {
  "zh-CN": {
    title: "渠道画像", brands: "前往品牌", start: "填写画像", browse: "查看已发布版本",
    versions: "已发布版本", empty: "还没有已发布的画像版本。", key: "渠道键", note: "说明",
    limit: "最大字数", limited: "最多 1,234 字", unlimited: "不限字数",
    publish: "发布新版本", pending: "正在发布画像版本…",
    published: "已发布新的画像版本。旧版本的字数上限没有改动。",
    invalid: "请填写渠道键和说明。字数上限需要是正整数，或留空。",
    readOnly: "当前品牌不能发布新版本。", back: "返回内容", load: "正在加载渠道画像…",
    fail: "暂时无法读取渠道画像。请重新载入。", reload: "重新载入",
  },
  en: {
    title: "Channel profiles", brands: "Go to brands", start: "Fill in profile", browse: "View published versions",
    versions: "Published versions", empty: "No profile version has been published yet.", key: "Channel key", note: "Note",
    limit: "Maximum characters", limited: "Up to 1,234 characters", unlimited: "No character limit",
    publish: "Publish new version", pending: "Publishing profile version…",
    published: "A new profile version was published. Older character limits were left unchanged.",
    invalid: "Enter a channel key and a note. The character limit must be a positive integer, or stay empty.",
    readOnly: "This brand cannot publish a new version.", back: "Back to content", load: "Loading channel profiles…",
    fail: "Channel profiles could not be loaded. Reload to try again.", reload: "Reload",
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
  const directory = process.env.GEO_CHANNEL_PROFILE_SCREENSHOTS;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function register(context: BrowserContext) {
  const email = `channel-profile-${randomUUID()}@example.invalid`;
  const signup = await registerTestAccount(context, {
    name: "Channel profile visual test", email, password: randomBytes(24).toString("base64url"),
  });
  expect(signup.status()).toBe(200);
  const { user: { id } } = await signup.json();
  return { userId: String(id), email };
}

test("channel profiles support bilingual publishing, version review and recovery", async ({ context, page, browser }) => {
  test.setTimeout(180_000);
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  const outsider = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 800 } });
  const accounts: Array<Awaited<ReturnType<typeof register>>> = [];
  const main = page.getByRole("main");
  const locales = ["zh-CN", "en"] as const;
  let brandId = "";

  const readVersions = () => sql`
    SELECT id, version_number, max_characters, note FROM channel_profile_version
    WHERE brand_id = ${brandId} ORDER BY version_number
  `;

  async function checkLayout(href: string, action: "brands" | "start" | "browse") {
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([{ name: "geo-locale", value: locale, url: origin }]);
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(href);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(main).toHaveCount(1);
        await expect(main.getByRole("heading", { name: labels.title, level: 1 })).toBeVisible();
        await expect(main.getByRole("link", { name: labels[action], exact: true })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (action === "start") await expect(main.getByText(labels.empty, { exact: true })).toBeVisible();
        if (action === "browse") {
          await expect(main.getByText(labels.readOnly, { exact: true })).toBeVisible();
          await expect(main.getByRole("button", { name: labels.publish, exact: true })).toHaveCount(0);
          await expect(main.getByText(firstNote, { exact: true })).toBeVisible();
          await expect(main.getByText(secondNote, { exact: true })).toBeVisible();
          await expect(main.getByText(labels.limited, { exact: true })).toBeVisible();
          await expect(main.getByText(labels.unlimited, { exact: true })).toBeVisible();
        }
        if (width === 375) await screenshot(page, `${action}-${locale}-${width}`);
      }
    }
  }

  try {
    const owner = await register(context);
    accounts.push(owner);
    accounts.push(await register(outsider));
    await checkLayout(route, "brands");

    const saved = await context.request.post("/api/brands", {
      headers,
      data: {
        action: "submit", actorId: owner.userId, operationId: randomUUID(),
        target: null, expectedDraft: null, acceptedPolicyVersion: publishedRetentionVersion(),
        fields: {
          name: "合成渠道画像品牌", description: "用于渠道画像浏览器验收的合成品牌。",
          website: "https://channel-profile.example.com", aliases: [], region: "CN",
          language: "zh-CN", competitors: [], questions: [],
        },
      },
    });
    expect(saved.status()).toBe(200);
    brandId = (await saved.json()).id;
    expect(brandId).toMatch(/^[a-f0-9-]{36}$/);
    const href = `${route}?brandId=${brandId}`;
    await checkLayout(href, "start");

    const zh = copy["zh-CN"];
    await context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/dashboard/content?brandId=${brandId}`);
    await activate(page, main.getByRole("link", { name: zh.title, exact: true }));
    await expect(page).toHaveURL(href);
    await activate(page, main.getByRole("link", { name: zh.start, exact: true }));
    const channelKey = main.getByLabel(zh.key, { exact: true });
    const limit = main.getByLabel(zh.limit, { exact: true });
    const note = main.getByLabel(zh.note, { exact: true });
    const publish = main.getByRole("button", { name: zh.publish, exact: true });
    await expect(channelKey).toBeFocused();
    await channelKey.fill("invalid key");
    expect(await channelKey.evaluate((field: HTMLInputElement) => field.validity.patternMismatch)).toBe(true);
    await channelKey.fill(key);
    await limit.fill("1000001");
    expect(await limit.evaluate((field: HTMLInputElement) => field.validity.rangeOverflow)).toBe(true);
    await limit.fill("1234");
    await note.fill("   ");
    await activate(page, publish);
    await expect(main.getByRole("alert")).toHaveText(zh.invalid);
    await expect(channelKey).toHaveValue(key);
    await expect(limit).toHaveValue("1234");
    await expect(note).toHaveValue("   ");
    expect(await readVersions()).toHaveLength(0);

    await note.fill(firstNote);
    await context.addCookies([{ name: "geo-channel-profiles-write", value: "slow", url: origin }]);
    let posts = 0;
    const countPosts = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === route) posts += 1;
    };
    page.on("request", countPosts);
    await activate(page, publish);
    await expect(main.getByRole("button", { name: zh.pending, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(main.getByText(zh.published, { exact: true })).toBeVisible();
    page.off("request", countPosts);
    expect(posts).toBe(1);
    await expect(channelKey).toHaveValue("");
    await context.clearCookies({ name: "geo-channel-profiles-write" });
    const firstRows = await readVersions();
    expect(firstRows).toEqual([{
      id: expect.any(String), version_number: 1, max_characters: 1234, note: firstNote,
    }]);

    await channelKey.fill(key);
    await note.fill(secondNote);
    await activate(page, publish);
    await expect(channelKey).toHaveValue("");
    await expect(main.getByText(secondNote, { exact: true })).toBeVisible();
    expect(await readVersions()).toEqual([
      firstRows[0], { id: expect.any(String), version_number: 2, max_characters: null, note: secondNote },
    ]);
    await activate(page, main.getByRole("link", { name: zh.browse, exact: true }));
    await expect(main.getByRole("heading", { name: zh.versions, exact: true })).toBeFocused();
    await screenshot(page, "published-zh-CN-375");

    const stranger = await outsider.newPage();
    await outsider.addCookies([{ name: "geo-locale", value: "en", url: origin }]);
    await stranger.goto(href);
    const restricted = stranger.getByRole("main");
    await expect(restricted.getByRole("heading", { name: copy.en.title, level: 1 })).toBeVisible();
    await expect(restricted.getByRole("alert")).toBeVisible();
    await expect(restricted.getByRole("link", { name: copy.en.back, exact: true })).toBeInViewport();
    await expect(restricted.getByText(key, { exact: true })).toHaveCount(0);
    await expect(restricted.getByText(firstNote, { exact: true })).toHaveCount(0);
    await expect(restricted.getByRole("button", { name: copy.en.publish, exact: true })).toHaveCount(0);

    const archived = await context.request.post("/api/brands", {
      headers,
      data: { action: "archive", actorId: owner.userId, operationId: randomUUID(), brandId, expectedBrandRevision: 1 },
    });
    expect(archived.status()).toBe(200);
    await checkLayout(href, "browse");

    await page.setViewportSize({ width: 375, height: 800 });
    for (const locale of locales) {
      const labels = copy[locale];
      await context.addCookies([
        { name: "geo-locale", value: locale, url: origin },
        { name: "geo-channel-profiles-read", value: "slow-unavailable", url: origin },
      ]);
      await page.goto(href, { waitUntil: "commit" });
      await expect(main.getByText(labels.load, { exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: labels.title, level: 1 })).toBeVisible();
      await expect(main.getByRole("alert")).toHaveText(labels.fail);
      await expect(main.getByText(firstNote, { exact: true })).toHaveCount(0);
      await expect(main.getByText("Private channel profiles fixture failure")).toHaveCount(0);
      const reload = main.getByRole("link", { name: labels.reload, exact: true });
      await expect(reload).toHaveAttribute("href", href);
      await expect(reload).toBeInViewport();
      await screenshot(page, `unavailable-${locale}-375`);
      await context.clearCookies({ name: "geo-channel-profiles-read" });
      await activate(page, reload);
      await expect(main.getByText(firstNote, { exact: true })).toBeVisible();
    }
  } finally {
    await outsider.close();
    try {
      for (const account of accounts) {
        execFileSync(process.execPath, [
          "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup", JSON.stringify(account),
        ], { stdio: "inherit" });
        const user = await sql`SELECT id FROM "user" WHERE id = ${account.userId}`;
        expect(user).toHaveLength(0);
      }
      if (brandId) {
        expect(await sql`SELECT id FROM brand WHERE id = ${brandId}`).toHaveLength(0);
        expect(await sql`SELECT id FROM channel_profile WHERE brand_id = ${brandId}`).toHaveLength(0);
        expect(await readVersions()).toHaveLength(0);
      }
    } finally {
      await sql.end();
    }
  }
});
