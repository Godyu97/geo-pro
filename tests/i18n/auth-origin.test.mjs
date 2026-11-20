import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrustedAppOrigin, trustedAppOrigins } from "../../src/lib/auth/origin.ts";

test("trustedAppOrigins accepts matching loopback host while keeping cross-origin and non-loopback strict", () => {
  const configured = "http://localhost:3000";

  assert.deepEqual(trustedAppOrigins(configured), ["http://localhost:3000"]);

  const loopback127 = new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  });
  assert.deepEqual(trustedAppOrigins(configured, loopback127), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  assert.equal(isTrustedAppOrigin(configured, loopback127), true);

  const loopbackAltPort = new Request("http://localhost:3001/api/auth/sign-up/email", {
    headers: { host: "localhost:3001", origin: "http://localhost:3001" },
  });
  assert.equal(isTrustedAppOrigin(configured, loopbackAltPort), true);

  const loopbackIPv6 = new Request("http://[::1]:3000/api/auth/sign-in/email", {
    headers: { host: "[::1]:3000", origin: "http://[::1]:3000" },
  });
  assert.equal(isTrustedAppOrigin(configured, loopbackIPv6), true);

  const crossPortCsrf = new Request("http://localhost:3000/api/auth/sign-out", {
    headers: { host: "localhost:3000", origin: "http://localhost:8080" },
  });
  assert.equal(isTrustedAppOrigin(configured, crossPortCsrf), false);

  const externalOrigin = new Request("http://localhost:3000/api/auth/sign-out", {
    headers: { host: "localhost:3000", origin: "https://untrusted.example.invalid" },
  });
  assert.equal(isTrustedAppOrigin(configured, externalOrigin), false);

  const spoofedHost = new Request("http://evil.invalid/api/auth/sign-out", {
    headers: { host: "evil.invalid", origin: "http://evil.invalid" },
  });
  assert.equal(isTrustedAppOrigin(configured, spoofedHost), false);

  const mismatchedForwardedHost = new Request("http://127.0.0.1:3000/api/auth/sign-out", {
    headers: {
      host: "127.0.0.1:3000",
      "x-forwarded-host": "evil.invalid",
      origin: "http://127.0.0.1:3000",
    },
  });
  assert.equal(isTrustedAppOrigin(configured, mismatchedForwardedHost), false);

  const production = "https://app.geopro.example";
  const prodLoopbackAttempt = new Request("https://127.0.0.1:3000/api/auth/sign-out", {
    headers: { host: "127.0.0.1:3000", origin: "https://127.0.0.1:3000" },
  });
  assert.deepEqual(trustedAppOrigins(production, prodLoopbackAttempt), [production]);
  assert.equal(isTrustedAppOrigin(production, prodLoopbackAttempt), false);
});
