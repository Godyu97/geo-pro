import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { executeBrandCommand, shortenBrandRecoveryDeadline } from "../../src/features/brands/commands.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { prepareExport, readExportFile } from "../../src/features/data-exports/service.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { QuotaDao } from "../../src/features/quotas/dao.ts";
import { applyQuotaLedger } from "../../src/features/quotas/ledger.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";
import { ensureRetentionPolicy } from "./retention-setup.mjs";

const frozenAt = "2026-11-18T08:00:00.000Z";
const restoreUntil = "2026-12-18T08:00:00.000Z";
const clock = (time) => () => new Date(time);
const loginAt = new Date("2026-11-18T08:01:00.000Z");
const session = { emailVerified: true, createdAt: loginAt };
const fields = { ...initialBrandFields, name: "Synthetic retention fixture", description: "Synthetic B06 data" };
const action = (actorId, input) => ({ actorId, operationId: randomUUID(), ...input });

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: deletion is atomic, owner-scoped, and reversible within the approved deadline`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(fixture.cleanup);
    const db = fixture.connection;
    const dao = new BrandDao(db);
    const [owner, outsider, operator, brandId] = Array.from({ length: 4 }, randomUUID);
    const readPlans = [];

    await migrateThrough(db, kind === "sqlite" ? "0003_nostalgic_komodo" : "0004_mute_manta");
    for (const id of [owner, outsider, operator]) {
      await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic B06", id + "@example.invalid"]);
    }
    await dao.insertBrand(owner, brandId, frozenAt);
    await dao.insertVersion(brandId, 1, fields, frozenAt);
    const draftVersion = randomUUID();
    await dao.saveDraft(owner, brandId, draftVersion, 1, 1, fields, frozenAt);
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "pipe" });
    assert.equal((await dao.deletionState(owner, brandId)).frozenAt, null);

    await changeMaintenanceGrant(db, { action: "grant", operatorId: operator, userId: operator, permission: "quotas.manage", reason: "initial-setup" });
    const grant = action(operator, {
      action: "set", brandId, kind: "sampling", expectedVersion: null, reason: "pilot-approval",
      countLimit: 2, budgetMinor: 100, currency: "CNY", expiresAt: restoreUntil,
    });
    const quotaClock = () => frozenAt;
    assert.equal((await updateQuota(db, operator, grant, quotaClock)).data.after.version, 1);
    const slot = { brandId, kind: "sampling", reservationId: randomUUID() };
    const reserve = { ...slot, action: "reserve", version: 1, upperMinor: 50, currency: "CNY" };
    const attempt = { ...slot, attemptId: randomUUID(), currency: "CNY" };
    const start = { ...attempt, action: "start", upperMinor: 50 };
    const ledger = (command) => applyQuotaLedger(db, owner, command, quotaClock);
    assert.equal(await ledger(reserve), "applied");
    assert.equal(await ledger(start), "applied");

    const monitored = new BrandDao({ kind, query(sql, values) {
      readPlans.push([sql, values]);
      return db.query(sql, values);
    } });
    const expectedImpact = { id: brandId, revision: 1, name: fields.name, versions: 1, drafts: 1, facts: 0, materials: 0, promptSets: 0, reservations: 1, unresolvedAttempts: 1 };
    assert.deepEqual(await monitored.deletionImpact(owner, brandId), expectedImpact);
    assert.equal(await dao.deletionImpact(outsider, brandId), null);
    assert.equal((await dao.deletionState(owner, brandId)).revision, 1);
    assert.equal(readPlans.length, 1);
    const explain = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const [impactSql, impactArgs] = readPlans[0];
    const impactPlan = JSON.stringify(await db.query(explain + impactSql, impactArgs));
    assert.match(impactPlan, /brand_version_brand_id_version_pk|sqlite_autoindex_brand_version_1/);
    assert.match(impactPlan, /quota_attempt_brand_id_kind_reservation_id_id_pk|sqlite_autoindex_quota_attempt_1/);
    console.log(`${kind} deletion preview: one SQL using version and ledger primary-key indexes`);

    const original = (await prepareExport(db, owner, { actorId: owner, scopes: ["brands"], previousId: null, locale: "zh-CN" })).summary;
    assert.ok(await readExportFile(db, owner, original.id, true));

    const freeze = action(owner, { action: "freeze", brandId, expectedBrandRevision: 1, confirmed: true });
    const run = (command, auth = session, time = frozenAt) => executeBrandCommand(db, command.actorId, command, auth, clock(time));
    assert.deepEqual(await run({ ...freeze, actorId: outsider }), { error: "NOT_FOUND" });
    const rejectRecord = { ...db, transaction: (work) => db.transaction((tx) => work({
      ...tx,
      query(sql, values) {
        if (sql.startsWith("INSERT INTO brand_operation")) throw new Error("Synthetic operation failure");
        return tx.query(sql, values);
      },
    })) };
    await assert.rejects(executeBrandCommand(rejectRecord, owner, freeze, session, clock(frozenAt)), /Synthetic operation failure/);
    assert.deepEqual(await dao.deletionImpact(owner, brandId), expectedImpact);

    const [first, retry] = await Promise.all([run(freeze), run(freeze)]);
    assert.deepEqual(first, { mutation: { kind: "deletion", id: brandId, revision: 2, restoreUntil } });
    assert.deepEqual(retry, first);
    assert.deepEqual(await run({ ...freeze, operationId: randomUUID() }), { error: "VERSION_CONFLICT" });
    assert.equal((await dao.frozen(owner)).items[0].id, brandId);
    assert.deepEqual((await dao.frozen(outsider)).items, []);
    assert.equal(await dao.active(owner), null);
    assert.equal(await dao.version(owner, brandId, 1), null);
    assert.equal(await dao.draft(owner, brandId), null);
    assert.deepEqual(await run(action(owner, { action: "discardDraft", brandId, expectedDraft: draftVersion })), { error: "NOT_FOUND" });
    assert.equal(await dao.deletionImpact(owner, brandId), null);
    assert.equal(await readExportFile(db, owner, original.id, true), null);
    assert.deepEqual(await dao.exportVersions(owner, 10), []);
    assert.deepEqual(await dao.exportDrafts(owner, 10, ""), []);
    assert.deepEqual(await new QuotaDao(db).ownerSummary(owner), []);
    assert.equal(await ledger({ ...reserve, reservationId: randomUUID() }), "not-entitled");
    assert.equal(await ledger(start), "not-entitled");
    assert.equal((await updateQuota(db, operator, grant, quotaClock)).data.error, "NOT_FOUND");
    assert.equal(await ledger({ ...attempt, action: "reconcile", actualMinor: 20 }), "applied");
    assert.equal(await ledger({ ...slot, action: "settle" }), "applied");
    assert.equal((await new QuotaDao(db).ledger(brandId, "sampling")).actualMinor, 20);

    const recover = action(owner, { action: "recover", brandId, expectedBrandRevision: 2 });
    const recoveryTime = "2026-11-18T08:02:00.000Z";
    assert.deepEqual(await run({ ...recover, actorId: outsider }, session, recoveryTime), { error: "NOT_FOUND" });
    const previousEmailMock = process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "false";
    try {
      assert.deepEqual(await run(recover, { ...session, emailVerified: false }, recoveryTime), { error: "IDENTITY_UNVERIFIED" });
    } finally {
      if (previousEmailMock === undefined) delete process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
      else process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = previousEmailMock;
    }
    assert.deepEqual(await run(recover, { ...session, createdAt: new Date(frozenAt) }, recoveryTime), { error: "REAUTH_REQUIRED" });
    assert.deepEqual(await run(recover, session, "2026-11-18T08:06:00.000Z"), { error: "REAUTH_REQUIRED" });
    assert.deepEqual(await run(recover, session, restoreUntil), { error: "RECOVERY_EXPIRED" });

    const replacement = (await run(action(owner, { action: "submit", target: null, expectedDraft: null, fields, acceptedPolicyVersion: await ensureRetentionPolicy(db) }))).mutation;
    assert.deepEqual(await run(recover, session, recoveryTime), { error: "LIMIT_REACHED" });
    await run(action(owner, { action: "archive", brandId: replacement.id, expectedBrandRevision: 1 }));
    assert.equal((await run(recover, session, recoveryTime)).mutation.revision, 3);
    assert.equal((await dao.active(owner)).id, brandId);
    assert.deepEqual((await dao.version(owner, brandId, 1)).fields, fields);
    assert.deepEqual(await dao.draft(owner, brandId), { version: draftVersion, baseRevision: 3, step: 1, fields });
    assert.equal(await readExportFile(db, owner, original.id, true), null);
    const renewed = (await prepareExport(db, owner, { actorId: owner, scopes: ["brands"], previousId: original.id, locale: "en" })).summary;
    assert.ok((await readExportFile(db, owner, renewed.id, true)).body.includes(brandId));

    const removedArchive = action(owner, { action: "freeze", brandId: replacement.id, expectedBrandRevision: 2, confirmed: true });
    assert.equal((await run(removedArchive)).mutation.revision, 3);
    assert.deepEqual((await dao.archived(owner)).items, []);
    const earlyRequest = { ownerId: owner, brandId: replacement.id, operatorId: operator,
      requestId: randomUUID(), expectedBrandRevision: 3, restoreUntil: recoveryTime };
    const operation = () => shortenBrandRecoveryDeadline(db, earlyRequest, clock(recoveryTime));
    assert.deepEqual(await shortenBrandRecoveryDeadline(db, { ...earlyRequest, restoreUntil }, clock(recoveryTime)), { error: "INVALID_INPUT" });
    assert.deepEqual(await shortenBrandRecoveryDeadline(db, { ...earlyRequest, operatorId: randomUUID() }, clock(recoveryTime)), { error: "NOT_FOUND" });
    const scheduled = await operation();
    assert.deepEqual(await operation(), scheduled);
    assert.equal(scheduled.mutation.restoreUntil, recoveryTime);
    const recoverArchive = action(owner, { action: "recover", brandId: replacement.id, expectedBrandRevision: 4 });
    assert.deepEqual(await run(recoverArchive, session, recoveryTime), { error: "RECOVERY_EXPIRED" });
    assert.equal((await dao.frozen(owner)).items[0].id, replacement.id);
    const cli = execFileSync("pnpm", ["brands:shorten-recovery", owner, replacement.id, operator, randomUUID(), "4", frozenAt],
      { env: { ...process.env, ...fixture.env }, encoding: "utf8", stdio: "pipe" });
    assert.deepEqual(JSON.parse(cli), { id: replacement.id, revision: 5, restoreUntil: frozenAt });

    const refreeze = action(owner, { action: "freeze", brandId, expectedBrandRevision: 3, confirmed: true });
    assert.equal((await run(refreeze)).mutation.revision, 4);
    const competingRecovery = action(owner, { action: "recover", brandId, expectedBrandRevision: 4 });
    const competingRequest = { ...earlyRequest, brandId, requestId: randomUUID(), expectedBrandRevision: 4 };
    const competing = await Promise.all([
      run(competingRecovery, session, recoveryTime),
      shortenBrandRecoveryDeadline(db, competingRequest, clock(recoveryTime)),
    ]);
    assert.equal(competing.filter(({ mutation }) => mutation).length, 1);
    assert.equal((await dao.deletionState(owner, brandId)).revision, 5);
  });
}
