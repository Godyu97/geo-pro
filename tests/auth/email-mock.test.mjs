import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import { hasVerifiedEmail, isEmailVerificationMocked, isMailMockEnabled } from "../../src/lib/auth/verified-email.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

test("hasVerifiedEmail respects GEO_AUTH_EMAIL_VERIFIED_MOCK only for authenticated users", () => {
  const previous = process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
  try {
    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "true";
    assert.equal(isEmailVerificationMocked(), true);
    assert.equal(hasVerifiedEmail(null), false);
    assert.equal(hasVerifiedEmail(undefined), false);
    assert.equal(hasVerifiedEmail({ emailVerified: false }), true);

    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "false";
    assert.equal(isEmailVerificationMocked(), false);
    assert.equal(hasVerifiedEmail({ emailVerified: false }), false);
    assert.equal(hasVerifiedEmail({ emailVerified: true }), true);
  } finally {
    if (previous === undefined) delete process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
    else process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = previous;
  }
});

test("MonitoringDao.emailVerified honors GEO_AUTH_EMAIL_VERIFIED_MOCK for existing users only", async (t) => {
  const fixture = await testDatabase("sqlite");
  t.after(() => fixture.cleanup());
  const db = fixture.connection;
  const userId = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [userId, "Mock Email User", `${userId}@example.invalid`, 0],
  );

  const dao = new MonitoringDao(db);
  const previous = process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
  try {
    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "false";
    assert.equal(await dao.emailVerified(userId), false);
    assert.equal(await dao.emailVerified(randomUUID()), false);

    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "true";
    assert.equal(await dao.emailVerified(userId), true);
    assert.equal(await dao.emailVerified(randomUUID()), false);
  } finally {
    if (previous === undefined) delete process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
    else process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = previous;
  }
});

test("isMailMockEnabled honors GEO_AUTH_MAIL_MOCK and stays strict when disabled", () => {
  assert.equal(isMailMockEnabled({ GEO_AUTH_MAIL_MOCK: "true" }), true);
  assert.equal(isMailMockEnabled({ GEO_AUTH_MAIL_MOCK: " TRUE " }), true);
  assert.equal(isMailMockEnabled({ GEO_AUTH_MAIL_MOCK: "1" }), true);
  assert.equal(isMailMockEnabled({ GEO_AUTH_MAIL_MOCK: "false" }), false);
  assert.equal(isMailMockEnabled({ GEO_AUTH_MAIL_MOCK: "0" }), false);
  assert.equal(isMailMockEnabled({}), false);

  const previous = process.env.GEO_AUTH_MAIL_MOCK;
  try {
    process.env.GEO_AUTH_MAIL_MOCK = "true";
    assert.equal(isMailMockEnabled(), true);
    process.env.GEO_AUTH_MAIL_MOCK = "false";
    assert.equal(isMailMockEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.GEO_AUTH_MAIL_MOCK;
    else process.env.GEO_AUTH_MAIL_MOCK = previous;
  }
});
