import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsOptionalApiOrigin } from "../../src/lib/http/web-cors.ts";

test("optional origin uses the configured public origin behind a proxy", (t) => {
  const previous = { ...process.env };
  t.mock.property(process, "env", {
    ...previous,
    BETTER_AUTH_URL: "https://app.example.test",
    GEO_WEB_ALLOWED_ORIGINS: "https://console.example.test",
    GEO_WEB_CROSS_SITE_COOKIES: "false",
  });
  const internal = "http://localhost:3000";
  const request = (origin) => new Request(`${internal}/api/content`, {
    headers: origin ? { Origin: origin } : undefined,
  });

  assert.equal(allowsOptionalApiOrigin(request("https://app.example.test")), true);
  assert.equal(allowsOptionalApiOrigin(request("https://console.example.test")), true);
  assert.equal(allowsOptionalApiOrigin(request(internal)), false);
  assert.equal(allowsOptionalApiOrigin(request(internal), internal), true);
  assert.equal(allowsOptionalApiOrigin(request("https://untrusted.example.test")), false);
  assert.equal(allowsOptionalApiOrigin(request()), true);
});
