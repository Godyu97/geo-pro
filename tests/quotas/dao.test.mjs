import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { quotaChangeSchema } from "../../src/features/quotas/contracts.ts";
import { QuotaDao } from "../../src/features/quotas/dao.ts";
import { applyQuotaLedger, grantState } from "../../src/features/quotas/ledger.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const now = () => "2026-11-18T08:00:00.000Z";
const expiresAt = "2026-12-18T08:00:00.000Z";

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic B10", id + "@example.invalid"]);
  return id;
}

function grant(actorId, brandId, overrides = {}) {
  return { action: "set", actorId, brandId, kind: "sampling", operationId: randomUUID(), expectedVersion: null,
    reason: "pilot-approval", countLimit: 3, budgetMinor: 1000, currency: "CNY", expiresAt, ...overrides };
}

async function measureOwnerRead(db, owner, outsideBrand, otherOwner, operator) {
  const dao = new QuotaDao(db);
  for (const size of [10, 500]) {
    // Unrelated synthetic activity must not widen the owner summary query.
    const command = grant(operator, outsideBrand, { expectedVersion: null });
    if (size === 10) await updateQuota(db, operator, command, now);
    const brands = size === 10 ? [outsideBrand] : Array.from({ length: 49 }, randomUUID);
    if (size > 10) {
      // Exercise the active-owner index after ANALYZE with enough metadata
      // to distinguish it from a scan of a one-page brand table.
      const unrelated = [...brands, ...Array.from({ length: 500 }, randomUUID)];
      await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at) VALUES
        ${unrelated.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
      unrelated.flatMap((id) => [id, otherOwner, now()]));
      await queryWithParameters(db, `INSERT INTO quota_grant
        (brand_id, kind, version, action, operation_id, fingerprint, actor_id, reason, count_limit, budget_minor, currency, expires_at, changed_at)
        VALUES ${brands.map(() => "(?, 'sampling', 1, 'set', ?, 'synthetic', ?, 'pilot-approval', 10, 0, 'CNY', ?, ?)").join(", ")}`,
      brands.flatMap((id) => [id, randomUUID(), operator, expiresAt, now()]));
    }
    const rows = brands.flatMap((brandId) => Array.from({ length: 10 }, () => [brandId, randomUUID(), now()]));
    await queryWithParameters(db, `INSERT INTO quota_reservation
      (brand_id, kind, id, grant_version, upper_minor, state, created_at) VALUES
      ${rows.map(() => "(?, 'sampling', ?, 1, 0, 'reserved', ?)").join(", ")}`,
    rows.flat());
    if (db.kind === "postgresql") await db.query("ANALYZE brand, quota_reservation, quota_attempt, quota_grant");
    const received = [];
    const monitored = new QuotaDao({
      kind: db.kind,
      query: async (sql, args) => {
        received.push([sql, args]);
        return db.query(sql, args);
      },
    });
    const start = performance.now();
    assert.deepEqual(await monitored.ownerSummary(owner), await dao.ownerSummary(owner));
    assert.equal(received.length, 1);
    if (size === 500) {
      const [sql, values] = received[0];
      const prefix = db.kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
      const plan = JSON.stringify(await db.query(prefix + sql, values));
      assert.match(plan, /brand_active_owner_uidx|brand_owner_status_created_idx/);
      assert.match(plan, /quota_reservation_brand_id_kind_id_pk|quota_reservation_brand_recent_idx|sqlite_autoindex_quota_reservation_1/);
    }
    console.log(`${db.kind}: 1 owner summary query at ${size} unrelated slots (${(performance.now() - start).toFixed(2)} ms including control query)`);
  }
}

