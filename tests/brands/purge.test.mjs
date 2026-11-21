import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeBrandCommand, shortenBrandRecoveryDeadline } from "../../src/features/brands/commands.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { readAuthorizedReportEvidence, inspectBrandPurge, purgeDueBrands, retryBrandPurge } from "../../src/features/brands/purge.ts";
import { prepareExport, readExportFile } from "../../src/features/data-exports/service.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { applyQuotaLedger } from "../../src/features/quotas/ledger.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const before = "2026-10-01T00:00:00.000Z";
const freezeAt = "2026-10-02T00:00:00.000Z";
const earlyAt = "2026-10-02T01:00:00.000Z";
const dueAt = "2026-11-01T00:00:00.000Z";
const readAt = "2026-10-02T00:02:00.000Z";
const clock = (time) => () => time;
const session = { emailVerified: true, createdAt: new Date("2026-10-02T00:01:00.000Z") };
const fields = { ...initialBrandFields, name: "Synthetic purge fixture", description: "Synthetic customer body" };
const command = (actorId, options) => ({ actorId, operationId: randomUUID(), ...options });
const count = async (db, table) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`))[0].n);
const invokeCli = (env, ...args) => JSON.parse(execFileSync("pnpm", ["--silent", "brands:purge", ...args],
  { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" }));

// Back up all application rows present in the synthetic pre-freeze fixture.
// Build the destination through migrations first to exercise offline replay on
// the same schema that a restored installation uses.
const backupTables = ["user", "brand", "brand_version", "brand_draft", "brand_operation", "user_data_export", "stored_object"];
async function backupFixture(db) {
  return db.transaction(async (tx) => {
    const saved = [];
    for (const table of backupTables) saved.push([table, await tx.query(`SELECT * FROM "${table}"`)]);
    return saved;
  });
}

async function restoreFixture(db, saved) {
  await db.transaction(async (tx) => {
    for (const [table, rows] of saved) {
      for (const row of rows) {
        const columns = Object.keys(row).map((column) => `"${column}"`).join(", ");
        const values = Object.values(row).map((value) => value instanceof Date ? value.toISOString() : value);
        await queryWithParameters(tx, `INSERT INTO "${table}" (${columns}) VALUES (${values.map(() => "?").join(", ")})`, values);
      }
    }
  });
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: purge stages are bounded, retryable, owner-scoped and resilient to backup restore`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(fixture.cleanup);
    const db = fixture.connection;
    const sql = (query, params) => queryWithParameters(db, query, params);
    const ownerId = randomUUID();
    const outsider = randomUUID();
    const oldBrand = randomUUID();

    await migrateThrough(db, kind === "sqlite" ? "0004_glamorous_zuras" : "0005_same_energizer");
    for (const id of [ownerId, outsider]) {
      await sql('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic owner", id + "@example.invalid"]);
    }
    const brands = new BrandDao(db);
    await brands.insertBrand(ownerId, oldBrand, before);
    await brands.insertVersion(oldBrand, 1, fields, before);
    await sql("INSERT INTO brand_operation (owner_id, operation_id, fingerprint, result, created_at) VALUES (?, ?, ?, ?, ?)",
      [ownerId, randomUUID(), "legacy-fingerprint", JSON.stringify({ kind: "draft", version: randomUUID() }), before]);

    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "pipe" });
    assert.equal((await brands.version(ownerId, oldBrand, 1)).fields.name, fields.name);
    const fromDdl = await testDatabase(kind, { ddl: true });
    t.after(fromDdl.cleanup);
    assert.deepEqual(await structure(db), await structure(fromDdl.connection));

    // Keep this upgraded brand active as the purge target.
    const target = { ownerId, brandId: oldBrand };
    const draft = command(ownerId, {
      action: "saveDraft", expectedDraft: null, target: { brandId: oldBrand, expectedBrandRevision: 1 }, fields, step: 1,
    });
    const run = (input, at) => executeBrandCommand(db, input.actorId, input, session, () => new Date(at));
    assert.equal((await run(draft, before)).mutation.kind, "draft");
    const otherCreate = command(outsider, { action: "submit", target: null, expectedDraft: null, fields });
    const other = (await run(otherCreate, before)).mutation;
    const exported = (await prepareExport(db, ownerId, { actorId: ownerId, scopes: ["brands"], previousId: null, locale: "zh-CN" })).summary;
    await sql("UPDATE user_data_export SET created_at = ? WHERE owner_id = ?", [before, ownerId]);
    const otherExport = (await prepareExport(db, outsider, { actorId: outsider, scopes: ["brands"], previousId: null, locale: "en" })).summary;
    assert.ok(await readExportFile(db, ownerId, exported.id, true));

    const saved = await backupFixture(db);
    const snapshot = Buffer.from("Synthetic immutable report snapshot containing a computed total");
    const originalHash = createHash("sha256").update(snapshot).digest("hex");
    assert.equal((await readAuthorizedReportEvidence(db, target, snapshot)).evidence, "unchanged");

    await changeMaintenanceGrant(db, { action: "grant", operatorId: outsider, userId: outsider, permission: "quotas.manage", reason: "initial-setup" });
    const grant = command(outsider, { brandId: oldBrand, kind: "sampling", action: "set", reason: "pilot-approval",
      countLimit: 2, budgetMinor: 100, currency: "CNY", expiresAt: dueAt, expectedVersion: null });
    assert.equal((await updateQuota(db, outsider, grant, clock(before))).data.after.version, 1);
    const slot = { brandId: oldBrand, kind: "sampling", reservationId: randomUUID() };
    const reserve = { ...slot, action: "reserve", version: 1, upperMinor: 50, currency: "CNY" };
    const attempt = { ...slot, attemptId: randomUUID(), currency: "CNY" };
    assert.equal(await applyQuotaLedger(db, ownerId, reserve, clock(before)), "applied");
    assert.equal(await applyQuotaLedger(db, ownerId, { ...attempt, action: "start", upperMinor: 50 }, clock(before)), "applied");
    const freeze = (actorId, brandId, revision) => command(actorId, { action: "freeze", brandId, expectedBrandRevision: revision, confirmed: true });
    assert.equal((await run(freeze(ownerId, oldBrand, 1), freezeAt)).mutation.revision, 2);
    assert.equal((await run(freeze(outsider, other.id, 1), freezeAt)).mutation.revision, 2);
    assert.equal(await readExportFile(db, ownerId, exported.id, true), null);
    assert.deepEqual(await purgeDueBrands(db, {}, clock(readAt)), { results: [], next: null });
    assert.equal((await retryBrandPurge(db, target, clock(readAt))).status, "skipped");
    assert.equal((await retryBrandPurge(db, { ownerId: outsider, brandId: oldBrand }, clock(dueAt))).status, "skipped");
    assert.equal(await count(db, "brand_version"), 2);

    const candidateQueries = [];
    const candidates = new PurgeDao({ kind, query(query, params) {
      candidateQueries.push([query, params]);
      return db.query(query, params);
    } });
    const first = (await candidates.due(dueAt, 1))[0];
    const next = await candidates.due(dueAt, 1, { at: first.restoreUntil, id: first.brandId });
    assert.equal(next.length, 1);
    assert.notEqual(next[0].brandId, first.brandId);
    const [candidateSql, candidateParams] = candidateQueries[0];
    const queryPlan = await db.transaction(async (tx) => {
      // Force consideration of indexes for the two-row PostgreSQL fixture.
      if (kind === "postgresql") await tx.query("SET LOCAL enable_seqscan = off");
      const explain = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
      return tx.query(explain + candidateSql, candidateParams);
    });
    assert.match(JSON.stringify(queryPlan), /brand_due_purge_idx/);
    console.log(`${kind} purge candidate pages: one query per page using the deadline index`);

    const broken = { ...db, transaction: (work) => db.transaction((tx) => work({
      ...tx,
      savepoint: (stage) => tx.savepoint((sp) => stage({ ...sp, async query(query, params) {
        const rows = await sp.query(query, params);
        if (query.startsWith("DELETE FROM user_data_export")) throw new Error("Synthetic export failure after delete");
        return rows;
      } })),
    })) };
    const recovery = command(ownerId, { action: "recover", brandId: oldBrand, expectedBrandRevision: 2 });
    const competing = await Promise.all([run(recovery, readAt), retryBrandPurge(broken, target, clock(dueAt))]);
    let failing = competing[1];
    if (competing[0].mutation) {
      assert.equal(failing.status, "skipped");
      assert.equal((await run(freeze(ownerId, oldBrand, 3), freezeAt)).mutation.revision, 4);
      const short = await shortenBrandRecoveryDeadline(db, { ...target, operatorId: outsider, requestId: randomUUID(),
        expectedBrandRevision: 4, restoreUntil: earlyAt }, () => new Date(earlyAt));
      assert.equal(short.mutation.restoreUntil, earlyAt);
      failing = (await purgeDueBrands(broken, { limit: 1 }, clock(earlyAt))).results[0];
    } else {
      assert.equal(competing[0].error, "RECOVERY_EXPIRED");
    }
    assert.equal(failing.receipt.issue, "exports-failed");
    assert.deepEqual(failing.remaining, ["exports", "costs"]);
    assert.equal(await count(db, "user_data_export"), 2);
    assert.equal(await count(db, "brand_version"), 1);
    assert.equal(await count(db, "brand_draft"), 0);
    const stageQueries = [];
    const traced = { ...db, transaction: (work) => db.transaction((tx) => work({
      ...tx,
      savepoint: (stage) => tx.savepoint((sp) => stage({ ...sp, query(query, params) {
        stageQueries.push(query);
        return sp.query(query, params);
      } })),
    })) };
    assert.equal((await retryBrandPurge(traced, target, clock(dueAt))).receipt.issue, "unresolved-costs");
    assert.ok(!stageQueries.some((query) => query.startsWith("DELETE FROM brand_version")));
    const partial = await inspectBrandPurge(db, target);
    assert.deepEqual(partial.remaining, ["costs"]);
    assert.equal(await count(db, "user_data_export"), 1);
    assert.equal(await count(db, "brand_version"), 1);
    assert.equal(await count(db, "brand_draft"), 0);
    assert.equal(await count(db, "brand_purged_cost"), 0);
    assert.equal(await inspectBrandPurge(db, { ownerId: outsider, brandId: oldBrand }), null);
    assert.equal((await brands.operation(ownerId, draft.operationId)).fingerprint, "");
    assert.equal((await brands.operation(outsider, otherCreate.operationId)).fingerprint.length, 64);
    assert.equal(await applyQuotaLedger(db, outsider, { ...attempt, action: "reconcile", actualMinor: 14 }, clock(dueAt)), "not-found");
    assert.equal(await applyQuotaLedger(db, ownerId, { ...attempt, action: "reconcile", actualMinor: 14 }, clock(dueAt)), "applied");
    assert.equal(await applyQuotaLedger(db, ownerId, { ...slot, action: "settle" }, clock(dueAt)), "applied");

    const [cleared, repeat] = await Promise.all([retryBrandPurge(db, target, clock(dueAt)), retryBrandPurge(db, target, clock(dueAt))]);
    assert.equal(cleared.status, "cleared");
    assert.deepEqual(repeat, cleared);
    assert.equal(await brands.deletionState(ownerId, oldBrand), null);
    for (const table of ["quota_attempt", "quota_reservation", "quota_grant"]) assert.equal(await count(db, table), 0);
    assert.equal(await readExportFile(db, ownerId, exported.id, true), null);
    const receipt = invokeCli(fixture.env, "inspect", ownerId, oldBrand);
    assert.deepEqual(receipt.costs, [{ kind: "sampling", reservationId: slot.reservationId, attemptId: attempt.attemptId,
      currency: "CNY", actualMinor: 14, startedAt: before, reconciledAt: dueAt }]);
    assert.deepEqual(receipt.remaining, []);
    assert.equal(await readExportFile(db, outsider, otherExport.id, true), null, "B06 freeze still applies to the other brand");

    const manifest = invokeCli(fixture.env, "manifest");
    const recovered = await testDatabase(kind);
    t.after(recovered.cleanup);
    const work = await mkdtemp(join(tmpdir(), "geo-b07-replay-"));
    t.after(() => rm(work, { recursive: true, force: true }));
    const file = join(work, "page.json");
    await writeFile(file, JSON.stringify(manifest));
    await restoreFixture(recovered.connection, saved);
    const restoredDao = new BrandDao(recovered.connection);
    assert.ok(await restoredDao.owned(ownerId, oldBrand));
    assert.ok(await readExportFile(recovered.connection, ownerId, exported.id, true));
    assert.equal(invokeCli(recovered.env, "replay", file).results[0].status, "cleared");
    assert.equal(invokeCli(recovered.env, "replay", file).results[0].status, "cleared");
    assert.equal(await restoredDao.owned(ownerId, oldBrand), null);
    assert.equal(await readExportFile(recovered.connection, ownerId, exported.id, true), null);
    assert.ok(await restoredDao.owned(outsider, other.id));
    assert.ok(await readExportFile(recovered.connection, outsider, otherExport.id, true));
    const report = await readAuthorizedReportEvidence(recovered.connection, target, snapshot);
    assert.equal(report.evidence, "no-longer-reviewable");
    assert.equal(report.snapshot, snapshot);
    assert.equal(createHash("sha256").update(report.snapshot).digest("hex"), originalHash);
    assert.equal((await readAuthorizedReportEvidence(recovered.connection, { ownerId: outsider, brandId: oldBrand }, snapshot)).evidence, "unchanged");
  });
}
