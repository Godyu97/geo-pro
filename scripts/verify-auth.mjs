import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const baseURL = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname),
  "认证验证脚本仅连接本地开发应用",
);
assert.ok(process.env.DATABASE_URL, "请配置开发 DATABASE_URL");
assert.ok(URL.canParse(process.env.DATABASE_URL), "请配置有效的本地开发数据库地址");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
  "认证验证脚本仅修改本地开发数据库中的临时账号",
);

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
const email = `phase0-${randomBytes(10).toString("hex")}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let createdUserId;
const otherEmail = `b02-other-${randomBytes(10).toString("hex")}@example.invalid`;
let otherUserId;

async function request(
  path,
  { method = "GET", body, cookie, origin = baseURL.origin } = {},
) {
  const send = () => fetch(new URL(path, baseURL), {
    method,
    redirect: "manual",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await send();
  if (response.status !== 429) return response;
  // Test provisioning obeys the real production limiter. A definite rejection
  // can be retried; a failed or unknown write outcome is never replayed.
  const retryAfter = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
  assert.ok(retryAfter > 0 && retryAfter <= 10, "认证限流应提供有界 Retry-After");
  await setTimeout((retryAfter + 1) * 1000);
  return send();
}

function readCookie(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function expectLoginRedirect(cookie) {
  const response = await request("/dashboard", { cookie });
  assert.ok(
    [303, 307].includes(response.status),
    "未认证控制台请求应返回重定向",
  );
  assert.equal(
    new URL(response.headers.get("location"), baseURL).pathname,
    "/login",
  );
}

async function expectRejectedSession(cookie) {
  await expectLoginRedirect(cookie);
  const session = await request("/api/auth/get-session", { cookie });
  assert.equal((await session.json()) === null, true, "无效会话不能读取用户信息");
  const write = await request("/api/auth/update-user", {
    method: "POST", cookie, body: { name: "MUST_NOT_BE_WRITTEN" },
  });
  assert.equal(write.status, 401, "无效会话不能绕过界面直接写入");
}

try {
  for (const path of ["/", "/login"]) {
    assert.equal((await request(path)).status, 200, `${path} 应可访问`);
  }
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "geo-pro" });
  await expectRejectedSession();
  await expectRejectedSession("better-auth.session_token=forged.invalid");
  console.log("PASS: 公开路由、健康检查、未登录及伪造 Cookie 重定向");

  const invalidInput = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Phase 0 验证", email: "invalid-email", password },
  });
  assert.equal(invalidInput.status, 400, "服务端应拒绝无效邮箱");
  const shortPassword = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Phase 0 验证", email, password: "short" },
  });
  assert.equal(shortPassword.status, 400, "服务端应拒绝短密码");

  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Phase 0 验证", email, password },
  });
  assert.equal(signUp.status, 200, "真实注册应成功");
  const signUpBody = await signUp.json();
  assert.equal(signUpBody.user?.email, email);
  createdUserId = signUpBody.user.id;
  const signupCookie = readCookie(signUp);
  assert.ok(signupCookie.includes("session_token="), "注册应设置会话 Cookie");
  const storedAccounts =
    await sql`select password from account where user_id = ${createdUserId}`;
  assert.ok(
    storedAccounts.length === 1 &&
      storedAccounts[0].password &&
      storedAccounts[0].password !== password,
    "密码应以哈希持久化",
  );
  const session = await request("/api/auth/get-session", {
    cookie: signupCookie,
  });
  assert.equal((await session.json()).user?.id, createdUserId);
  const dashboard = await request("/dashboard", { cookie: signupCookie });
  assert.equal(dashboard.status, 200);
  assert.ok(
    (await dashboard.text()).includes("暂无监测数据"),
    "控制台应呈现真实空状态",
  );
  console.log(
    "PASS: 服务端输入校验、PostgreSQL 注册持久化、密码哈希、会话和控制台空状态",
  );

  const forbiddenOrigin = await request("/api/auth/sign-out", {
    method: "POST",
    cookie: signupCookie,
    body: {},
    origin: "https://untrusted.example.invalid",
  });
  assert.equal(forbiddenOrigin.status, 403, "应拒绝未信任来源");
  const signOut = await request("/api/auth/sign-out", {
    method: "POST",
    body: {},
    cookie: signupCookie,
  });
  assert.equal(signOut.status, 200);
  assert.equal(
    (await (
      await request("/api/auth/get-session", { cookie: signupCookie })
    ).json()) === null,
    true,
  );
  await expectRejectedSession(signupCookie);

  const invalidPassword = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password: `${password}-invalid` },
  });
  assert.equal(invalidPassword.status, 401, "应拒绝错误密码");
  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(signIn.status, 200, "已有账号应可真实登录");
  const loginCookie = readCookie(signIn);
  assert.equal(
    (await request("/dashboard", { cookie: loginCookie })).status,
    200,
  );

  const returnTarget = "/dashboard?filter=%E5%93%81%E7%89%8C#monitoring";
  const alreadySignedIn = await request(`/login?mode=signup&returnTo=${encodeURIComponent(returnTarget)}`, { cookie: loginCookie });
  assert.equal(alreadySignedIn.status, 307);
  assert.equal(new URL(alreadySignedIn.headers.get("location"), baseURL).href, new URL(returnTarget, baseURL).href);
  for (const target of ["https://untrusted.example.invalid", "//untrusted.example.invalid", "/dashboard/../login"]) {
    const response = await request(`/login?returnTo=${encodeURIComponent(target)}`, { cookie: loginCookie });
    assert.equal(new URL(response.headers.get("location"), baseURL).href, new URL("/dashboard", baseURL).href);
  }

  const otherSignUp = await request("/api/auth/sign-up/email", {
    method: "POST", body: { name: "Isolated account", email: otherEmail, password },
  });
  assert.equal(otherSignUp.status, 200);
  otherUserId = (await otherSignUp.json()).user.id;
  const isolatedRead = await request(`/api/auth/get-session?userId=${encodeURIComponent(otherUserId)}`, { cookie: loginCookie });
  assert.equal((await isolatedRead.json()).user.id, createdUserId, "外部 ID 不能替换会话身份");
  const isolatedWrite = await request("/api/auth/update-user", {
    method: "POST", cookie: loginCookie,
    body: { userId: otherUserId, id: otherUserId, name: "Updated own account" },
  });
  assert.equal(isolatedWrite.status, 200);
  const users = await sql`select id, name from "user" where id in (${createdUserId}, ${otherUserId})`;
  assert.equal(users.find((user) => user.id === createdUserId)?.name, "Updated own account");
  assert.equal(users.find((user) => user.id === otherUserId)?.name, "Isolated account", "替换 ID 不得修改另一用户");

  await sql`update session set expires_at = ${new Date(Date.now() - 60_000)} where user_id = ${createdUserId}`;
  await expectRejectedSession(loginCookie);
  const expiredUser = await sql`select name from "user" where id = ${createdUserId}`;
  assert.equal(expiredUser[0].name, "Updated own account", "失效会话写入没有改变数据");
  const reauthenticated = await request("/api/auth/sign-in/email", {
    method: "POST", body: { email, password },
  });
  assert.equal(reauthenticated.status, 200);
  const renewedCookie = readCookie(reauthenticated);
  assert.equal(
    (
      await request("/api/auth/sign-out", {
        method: "POST",
        body: {},
        cookie: renewedCookie,
      })
    ).status,
    200,
  );
  await expectRejectedSession(renewedCookie);
  console.log("PASS: 不可信来源拒绝、错误密码、真实登录和退出、伪造/过期/撤销会话读写拒绝");
  console.log("PASS: 已登录入口、安全返回地址、账号 ID 替换不能越权、失效后显式重新认证");
} finally {
  // Delete only the disposable account created by this run; no business data
  // or existing accounts are touched. FK cascades remove its sessions/account.
  if (createdUserId) {
    await sql`delete from "user" where id = ${createdUserId} and email = ${email}`;
    console.log("CLEANUP: 已清理本次验证账号及其会话");
  }
  if (otherUserId) {
    await sql`delete from "user" where id = ${otherUserId} and email = ${otherEmail}`;
    console.log("CLEANUP: 已清理隔离验证账号及其会话");
  }
  await sql.end();
}
