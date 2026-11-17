import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const baseURL = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname),
  "认证验证脚本仅连接本地开发应用",
);
assert.ok(process.env.DATABASE_URL, "请配置开发 DATABASE_URL");

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
const email = `phase0-${randomBytes(10).toString("hex")}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let createdUserId;

async function request(
  path,
  { method = "GET", body, cookie, origin = baseURL.origin } = {},
) {
  return fetch(new URL(path, baseURL), {
    method,
    redirect: "manual",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
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

try {
  for (const path of ["/", "/login"]) {
    assert.equal((await request(path)).status, 200, `${path} 应可访问`);
  }
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "geo-pro" });
  await expectLoginRedirect();
  await expectLoginRedirect("better-auth.session_token=forged.invalid");
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
    await (
      await request("/api/auth/get-session", { cookie: signupCookie })
    ).json(),
    null,
  );
  await expectLoginRedirect(signupCookie);

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
  assert.equal(
    (
      await request("/api/auth/sign-out", {
        method: "POST",
        body: {},
        cookie: loginCookie,
      })
    ).status,
    200,
  );
  await expectLoginRedirect(loginCookie);
  console.log("PASS: 不可信来源拒绝、错误密码、登录、退出和服务端会话撤销");
} finally {
  // Delete only the disposable account created by this run; no business data
  // or existing accounts are touched. FK cascades remove its sessions/account.
  if (createdUserId) {
    await sql`delete from "user" where id = ${createdUserId} and email = ${email}`;
    console.log("CLEANUP: 已清理本次验证账号及其会话");
  }
  await sql.end();
}
