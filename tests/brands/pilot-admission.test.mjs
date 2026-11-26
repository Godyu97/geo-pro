import assert from "node:assert/strict";
import { test } from "node:test";
import { brandFieldsSchema } from "../../src/features/brands/contracts.ts";
import { brandIntakeOrigin, brandMaterialAccess, explainDevIntake } from "../../src/features/brands/intake.ts";
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

const devHeaders = {
  get(name) {
    if (name === "host") return "127.0.0.1:3121";
    return null;
  },
};

const devEnv = {
  GEO_BRAND_DEV_INTAKE: "true",
  GEO_BRAND_DEV_INTAKE_DATABASE: "geo-pro-dev-intake.sqlite",
  GEO_BRAND_DEV_INTAKE_ACTORS: "Owner@Example.invalid, peer@example.invalid",
  BETTER_AUTH_URL: "http://127.0.0.1:3121",
  DATABASE_PROVIDER: "sqlite",
  SQLITE_PATH: "/tmp/geo-pro-dev-intake.sqlite",
};

test("development intake opens for any signed-in user on the named database or NODE_ENV=development", () => {
  assert.equal(explainDevIntake(devHeaders, { ...devEnv, GEO_BRAND_DEV_INTAKE: "" }).status, "switch_missing");
  assert.equal(brandIntakeOrigin(devHeaders, { ...devEnv, GEO_BRAND_DEV_INTAKE: "" }), null);

  assert.equal(explainDevIntake(devHeaders, { ...devEnv, GEO_BRAND_DEV_INTAKE_DATABASE: "other.sqlite" }).status, "target_mismatch");
  assert.equal(brandIntakeOrigin(devHeaders, { ...devEnv, GEO_BRAND_DEV_INTAKE_DATABASE: "other.sqlite" }), null);
  assert.equal(explainDevIntake(devHeaders, { ...devEnv, SQLITE_PATH: "/tmp/other.sqlite" }).status, "target_mismatch");

  assert.equal(explainDevIntake({ get: () => "evil.example" }, devEnv).status, "host_mismatch");
  assert.equal(brandIntakeOrigin({ get: () => "evil.example" }, devEnv), null);

  assert.equal(explainDevIntake(devHeaders, { ...devEnv, GEO_FUNCTIONAL_MOCK: "1" }).status, "lane_conflict");
  assert.equal(brandIntakeOrigin(devHeaders, { ...devEnv, GEO_FUNCTIONAL_MOCK: "1" }), null);
  assert.equal(readPilotAdmission(devEnv).realIntakeOpen, false);

  assert.deepEqual(brandIntakeOrigin(devHeaders, devEnv), { mode: "dev", origin: "http://127.0.0.1:3121" });
  assert.deepEqual(brandMaterialAccess(devHeaders, "owner@example.invalid", devEnv), {
    ok: true, origin: "http://127.0.0.1:3121", mode: "dev",
  });
  assert.deepEqual(brandMaterialAccess(devHeaders, "outsider@example.invalid", {
    ...devEnv,
    GEO_BRAND_DEV_INTAKE_ACTORS: "",
  }), {
    ok: true, origin: "http://127.0.0.1:3121", mode: "dev",
  });
  assert.deepEqual(brandMaterialAccess(devHeaders, "anyone@example.invalid", {
    NODE_ENV: "development",
    BETTER_AUTH_URL: "http://127.0.0.1:3121",
    DATABASE_PROVIDER: "sqlite",
    SQLITE_PATH: "/tmp/geo-pro-dev-intake.sqlite",
  }), {
    ok: true, origin: "http://127.0.0.1:3121", mode: "dev",
  });
  assert.equal(brandMaterialAccess(devHeaders, "owner@example.invalid", attested).ok, false);

  const fixtureEnv = {
    ...devEnv,
    GEO_BRANDS_FIXTURE: "1",
    GEO_FUNCTIONAL_MOCK: "1",
  };
  assert.equal(brandIntakeOrigin(devHeaders, fixtureEnv).mode, "fixture");
  assert.equal(brandMaterialAccess(devHeaders, "outsider@example.invalid", fixtureEnv).mode, "fixture");
});
