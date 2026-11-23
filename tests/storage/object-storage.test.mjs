import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { Agent, createServer as createTlsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createObjectStorage, parseStorageEnvironment } from "../../src/lib/storage/index.ts";

const secret = "s3-secret-not-for-logs";
const objectKey = "v1/owner/scope/internal-material/object/notes.txt";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseEnv(overrides = {}) {
  return {
    S3_ENDPOINT: "http://127.0.0.1:1",
    S3_REGION: "us-east-1",
    S3_BUCKET: "app-files",
    S3_ACCESS_KEY_ID: "local-app",
    S3_SECRET_ACCESS_KEY: secret,
    S3_FORCE_PATH_STYLE: "true",
    ...overrides,
  };
}

function captureConsole() {
  const lines = [];
  const methods = ["log", "info", "warn", "error", "debug"];
  const original = new Map();
  for (const method of methods) {
    original.set(method, console[method]);
    console[method] = (...args) => {
      lines.push(args.map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }).join(" "));
    };
  }
  return {
    lines,
    restore() {
      for (const [method, fn] of original) console[method] = fn;
    },
  };
}

function assertNoLeak(value, leaks) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const leak of leaks) assert.equal(text.includes(leak), false, `output contains ${leak}`);
}

async function listen(server, t) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 mock did not bind a TCP port.");
  return address.port;
}

