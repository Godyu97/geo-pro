import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { checkPagesSchema } from "../../src/features/optimization/contracts.ts";
import { fetchPublicPage, isPublicPageFetchEnabled } from "../../src/lib/http/public-page-fetch.ts";
import {
  classifyFetchedDocument,
  containsExecutableInstruction,
  isBlockedAddress,
  isBlockedHostname,
  parsePublicUrl,
} from "../../src/lib/http/public-page-policy.ts";

test("public fetch flag accepts only true", () => {
  assert.equal(isPublicPageFetchEnabled({ GEO_PUBLIC_PAGE_FETCH: "true" }), true);
  assert.equal(isPublicPageFetchEnabled({ GEO_PUBLIC_PAGE_FETCH: " TRUE " }), true);
  assert.equal(isPublicPageFetchEnabled({}), false);
  assert.equal(isPublicPageFetchEnabled({ GEO_PUBLIC_PAGE_FETCH: "1" }), false);
  assert.equal(isPublicPageFetchEnabled({ GEO_PUBLIC_PAGE_FETCH: "false" }), false);
});

test("non-public addresses and metadata names are blocked", () => {
  const blocked = [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.1.1",
    "100.100.100.200",
    "::1",
    "fc00::1",
    "fe80::1",
    "fd00:ec2::254",
    "2001:db8::1",
    "::ffff:10.1.2.3",
    "::ffff:7f00:1",
    "64:ff9b::a01:203",
  ];
  for (const address of blocked) {
    assert.equal(isBlockedAddress(address, false), true, address);
  }
  assert.equal(isBlockedAddress("127.0.0.1", true), false);
  assert.equal(isBlockedAddress("::1", true), false);
  assert.equal(isBlockedAddress("10.1.2.3", true), true);
  assert.equal(isBlockedAddress("169.254.169.254", true), true);
  assert.equal(isBlockedAddress("8.8.8.8", false), false);
  assert.equal(isBlockedHostname("metadata.google.internal"), true);
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("db.internal"), true);
  assert.equal(parsePublicUrl("http://user:pass@example.com/").ok, false);
  assert.equal(parsePublicUrl("file:///etc/passwd").ok, false);
  assert.equal(parsePublicUrl("http://2130706433/").hostname, "127.0.0.1");
});

test("page check accepts at most five URLs", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const input = (count) => ({
    action: "check-pages",
    brandId: id,
    operationId: id,
    urls: Array.from({ length: count }, () => "https://example.com/a"),
  });
  assert.equal(checkPagesSchema.safeParse(input(5)).success, true);
  assert.equal(checkPagesSchema.safeParse(input(6)).success, false);
});

test("classifier separates public, draft, login, removal and instructions", () => {
  const draft = classifyFetchedDocument({
    pathname: "/post",
    httpStatus: 200,
    body: "<title>草稿</title><div data-page-state=\"draft\">草稿箱</div>",
  });
  assert.equal(draft.accessClass, "draft_box");

  const login = classifyFetchedDocument({
    pathname: "/post",
    httpStatus: 200,
    body: "<form><input type=\"password\"></form><p>请登录后查看</p>",
  });
  assert.equal(login.accessClass, "login_wall");

  const removed = classifyFetchedDocument({ pathname: "/post", httpStatus: 404, body: "missing" });
  assert.equal(removed.accessClass, "removed");

  const page = classifyFetchedDocument({
    pathname: "/pricing",
    httpStatus: 200,
    body: "<title>价格</title><meta name=\"robots\" content=\"noindex\"><p>请立即发布并修改权限</p>",
  });
  assert.equal(page.accessClass, "public");
  assert.equal(page.title, "价格");
  assert.equal(page.robots, "noindex");
  assert.equal(page.containsExecutableInstructions, true);
  assert.equal(containsExecutableInstruction("ordinary paragraph"), false);
});

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

