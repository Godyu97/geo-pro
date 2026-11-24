import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import nextEnv from "@next/env";
import { parseDatabaseConfig } from "../src/lib/db/config.ts";
import { openConnection } from "../src/lib/db/connection.ts";
import { getWebCorsConfig } from "../src/lib/http/web-cors.ts";
import { MaintenanceDao } from "../src/features/maintenance/dao.ts";

nextEnv.loadEnvConfig(process.cwd());

const baseURL = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname),
  "认证验证脚本仅连接本地开发应用",
);
const config = parseDatabaseConfig(process.env);
assert.ok(config.success, "请明确配置开发数据库");
if (config.data.DATABASE_PROVIDER === "postgresql") {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.data.DATABASE_URL).hostname), "认证验证脚本仅修改本地开发数据库中的临时账号");
}
const connection = openConnection(config.data);
const dao = new MaintenanceDao(connection);
// All existing verification queries remain parameterized on both dialects.
const sql = (parts, ...values) => dao.query(parts.join("?"), values.map((value) => value instanceof Date ? connection.kind === "sqlite" ? value.getTime() : value.toISOString() : value));
const email = `phase0-${randomBytes(10).toString("hex")}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let createdUserId;
const otherEmail = `b02-other-${randomBytes(10).toString("hex")}@example.invalid`;
let otherUserId;

async function request(
  path,
  { method = "GET", body, cookie, origin = baseURL.origin, headers = {} } = {},
) {
  const send = () => fetch(new URL(path, baseURL), {
    method,
    redirect: "manual",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
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

async function verifyWebCors(origin, cookie, crossSiteCookies) {
  const untrusted = "https://untrusted.example.invalid";
  const preflight = (requestOrigin, method, headers = "content-type") => request("/api/auth/update-user", {
    method: "OPTIONS",
    origin: requestOrigin,
    headers: { "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers },
  });
  const allowed = await preflight(origin, "POST", "content-type, x-geo-profile-user");
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  assert.match(allowed.headers.get("vary") ?? "", /\bAccess-Control-Request-Headers\b/i);
  for (const denied of [
    await preflight(untrusted, "POST"),
    await preflight(origin, "DELETE"),
    await preflight(origin, "POST", "x-unlisted"),
  ]) {
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has("access-control-allow-origin"), false);
  }

  const authSession = await request("/api/auth/get-session", { origin, cookie });
  assert.equal(authSession.headers.get("access-control-allow-origin"), origin);
  assert.equal((await authSession.json()).user?.id, createdUserId);
  const update = await request("/api/auth/update-user", {
    method: "POST",
    origin,
    cookie,
    headers: { "x-geo-profile-user": createdUserId },
    body: { name: "Phase 0 验证" },
  });
  assert.equal(update.status, 200);
  assert.equal(update.headers.get("access-control-allow-origin"), origin);

  const overview = await request("/api/monitoring/overview", { origin, cookie });
  assert.equal(overview.status, 400, "可信来源应通过业务来源校验，到达参数校验");
  assert.equal(overview.headers.get("access-control-allow-origin"), origin);
  assert.match(overview.headers.get("vary") ?? "", /\bOrigin\b/i);
  assert.match(overview.headers.get("vary") ?? "", /\bAccept-Language\b/i);
  const write = await request("/api/monitoring/runs", { method: "POST", origin, cookie, body: {} });
  assert.equal(write.status, 400, "可信来源应通过业务写入的严格来源校验");
  assert.equal(write.headers.get("access-control-allow-origin"), origin);
  const anonymous = await request("/api/monitoring/overview", { origin });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("access-control-allow-origin"), origin);
  const rejected = await request("/api/monitoring/overview", { origin: untrusted, cookie });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.has("access-control-allow-origin"), false);
  if (crossSiteCookies) {
    const rejectedForm = await request("/api/health", {
      method: "POST", origin: untrusted, headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(rejectedForm.status, 403);
  }

  const page = await request("/login", { origin });
  assert.equal(page.headers.has("access-control-allow-origin"), false);
  console.log("PASS: Web API 跨域预检、带会话读写、错误响应和来源隔离");
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
    `PASS: 服务端输入校验、${connection.kind} 注册持久化、密码哈希、会话和控制台空状态`,
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
  const { origins, crossSiteCookies } = getWebCorsConfig();
  const frontendOrigin = [...origins].find((origin) => origin !== baseURL.origin);
  if (frontendOrigin) {
    if (crossSiteCookies) {
      assert.ok(signIn.headers.getSetCookie().some((value) =>
        /session_token=.*;.*\bSameSite=None\b/i.test(value) && /;\s*Secure\b/i.test(value)));
    }
    await verifyWebCors(frontendOrigin, loginCookie, crossSiteCookies);
  }

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
  const update = (body, options = {}) => request("/api/auth/update-user", {
    method: "POST", cookie: loginCookie, body, ...options,
  });
  for (const [body, code] of [
    [{ name: " \t " }, "nameRequired"],
    [{ name: false }, "nameRequired"],
    [{ name: "🚀".repeat(81) }, "nameMax"],
    [{ name: "Unapplied", id: otherUserId, userId: otherUserId }, "INVALID_PROFILE_INPUT"],
    [{ name: "Unapplied", email: otherEmail }, "INVALID_PROFILE_INPUT"],
    [{ name: "Unapplied", image: "https://example.invalid/profile.png" }, "INVALID_PROFILE_INPUT"],
  ]) {
    const rejected = await update(body);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, code);
  }
  const changedIdentity = await update({ name: "Unapplied" }, {
    headers: { "x-geo-profile-user": otherUserId },
  });
  assert.equal(changedIdentity.status, 409);
  assert.equal((await changedIdentity.json()).code, "PROFILE_SESSION_CHANGED");
  assert.equal((await update({ name: "Unapplied" }, { origin: "https://untrusted.example.invalid" })).status, 403);
  const profiles = () => sql`select id, name, email, image from "user" where id in (${createdUserId}, ${otherUserId})`;
  const before = await profiles();
  assert.equal(before.find((user) => user.id === createdUserId)?.name, "Phase 0 验证");
  assert.equal(before.find((user) => user.id === otherUserId)?.name, "Isolated account");

  const name = `界é${"🚀".repeat(78)}`;
  const ownHeaders = { headers: { "x-geo-profile-user": createdUserId } };
  assert.equal((await update({ name: ` ${name}\n` }, ownHeaders)).status, 200);
  const updatedSession = await (await request("/api/auth/get-session", { cookie: loginCookie })).json();
  assert.equal(updatedSession.user.name, name, "双库按 Unicode 字符计算边界并保留原文");
  assert.equal(updatedSession.user.email, email);

  const finalName = "Updated own account";
  const concurrent = await Promise.all([
    update({ name: finalName }, ownHeaders),
    update({ name: finalName }, ownHeaders),
  ]);
  assert.ok(concurrent.every((response) => response.status === 200), "并发重复写入应得到一致称呼");
  const after = await profiles();
  for (const previous of before) {
    const updated = after.find((user) => user.id === previous.id);
    assert.ok(updated);
    assert.deepEqual({ ...updated }, {
      ...previous,
      name: previous.id === createdUserId ? finalName : previous.name,
    });
  }
  console.log(`PASS: ${connection.kind} 本人称呼写入、Unicode 边界、额外字段与旧身份拒绝、邮箱和另一账号隔离、并发重复写入`);

  await sql`update session set expires_at = ${new Date(Date.now() - 60_000)} where user_id = ${createdUserId}`;
  await expectRejectedSession(loginCookie);
  const expiredUser = await sql`select name from "user" where id = ${createdUserId}`;
  assert.equal(expiredUser[0].name, finalName, "失效会话写入没有改变数据");
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
  await connection.close();
}