function createS3Mock(behavior) {
  const requests = [];
  const objects = new Map();
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: req.method,
      path: url.pathname,
      host: req.headers.host,
      headers: req.headers,
      body,
      encrypted: Boolean(req.socket && "encrypted" in req.socket && req.socket.encrypted),
    });
    if (behavior.deny) {
      res.writeHead(403, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>${secret}</Message></Error>`);
      return;
    }
    if (req.method === "PUT") {
      objects.set(url.pathname, body);
      res.writeHead(200, { etag: '"stored"' });
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      if (behavior.deleteStatus) {
        res.writeHead(behavior.deleteStatus);
        res.end();
        return;
      }
      objects.delete(url.pathname);
      res.writeHead(204);
      res.end();
      return;
    }
    const stored = objects.get(url.pathname);
    if (!stored) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
      return;
    }
    const payload = behavior.corruptGet ? Buffer.from("different-bytes") : stored;
    const headers = {
      "content-type": "text/plain",
      "content-length": String(payload.length),
    };
    res.writeHead(req.method === "HEAD" ? 200 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(payload);
  };
  return { requests, objects, handler };
}

async function startHttpMock(t, behavior) {
  const mock = createS3Mock(behavior);
  const server = createServer(mock.handler);
  const port = await listen(server, t);
  return { ...mock, port, server };
}

async function reserveClosedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 mock did not bind a TCP port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function assertPlainPut(request, payload) {
  const headers = request.headers;
  const checksumHeaders = Object.keys(headers).filter((name) =>
    name.startsWith("x-amz-checksum") || name === "x-amz-trailer" || name === "x-amz-sdk-checksum-algorithm",
  );
  assert.deepEqual(checksumHeaders, []);
  assert.equal(headers["content-encoding"], undefined);
  assert.equal(headers["x-amz-acl"], undefined);
  assert.notEqual(headers["x-amz-content-sha256"], "STREAMING-AWS4-HMAC-SHA256-PAYLOAD");
  assert.notEqual(headers["x-amz-content-sha256"], "STREAMING-UNSIGNED-PAYLOAD-TRAILER");
  assert.match(String(headers["user-agent"]), /aws-sdk-js\//);
  assert.match(String(headers.authorization), /^AWS4-HMAC-SHA256 /);
  assert.equal(headers["x-amz-content-sha256"], sha256(payload));
  assert.equal(request.body.equals(Buffer.from(payload)), true);
  assert.equal(request.body.includes("aws-chunked"), false);
}

test("S3 endpoint and region are required, and path style is on unless explicitly disabled", () => {
  const base = baseEnv();
  const missing = parseStorageEnvironment({});
  assert.equal(missing.success, false);
  assert.equal(parseStorageEnvironment(baseEnv({ S3_ENDPOINT: undefined })).success, false);
  assert.equal(parseStorageEnvironment(baseEnv({ S3_REGION: " " })).success, false);

  const defaults = parseStorageEnvironment({ ...base, S3_FORCE_PATH_STYLE: undefined });
  assert.equal(defaults.success, true);
  if (!defaults.success) return;
  assert.equal(defaults.data.endpoint, base.S3_ENDPOINT);
  assert.equal(defaults.data.region, "us-east-1");
  assert.equal(defaults.data.forcePathStyle, true);
  assert.equal(defaults.data.browserEndpoint, undefined);
  assert.equal(defaults.data.browserEndpointInvalid, false);

  for (const value of ["true", "False", "0", " false"]) {
    const parsed = parseStorageEnvironment(baseEnv({ S3_FORCE_PATH_STYLE: value }));
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.forcePathStyle, true, value);
  }

  const virtual = parseStorageEnvironment(baseEnv({
    S3_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
    S3_ENDPOINT_BROWSER: "https://oss-cn-hangzhou.aliyuncs.com",
    S3_REGION: "oss-cn-hangzhou",
    S3_FORCE_PATH_STYLE: "false",
  }));
  assert.equal(virtual.success, true);
  if (!virtual.success) return;
  assert.equal(virtual.data.forcePathStyle, false);
  assert.equal(virtual.data.region, "oss-cn-hangzhou");
  assert.equal(virtual.data.endpoint, "https://oss-cn-hangzhou.aliyuncs.com");

  assert.equal(parseStorageEnvironment(baseEnv({ S3_ENDPOINT: "http://user:pass@127.0.0.1:8333" })).success, false);
  assert.equal(parseStorageEnvironment(baseEnv({ S3_ENDPOINT: "ftp://files.example" })).success, false);
  const invalidBrowser = parseStorageEnvironment(baseEnv({ S3_ENDPOINT_BROWSER: "not-a-url" }));
  assert.equal(invalidBrowser.success, true);
  if (!invalidBrowser.success) return;
  assert.equal(invalidBrowser.data.browserEndpointInvalid, true);
});

test("OSS-AC-01 writes and reads bytes through @aws-sdk/client-s3", async (t) => {
  const behavior = { deny: false, corruptGet: false };
  const mock = await startHttpMock(t, behavior);
  const { port } = mock;
  const payload = Buffer.from("geo-pro object bytes");
  const storage = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_ENDPOINT_BROWSER: "http://192.0.2.10:8333",
    }),
  });

  const stored = await storage.putAndReadBack({
    key: objectKey,
    body: payload,
    contentType: "text/plain",
  });
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  assert.equal(stored.status, "ready");
  assert.equal(stored.bucket, "app-files");
  assert.equal(stored.key, objectKey);
  assert.equal(stored.byteSize, payload.byteLength);
  assert.equal(stored.sha256, sha256(payload));
  assert.equal(stored.contentType, "text/plain");

  const put = mock.requests.find((request) => request.method === "PUT");
  assert.ok(put);
  assert.equal(put.path, `/app-files/${objectKey}`);
  assert.equal(put.host, `127.0.0.1:${port}`);
  assertPlainPut(put, payload);

  const read = await storage.getObject({ key: objectKey });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(Buffer.from(read.body).equals(payload), true);
  assert.equal(read.sha256, stored.sha256);

  const head = await storage.headObject({ key: objectKey });
  assert.equal(head.ok, true);
  if (!head.ok) return;
  assert.equal(head.byteSize, payload.byteLength);
  assert.ok(mock.requests.some((request) => request.method === "HEAD"));

  const removed = await storage.deleteObject({ key: objectKey });
  assert.deepEqual(removed, { ok: true });
  const missing = await storage.getObject({ key: objectKey });
  assert.deepEqual(missing, { ok: false, status: "failed", code: "rejected" });

  behavior.corruptGet = true;
  const mismatch = await storage.putAndReadBack({
    key: objectKey,
    body: payload,
    contentType: "text/plain",
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.code, "mismatch");
  assert.equal(mismatch.cleanup, "deleted");
  assert.equal(mock.objects.has(`/app-files/${objectKey}`), false);
});

test("OSS-AC-02 uses a virtual-hosted HTTPS request when path style is false", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "geo-s3-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=s3.mock.test",
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);

  const behavior = { deny: false, corruptGet: false };
  const mock = createS3Mock(behavior);
  const server = createTlsServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }, mock.handler);
  const port = await listen(server, t);
  const payload = Buffer.from("virtual-host bytes");
  const storage = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `https://s3.mock.test:${port}`,
      S3_ENDPOINT_BROWSER: `https://s3.mock.test:${port}`,
      S3_REGION: "oss-cn-hangzhou",
      S3_FORCE_PATH_STYLE: "false",
    }),
    requestHandler: {
      httpsAgent: new Agent({
        rejectUnauthorized: false,
        lookup(hostname, options, callback) {
          if (typeof options === "function") {
            callback = options;
            options = {};
          }
          if (options.all) {
            callback(null, [{ address: "127.0.0.1", family: 4 }]);
            return;
          }
          callback(null, "127.0.0.1", 4);
        },
      }),
    },
  });

  const stored = await storage.putAndReadBack({
    key: "v1/owner/scope/report-snapshot/object/report.json",
    body: payload,
    contentType: "application/json",
  });
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  assert.equal(stored.sha256, sha256(payload));
  const put = mock.requests.find((request) => request.method === "PUT");
  assert.ok(put);
  assert.equal(put.encrypted, true);
  assert.equal(put.host, `app-files.s3.mock.test:${port}`);
  assert.equal(put.path, "/v1/owner/scope/report-snapshot/object/report.json");
  assertPlainPut(put, payload);
  const read = await storage.getObject({ key: "v1/owner/scope/report-snapshot/object/report.json" });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(Buffer.from(read.body).equals(payload), true);
});

