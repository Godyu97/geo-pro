import assert from "node:assert/strict";
import { test } from "node:test";
import { brandFieldsSchema } from "../../src/features/brands/contracts.ts";
import { brandIntakeOrigin } from "../../src/features/brands/intake.ts";
import { readPilotAdmission } from "../../src/features/brands/pilot-admission.ts";
import { mockBrandFields } from "../../src/features/functional-mock/brand-profile.ts";

const attested = {
  GEO_AUTH_MAIL_URL: "https://mail.example.invalid/send",
  GEO_AUTH_MAIL_SECRET: "not-a-real-secret",
  GEO_PILOT_EMAIL_DELIVERY_VERIFIED: "true",
  GEO_PILOT_RECOVERY_VERIFIED: "true",
  GEO_PILOT_RETENTION_DISCLOSED: "true",
  GEO_PILOT_BACKUP_DRILL_VERIFIED: "true",
  GEO_PILOT_AUTHORIZED: "true",
  GEO_BRAND_REAL_INTAKE: "true",
  BETTER_AUTH_URL: "https://pilot.example",
};

const headers = {
  get(name) {
    if (name === "host" || name === "x-forwarded-host") return "pilot.example";
    return null;
  },
};

test("real brand intake stays closed until every server attestation is present", () => {
  const closed = readPilotAdmission({});
  assert.equal(closed.realIntakeOpen, false);
  assert.equal(closed.items.every((item) => item.met), false);

  const mocked = readPilotAdmission({ ...attested, GEO_AUTH_MAIL_MOCK: "true" });
  assert.equal(mocked.items.find((item) => item.id === "emailDelivery")?.met, false);
  assert.equal(mocked.realIntakeOpen, false);

  for (const key of Object.keys(attested)) {
    if (key === "BETTER_AUTH_URL") continue;
    const partial = { ...attested };
    delete partial[key];
    assert.equal(readPilotAdmission(partial).realIntakeOpen, false, key);
  }

  const open = readPilotAdmission(attested);
  assert.equal(open.realIntakeOpen, true);
  assert.equal(open.items.every((item) => item.met), true);
});

test("brand writes follow the server gate and keep the loopback fixture separate", () => {
  assert.equal(brandIntakeOrigin(headers, {}), null);
  assert.equal(brandIntakeOrigin(headers, { ...attested, GEO_AUTH_MAIL_MOCK: "true" }), null);
  assert.equal(brandIntakeOrigin({ get: () => "evil.example" }, attested), null);

  assert.deepEqual(brandIntakeOrigin(headers, attested), { mode: "real", origin: "https://pilot.example" });

  const fixtureEnv = {
    GEO_BRANDS_FIXTURE: "1",
    BETTER_AUTH_URL: "http://127.0.0.1:3105",
    DATABASE_PROVIDER: "sqlite",
    SQLITE_PATH: "/tmp/geo-pro-pilot-admission.sqlite",
  };
  const loopback = { get: (name) => (name === "host" || name === "x-forwarded-host" ? "127.0.0.1:3105" : null) };
  assert.deepEqual(brandIntakeOrigin(loopback, fixtureEnv), { mode: "fixture", origin: "http://127.0.0.1:3105" });
  assert.deepEqual(brandIntakeOrigin(loopback, { ...fixtureEnv, ...attested, BETTER_AUTH_URL: fixtureEnv.BETTER_AUTH_URL }), {
    mode: "fixture",
    origin: "http://127.0.0.1:3105",
  });
});

test("functional mock opens labeled brand writes without pilot admission", () => {
  const env = { GEO_FUNCTIONAL_MOCK: "1", BETTER_AUTH_URL: "http://localhost:3000" };
  assert.equal(readPilotAdmission(env).realIntakeOpen, false);
  assert.equal(brandIntakeOrigin(headers, env), null);
  assert.deepEqual(brandIntakeOrigin({
    get(name) {
      if (name === "host") return "localhost:3000";
      return null;
    },
  }, env), { mode: "mock", origin: "http://localhost:3000" });
  assert.equal(brandIntakeOrigin({
    get(name) {
      if (name === "host") return "localhost:3000";
      if (name === "x-forwarded-host") return "evil.example";
      return null;
    },
  }, env), null);
  const fixtureEnv = {
    GEO_FUNCTIONAL_MOCK: "1",
    GEO_BRANDS_FIXTURE: "1",
    BETTER_AUTH_URL: "http://127.0.0.1:3105",
    DATABASE_PROVIDER: "sqlite",
    SQLITE_PATH: "/tmp/geo-pro-pilot-admission.sqlite",
  };
  const loopback = { get: (name) => (name === "host" || name === "x-forwarded-host" ? "127.0.0.1:3105" : null) };
  assert.equal(brandIntakeOrigin(loopback, fixtureEnv).mode, "fixture");
  const parsed = brandFieldsSchema.safeParse(mockBrandFields);
  assert.equal(parsed.success, true);
  assert.match(mockBrandFields.name, /FUNCTIONAL-MOCK/);
});
