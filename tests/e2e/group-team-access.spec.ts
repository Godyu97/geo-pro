import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { registerTestAccount } from "./auth-helpers";
import { publishedRetentionVersion } from "./retention-version";

const origin = "http://localhost:3100";

function localDatabaseURL() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)) {
    throw new Error("Browser flow tests require a local development database");
  }
  return databaseURL;
}

function cleanupAccount(userId: string, email: string) {
  execFileSync(process.execPath, [
    "--conditions=react-server", "scripts/e2e-m0-fixture.mjs", "cleanup",
    JSON.stringify({ userId, email, channelIds: [] }),
  ], { stdio: "inherit" });
}

function recordId(value: unknown, label: string) {
  if (typeof value !== "object" || value === null) throw new Error(`${label} missing`);
  const id = (value as Record<string, unknown>)[label];
  if (typeof id !== "string" || id.length === 0) throw new Error(`${label} invalid`);
  return id;
}

async function provision(browser: Browser, email: string, name: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  const response = await registerTestAccount(context, {
    name,
    email,
    password: randomBytes(24).toString("base64url"),
  });
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("user" in body)) throw new Error("Registration did not return user");
  return { context, userId: recordId(body.user, "id"), email };
}

async function createBrand(context: BrowserContext, userId: string, name: string) {
  const response = await context.request.post("/api/brands", {
    headers: { Origin: origin },
    data: {
      action: "submit",
      actorId: userId,
      operationId: randomUUID(),
      target: null,
      expectedDraft: null,
      acceptedPolicyVersion: publishedRetentionVersion(),
      fields: {
        name,
        description: "二期集团与团队权限实时浏览器验收合成品牌",
        website: "https://team-group-e2e.example.com",
        aliases: [],
        region: "CN",
        language: "zh-CN",
        competitors: [],
        questions: [],
      },
    },
  });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  return recordId(JSON.parse(text), "id");
}

