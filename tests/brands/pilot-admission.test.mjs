import assert from "node:assert/strict";
import { test } from "node:test";
import { readPilotAdmission } from "../../src/features/brands/pilot-admission.ts";

const attested = {
  GEO_AUTH_MAIL_URL: "https://mail.example.invalid/send",
  GEO_AUTH_MAIL_SECRET: "not-a-real-secret",
  GEO_PILOT_EMAIL_DELIVERY_VERIFIED: "true",
  GEO_PILOT_RECOVERY_VERIFIED: "true",
  GEO_PILOT_RETENTION_DISCLOSED: "true",
  GEO_PILOT_BACKUP_DRILL_VERIFIED: "true",
  GEO_PILOT_AUTHORIZED: "true",
  GEO_BRAND_REAL_INTAKE: "true",
};

test("real brand intake stays closed until every server attestation is present", () => {
  const closed = readPilotAdmission({});
  assert.equal(closed.realIntakeOpen, false);
  assert.equal(closed.items.every((item) => item.met), false);

  const mocked = readPilotAdmission({ ...attested, GEO_AUTH_MAIL_MOCK: "true" });
  assert.equal(mocked.items.find((item) => item.id === "emailDelivery")?.met, false);
  assert.equal(mocked.realIntakeOpen, false);

  for (const key of Object.keys(attested)) {
    const partial = { ...attested };
    delete partial[key];
    assert.equal(readPilotAdmission(partial).realIntakeOpen, false, key);
  }

  const open = readPilotAdmission(attested);
  assert.equal(open.realIntakeOpen, true);
  assert.equal(open.items.every((item) => item.met), true);
});