test("OSS-AC-03 presigns GetObject at the browser endpoint", async (t) => {
  const behavior = { deny: false, corruptGet: false };
  const mock = await startHttpMock(t, behavior);
  const { port } = mock;
  const browserEndpoint = "http://192.0.2.10:8333";
  const storage = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_ENDPOINT_BROWSER: browserEndpoint,
    }),
  });
  const payload = Buffer.from("browser bytes");
  const stored = await storage.putAndReadBack({
    key: objectKey,
    body: payload,
    contentType: "text/plain",
  });
  assert.equal(stored.status, "ready");
  const before = mock.requests.length;
  const logs = captureConsole();
  let signed;
  try {
    signed = await storage.presignGet({
      key: objectKey,
      contentType: "text/plain",
      fileName: "nested/../../notes.txt",
    });
  } finally {
    logs.restore();
  }
  assert.equal(mock.requests.length, before);
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const url = new URL(signed.url);
  const browser = new URL(browserEndpoint);
  assert.equal(url.protocol, browser.protocol);
  assert.equal(url.hostname, browser.hostname);
  assert.equal(url.port, browser.port);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(signed.expiresInSeconds, 300);
  assert.equal(url.searchParams.get("response-content-type"), "text/plain");
  const disposition = url.searchParams.get("response-content-disposition") ?? "";
  assert.match(disposition, /attachment;/);
  assert.match(disposition, /filename="notes.txt"/);
  assert.equal(disposition.includes("../"), false);
  assertNoLeak(signed, [secret, payload.toString()]);
  assertNoLeak(logs.lines.join("\n"), [secret, "X-Amz-Signature", payload.toString()]);

  const longest = await storage.presignGet({
    key: objectKey,
    contentType: "text/plain",
    fileName: "说明.txt",
    expiresInSeconds: 900,
  });
  assert.equal(longest.ok, true);
  if (!longest.ok) return;
  assert.equal(new URL(longest.url).searchParams.get("X-Amz-Expires"), "900");
  assert.match(new URL(longest.url).searchParams.get("response-content-disposition") ?? "", /filename\*=UTF-8''/);

  const tooLong = await storage.presignGet({
    key: objectKey,
    contentType: "text/plain",
    fileName: "notes.txt",
    expiresInSeconds: 901,
  });
  assert.deepEqual(tooLong, { ok: false, status: "failed", code: "rejected" });

  const virtual = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_ENDPOINT_BROWSER: "https://oss-cn-hangzhou.aliyuncs.com",
      S3_REGION: "oss-cn-hangzhou",
      S3_FORCE_PATH_STYLE: "false",
    }),
  });
  const ossUrl = await virtual.presignGet({
    key: objectKey,
    contentType: "text/plain",
    fileName: "notes.txt",
  });
  assert.equal(ossUrl.ok, true);
  if (!ossUrl.ok) return;
  const signedOss = new URL(ossUrl.url);
  assert.equal(signedOss.protocol, "https:");
  assert.equal(signedOss.hostname, "app-files.oss-cn-hangzhou.aliyuncs.com");
  assert.equal(signedOss.port, "");
  assert.match(signedOss.searchParams.get("X-Amz-Credential") ?? "", /oss-cn-hangzhou/);
  assert.equal(signedOss.hostname.includes("127.0.0.1"), false);

  const missingBrowser = createObjectStorage({
    env: baseEnv({ S3_ENDPOINT: `http://127.0.0.1:${port}` }),
  });
  const refused = await missingBrowser.presignGet({
    key: objectKey,
    contentType: "text/plain",
    fileName: "notes.txt",
  });
  assert.deepEqual(refused, { ok: false, status: "failed", code: "config" });
  assert.equal(JSON.stringify(refused).includes("127.0.0.1"), false);
});