test("grant input requires approved counts, currency, expiry and fixed reason", () => {
  const command = grant(randomUUID(), randomUUID());
  assert.equal(quotaChangeSchema.safeParse(command).success, true);
  for (const extra of [{ countLimit: 0 }, { budgetMinor: 0.1 }, { currency: "XXX" },
    { expiresAt: "tomorrow" }, { reason: "free-form input" }, { details: "extra" }]) {
    assert.equal(quotaChangeSchema.safeParse({ ...command, ...extra }).success, false);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: migration, scoped versioned grants, reservations and cost reconciliation`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const brandDao = new BrandDao(db);
    const dao = new QuotaDao(db);
    await migrateThrough(db, kind === "sqlite" ? "0002_cheerful_sugar_man" : "0003_dashing_nightshade");
    const [owner, outsider, operator, secondOperator] = await Promise.all(Array.from({ length: 4 }, () => account(db)));
    const brand = randomUUID(), outsideBrand = randomUUID();
    await brandDao.insertBrand(owner, brand, now());
    await brandDao.insertBrand(outsider, outsideBrand, now());
    for (let repeat = 0; repeat < 2; repeat++) {
      execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
    }
    const ddl = await testDatabase(kind, { ddl: true });
    try { assert.deepEqual(await structure(db), await structure(ddl.connection)); }
    finally { await ddl.cleanup(); }

    assert.equal((await dao.ownerSummary(owner)).length, 2);
    assert.equal((await dao.ownerSummary(owner)).every(({ grant }) => grant === null), true);
    assert.equal((await dao.ownerSummary(operator)).length, 0);
    const create = grant(operator, brand);
    assert.equal((await updateQuota(db, owner, { ...create, actorId: owner }, now)).reason, "not-granted");
    for (const id of [operator, secondOperator]) {
      assert.equal((await changeMaintenanceGrant(db, { action: "grant", operatorId: id, userId: id, permission: "quotas.manage", reason: "initial-setup" })).status, "allowed");
    }
    const execute = (command, actor = operator) => updateQuota(db, actor, command, now);
    assert.equal((await execute({ ...create, expiresAt: now() })).data.error, "INVALID_INPUT");
    const first = (await execute(create)).data;
    assert.equal(first.before, null);
    assert.equal(first.after.version, 1);
    assert.deepEqual((await execute(create)).data, first);
    assert.equal((await execute({ ...create, budgetMinor: 800 })).data.error, "OPERATION_CONFLICT");
    assert.equal((await execute(create, secondOperator)).data.error, "SESSION_CHANGED");
    assert.equal((await dao.ownerSummary(outsider)).every(({ grant }) => grant === null), true);
    assert.equal((await execute(grant(operator, brand, { kind: "generation", currency: "JPY" }))).data.after.version, 1);

    const racing = await Promise.all([
      execute(grant(operator, brand, { expectedVersion: 1, countLimit: 4, reason: "budget-increase" })),
      execute(grant(secondOperator, brand, { expectedVersion: 1, countLimit: 4, reason: "budget-increase" }), secondOperator),
    ]);
    assert.equal(racing.filter(({ data }) => data.after?.version === 2).length, 1);
    assert.equal(racing.find(({ data }) => data.error === "VERSION_CONFLICT").data.current.version, 2);

    const auditFailure = { ...db, transaction: (work) => db.transaction((tx) => work({
      ...tx,
      query(sql, values) {
        if (sql.startsWith("INSERT INTO maintenance_audit")) throw new Error("synthetic audit failure");
        return tx.query(sql, values);
      },
    })) };
    const adjusts = grant(operator, brand, { expectedVersion: 2, countLimit: 1, budgetMinor: 400, reason: "budget-decrease" });
    assert.equal((await updateQuota(auditFailure, operator, adjusts, now)).status, "unavailable");
    assert.equal((await dao.grant(brand, "sampling")).version, 2);
    assert.equal(await dao.previousChange(adjusts), null);

    const slot = { brandId: brand, kind: "sampling", reservationId: randomUUID() };
    const unused = { ...slot, reservationId: randomUUID() };
    const ledger = (input, date = now, scope = owner) => applyQuotaLedger(db, scope, input, date);
    const reserve = { ...slot, action: "reserve", version: 2, upperMinor: 650, currency: "CNY" };
    assert.equal(await ledger(reserve, now, outsider), "not-found");
    assert.equal(await ledger({ ...reserve, version: 1 }), "conflict");
    assert.equal(await ledger({ ...reserve, currency: "USD" }), "not-entitled");
    assert.equal(await ledger({ ...reserve, reservationId: unused.reservationId, upperMinor: 1100 }), "over-limit");
    assert.deepEqual((await Promise.all([ledger(reserve), ledger(reserve)])).sort(), ["applied", "replayed"]);
    assert.equal(await ledger({ ...reserve, upperMinor: 600 }), "conflict");
    assert.equal(await ledger({ ...reserve, reservationId: unused.reservationId, upperMinor: 150 }), "applied");

    const start = { ...slot, action: "start", attemptId: randomUUID(), upperMinor: 400, currency: "CNY" };
    assert.deepEqual((await Promise.all([ledger(start), ledger(start)])).sort(), ["applied", "replayed"]);
    assert.equal(await ledger({ ...slot, action: "reconcile", currency: "CNY", attemptId: start.attemptId, actualMinor: 50 }), "applied");
    const retry = { ...start, attemptId: randomUUID(), upperMinor: 600 };
    assert.equal(await ledger(retry), "applied");
    assert.equal(await ledger({ ...slot, action: "reconcile", currency: "CNY", attemptId: retry.attemptId, actualMinor: null }), "applied");
    assert.equal(await ledger({ ...slot, action: "release", noFurtherResult: true }), "unresolved");
    assert.deepEqual(await dao.ledger(brand, slot.kind), {
      reserved: 2, settled: 0, actualMinor: 50, committedMinor: 800, unresolved: 1, records: 2,
    });
    assert.equal((await execute({ ...adjusts, currency: "JPY" })).data.error, "CURRENCY_CONFLICT");

    assert.equal((await execute(adjusts)).data.after.version, 3);
    assert.equal(await ledger({ ...reserve, reservationId: randomUUID(), version: 3, upperMinor: 0 }), "over-limit");
    assert.equal(await ledger({ ...start, attemptId: randomUUID(), reservationId: unused.reservationId, upperMinor: 0 }), "over-limit");
    assert.equal(await ledger({ ...unused, action: "release", noFurtherResult: true }), "applied");
    assert.equal(await ledger({ ...unused, action: "release", noFurtherResult: true }), "replayed");
    const revoke = { action: "revoke", actorId: operator, brandId: brand, kind: "sampling", expectedVersion: 3, operationId: randomUUID(), reason: "pilot-ended" };
    assert.equal((await execute(revoke)).data.after.action, "revoke");
    assert.equal(await ledger({ ...reserve, reservationId: randomUUID(), version: 4 }), "not-entitled");
    assert.equal(await ledger({ ...slot, action: "settle" }, () => expiresAt), "applied");
    assert.equal(await ledger({ ...slot, action: "settle" }, () => expiresAt), "replayed");
    assert.equal((await dao.ledger(brand, slot.kind)).committedMinor, 650);
    const reconciliation = { ...slot, action: "reconcile", currency: "CNY", attemptId: retry.attemptId, actualMinor: 210 };
    assert.equal(await ledger({ ...reconciliation, currency: "JPY" }), "conflict");
    assert.equal(await ledger(reconciliation, () => expiresAt), "applied");
    assert.equal(await ledger(reconciliation), "replayed");
    assert.equal(await ledger({ ...reconciliation, actualMinor: 0 }), "conflict");
    assert.deepEqual(await dao.ledger(brand, slot.kind), {
      reserved: 0, settled: 1, actualMinor: 260, committedMinor: 260, unresolved: 0, records: 2,
    });
    const awarded = (await dao.ownerSummary(owner)).find((item) => item.kind === "generation").grant;
    assert.equal(grantState(awarded, expiresAt), "expired");
    assert.equal(await ledger({ ...reserve, kind: "generation", version: 1, currency: "JPY" }, () => expiresAt), "not-entitled");
    await measureOwnerRead(db, owner, outsideBrand, outsider, operator);
  });
}