test("two ordinary users collaborate via group read-only invite, reject cross-group & downloads, and revoke", async ({ browser }) => {
  test.setTimeout(180_000);
  const token = randomUUID().slice(0, 8);
  const sql = postgres(localDatabaseURL(), { max: 1 });
  const accounts: Array<{ userId: string; email: string; context: BrowserContext }> = [];
  let brandA = "";
  let brandC = "";
  const nameA = `甲组协同品牌${token}`;
  const nameC = `丙组私有品牌${token}`;
  const fileId = randomUUID();
  const objectId = randomUUID();

  try {
    const userA = await provision(browser, `team-group-a-${token}@example.invalid`, `甲负责人${token}`);
    accounts.push(userA);
    const userB = await provision(browser, `team-group-b-${token}@example.invalid`, `乙成员${token}`);
    accounts.push(userB);
    const userC = await provision(browser, `team-group-c-${token}@example.invalid`, `丙负责人${token}`);
    accounts.push(userC);

    // Verify new accounts are user role with personal groups.
    const roles = await sql`select user_id, role from platform_account_role where user_id in ${sql([userA.userId, userB.userId, userC.userId])}`;
    expect(roles.every((row) => row.role === "user")).toBe(true);
    const groupsA = await sql`select id from team_group where owner_user_id = ${userA.userId} and kind = 'personal'`;
    expect(groupsA).toHaveLength(1);
    const groupAId = String(groupsA[0].id);

    brandA = await createBrand(userA.context, userA.userId, nameA);
    brandC = await createBrand(userC.context, userC.userId, nameC);

    // Attach a private source original record to Brand A to verify read_only cannot download it.
    const now = new Date().toISOString();
    const digest = createHash("sha256").update("private-source").digest("hex");
    await sql`
      insert into stored_object (
        id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
        byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
      ) values (
        ${objectId}, ${userA.userId}, ${brandA}, 'source-original', 'internal', 'ready', 'app-files',
        ${`v1/${userA.userId}/${brandA}/source-original/${objectId}/secret.txt`}, 'text/plain',
        14, ${digest}, 'secret.txt', 0, ${now}, ${now}, NULL
      )`;
    await sql`
      insert into source_original (
        id, brand_id, owner_id, batch_id, file_name, byte_size, stored_object_id, status, reason, rights_status, created_at
      ) values (
        ${fileId}, ${brandA}, ${userA.userId}, ${randomUUID()}, 'secret.txt', 14, ${objectId}, 'ready', NULL, 'active', ${now}
      )`;

    const pageA = await userA.context.newPage();
    await userA.context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await pageA.goto("/dashboard/settings/team");
    await expect(pageA.getByRole("heading", { name: "团队与品牌授权" })).toBeVisible();
    await expect(pageA.getByText("普通用户 (user)")).toBeVisible();
    await expect(pageA.getByRole("link", { name: nameA })).toBeVisible();

    // Invite userB by email with read_only role.
    const inviteSection = pageA.locator("section", { has: pageA.locator("#invitations-heading") });
    await inviteSection.locator('input[name="userId"]').fill(userB.email);
    await inviteSection.locator('select[name="role"]').selectOption("read_only");
    await inviteSection.getByRole("button", { name: "创建邀请" }).click();

    const statusBanner = pageA.getByRole("status");
    await expect(statusBanner).toContainText("邀请已创建");
    const statusText = await statusBanner.textContent();
    const tokenMatch = statusText?.match(/([A-Za-z0-9_-]{43})\s*$/);
    expect(tokenMatch).not.toBeNull();
    const inviteToken = tokenMatch![1];

    // User B logs into /dashboard/settings/team, accepts invite, and enters User A's group.
    const pageB = await userB.context.newPage();
    await userB.context.addCookies([{ name: "geo-locale", value: "zh-CN", url: origin }]);
    await pageB.goto("/dashboard/settings/team");
    const acceptSection = pageB.locator("section", { has: pageB.locator("#invitations-heading") });
    await acceptSection.locator('input[name="token"]').fill(inviteToken);
    await acceptSection.getByRole("button", { name: "接受邀请" }).click();
    await expect(pageB.getByRole("status")).toContainText("已接受邀请");

    await pageB.getByRole("link", { name: new RegExp(`甲负责人${token}`) }).click();
    await expect(pageB).toHaveURL(new RegExp(`groupId=${groupAId}`));
    await expect(pageB.getByRole("link", { name: nameA })).toBeVisible();
    await expect(pageB.getByText("只读成员").first()).toBeVisible();

    // Read-only member sees Brand A in /dashboard/brands and /dashboard/brands/[brandA], without edit button.
    await pageB.goto("/dashboard/brands");
    await expect(pageB.getByRole("link", { name: nameA })).toBeVisible();
    await pageB.getByRole("link", { name: nameA }).click();
    await expect(pageB).toHaveURL(new RegExp(`/dashboard/brands/${brandA}$`));
    await expect(pageB.getByRole("heading", { name: nameA })).toBeVisible();
    await expect(pageB.getByRole("link", { name: "编辑资料" })).toHaveCount(0);

    // Read-only member can view Brand A via API, but CANNOT modify, download, or access Brand C.
    const brandReadRes = await userB.context.request.get(`/api/brands?id=${brandA}`);
    expect(brandReadRes.status()).toBe(200);
    const brandWriteRes = await userB.context.request.post("/api/brands", {
      headers: { Origin: origin },
      data: { action: "archive", actorId: userB.userId, operationId: randomUUID(), brandId: brandA, expectedBrandRevision: 1 },
    });
    expect(brandWriteRes.status()).toBe(404);
    const factsWriteRes = await userB.context.request.post(`/api/brands/${brandA}/facts`, {
      headers: { Origin: origin },
      data: { action: "savePaste", id: randomUUID(), previousId: null, original: "不允许只读写入" },
    });
    expect(factsWriteRes.status()).toBe(409);
    const downloadRes = await userB.context.request.get(`/api/content/sources/${fileId}?brandId=${brandA}`);
    expect(downloadRes.status()).toBe(404);
    const exportRes = await userB.context.request.get(`/api/settings/team/grants?export=${brandA}`);
    expect(exportRes.status()).toBe(403);
    const otherGroupReadRes = await userB.context.request.get(`/api/brands?id=${brandC}`);
    expect(otherGroupReadRes.status()).toBe(404);
    await pageB.goto(`/dashboard/brands/${brandC}`);
    expect(await pageB.content()).not.toContain(nameC);

    // User A revokes User B from /dashboard/settings/team.
    await pageA.reload();
    const membersSection = pageA.locator("section", { has: pageA.locator("#members-heading") });
    await membersSection.getByRole("button", { name: "撤销" }).click();
    await expect(pageA.getByRole("status")).toContainText("授权已撤销");

    // User B refreshes and immediately loses access to Brand A and Group A.
    await pageB.goto(`/dashboard/brands/${brandA}`);
    expect(await pageB.content()).not.toContain(nameA);
    await pageB.goto("/dashboard/brands");
    await expect(pageB.getByText(nameA)).toHaveCount(0);
    await pageB.goto("/dashboard/settings/team");
    await expect(pageB.getByRole("link", { name: new RegExp(`甲负责人${token}`) })).toHaveCount(0);
  } finally {
    await sql`delete from source_original where id = ${fileId}`.catch(() => {});
    await sql`delete from stored_object where id = ${objectId}`.catch(() => {});
    for (const account of accounts) {
      try {
        cleanupAccount(account.userId, account.email);
      } finally {
        await account.context.close();
      }
    }
    await sql.end();
  }
});