test("OSS-AC-09 keeps a rejected upload failed and omits the secret", async (t) => {
  const behavior = { deny: true, corruptGet: false };
  const mock = await startHttpMock(t, behavior);
  const { port } = mock;
  const payload = Buffer.from("BODY-SHOULD-NOT-BE-LOGGED");
  const storage = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_ENDPOINT_BROWSER: "http://192.0.2.10:8333",
    }),
  });
  const logs = captureConsole();
  let result;
  try {
    result = await storage.putAndReadBack({
      key: objectKey,
      body: payload,
      contentType: "text/plain",
    });
  } finally {
    logs.restore();
  }
  assert.deepEqual(result, { ok: false, status: "failed", code: "rejected", cleanup: "pending" });
  assert.equal(result.status === "failed" && result.ok === false, true);
  assertNoLeak(result, [secret, payload.toString(), "X-Amz-Signature", "Authorization"]);
  assertNoLeak(logs.lines.join("\n"), [secret, payload.toString(), "X-Amz-Signature"]);

  const closedPort = await reserveClosedPort();
  const unreachable = createObjectStorage({
    env: baseEnv({
      S3_ENDPOINT: `http://127.0.0.1:${closedPort}`,
      S3_ENDPOINT_BROWSER: "http://192.0.2.10:8333",
    }),
  });
  const down = await unreachable.putAndReadBack({
    key: objectKey,
    body: payload,
    contentType: "text/plain",
  });
  assert.equal(down.ok, false);
  if (down.ok) return;
  assert.equal(down.status, "failed");
  assert.equal(down.code, "unavailable");
  assert.notEqual(down.status, "ready");
  assertNoLeak(down, [secret, payload.toString()]);

  const unconfigured = createObjectStorage({ env: {} });
  const missing = await unconfigured.putAndReadBack({
    key: objectKey,
    body: payload,
    contentType: "text/plain",
  });
  assert.deepEqual(missing, { ok: false, status: "failed", code: "config", cleanup: "not-stored" });

  const empty = await storage.putAndReadBack({
    key: objectKey,
    body: new Uint8Array(),
    contentType: "text/plain",
  });
  assert.equal(empty.code, "rejected");
  assert.equal(empty.cleanup, "not-stored");
  const huge = await storage.putAndReadBack({
    key: objectKey,
    body: new Uint8Array(10 * 1024 * 1024 + 1),
    contentType: "text/plain",
  });
  assert.equal(huge.ok, false);
  if (huge.ok) return;
  assert.equal(huge.cleanup, "not-stored");
});

test("business modules do not construct their own S3 clients", () => {
  const root = path.resolve("src");
  const offenders = [];
  const storageImports = { client: false, presigner: false };
  function walk(directory) {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      const usesClient = text.includes("@aws-sdk/client-s3");
      const usesPresigner = text.includes("@aws-sdk/s3-request-presigner");
      if (!usesClient && !usesPresigner) continue;
      if (!full.includes(`${path.sep}src${path.sep}lib${path.sep}storage${path.sep}`)) offenders.push(full);
      if (usesClient) storageImports.client = true;
      if (usesPresigner) storageImports.presigner = true;
    }
  }
  walk(root);
  assert.deepEqual(offenders, []);
  assert.equal(storageImports.client, true);
  assert.equal(storageImports.presigner, true);
});