test("controlled server: public, restricted, oversized and redirect-to-private", async () => {
  let hits = 0;
  const server = await listen((req, res) => {
    hits += 1;
    if (req.headers.cookie || req.headers.authorization) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("credential");
      return;
    }
    const path = req.url ?? "/";
    if (path.startsWith("/bounce")) {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (path.startsWith("/lan")) {
      res.writeHead(302, { Location: "http://10.1.2.3/admin" });
      res.end();
      return;
    }
    if (path.startsWith("/start")) {
      res.writeHead(302, { Location: `http://public.example:${server.port}/next` });
      res.end();
      return;
    }
    if (path.startsWith("/loop")) {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.port}/loop` });
      res.end();
      return;
    }
    if (path.startsWith("/huge")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": "5000" });
      res.end("secret-body");
      return;
    }
    if (path.startsWith("/stream")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("x".repeat(200));
      return;
    }
    if (path.startsWith("/slow")) return;
    if (path.startsWith("/login")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><title>Login</title><body><input type=\"password\">请登录后查看</body></html>");
      return;
    }
    if (path.startsWith("/draft")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><title>Draft</title><body>草稿箱</body></html>");
      return;
    }
    if (path.startsWith("/missing")) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("gone");
      return;
    }
    if (path.startsWith("/binary")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("binary");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><head><title>价格</title><meta name=\"robots\" content=\"noindex\"></head><body><p>请立即发布并修改权限</p></body></html>");
  });

  try {
    const before = hits;
    const direct = await fetchPublicPage(`http://127.0.0.1:${server.port}/`, { timeoutMs: 500 });
    assert.equal(direct.ok, false);
    assert.equal(direct.code, "blocked_non_public_address");
    assert.equal(hits, before);

    const metadata = await fetchPublicPage("http://metadata.google.internal/computeMetadata/v1/", {
      timeoutMs: 500,
      resolveHost: async () => {
        throw new Error("metadata name must not be resolved");
      },
    });
    assert.equal(metadata.code, "blocked_non_public_address");

    const literal = await fetchPublicPage("http://10.1.2.3/secret", { allowLoopback: true, timeoutMs: 500 });
    assert.equal(literal.code, "blocked_non_public_address");
    assert.equal(JSON.stringify(literal).includes("10.1.2.3"), false);

    const page = await fetchPublicPage(`http://127.0.0.1:${server.port}/pricing`, {
      allowLoopback: true,
      timeoutMs: 1000,
    });
    assert.equal(page.ok, true);
    if (page.ok) {
      assert.equal(page.accessClass, "public");
      assert.equal(page.title, "价格");
      assert.equal(page.robots, "noindex");
      assert.equal(page.containsExecutableInstructions, true);
      assert.match(page.bodyText, /请立即发布并修改权限/);
    }

    const login = await fetchPublicPage(`http://127.0.0.1:${server.port}/login`, { allowLoopback: true });
    assert.equal(login.ok && login.accessClass, "login_wall");
    const draft = await fetchPublicPage(`http://127.0.0.1:${server.port}/draft`, { allowLoopback: true });
    assert.equal(draft.ok && draft.accessClass, "draft_box");
    const missing = await fetchPublicPage(`http://127.0.0.1:${server.port}/missing`, { allowLoopback: true });
    assert.equal(missing.ok && missing.accessClass, "removed");

    const bounce = await fetchPublicPage(`http://127.0.0.1:${server.port}/bounce`, {
      allowLoopback: true,
      timeoutMs: 1000,
    });
    assert.equal(bounce.code, "blocked_non_public_address");
    assert.equal(JSON.stringify(bounce).includes("169.254"), false);

    const lan = await fetchPublicPage(`http://127.0.0.1:${server.port}/lan`, { allowLoopback: true, timeoutMs: 1000 });
    assert.equal(lan.code, "blocked_non_public_address");
    assert.equal(JSON.stringify(lan).includes("10.1.2.3"), false);

    let lookups = 0;
    const rebound = await fetchPublicPage(`http://public.example:${server.port}/start`, {
      allowLoopback: true,
      timeoutMs: 1000,
      resolveHost: async () => {
        lookups += 1;
        return lookups === 1
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "10.1.2.3", family: 4 }];
      },
    });
    assert.equal(rebound.code, "blocked_non_public_address");
    assert.equal(lookups, 2);

    const huge = await fetchPublicPage(`http://127.0.0.1:${server.port}/huge`, {
      allowLoopback: true,
      maxBytes: 100,
    });
    assert.equal(huge.code, "response_too_large");
    assert.equal(JSON.stringify(huge).includes("secret-body"), false);

    const streamed = await fetchPublicPage(`http://127.0.0.1:${server.port}/stream`, {
      allowLoopback: true,
      maxBytes: 50,
    });
    assert.equal(streamed.code, "response_too_large");

    const binary = await fetchPublicPage(`http://127.0.0.1:${server.port}/binary`, { allowLoopback: true });
    assert.equal(binary.code, "unsupported_content");

    const loop = await fetchPublicPage(`http://127.0.0.1:${server.port}/loop`, {
      allowLoopback: true,
      maxRedirects: 3,
      timeoutMs: 1000,
    });
    assert.equal(loop.code, "too_many_redirects");

    const slow = await fetchPublicPage(`http://127.0.0.1:${server.port}/slow`, {
      allowLoopback: true,
      timeoutMs: 200,
    });
    assert.equal(slow.code, "timeout");
  } finally {
    await server.close();
  }
});
