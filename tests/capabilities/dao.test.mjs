import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { confirmFormalRun, recordCapability, saveAnswerNetwork } from "../../src/features/capabilities/commands.ts";
import { capabilityChangeSchema } from "../../src/features/capabilities/contracts.ts";
import { CapabilityDao } from "../../src/features/capabilities/dao.ts";
import { deriveNetworkEvidence, formalRunEligibility } from "../../src/features/capabilities/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const now = () => "2026-11-18T08:00:00.000Z";
const later = "2026-12-18T08:00:00.000Z";

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic B09", id + "@example.invalid"]);
  return id;
}

function record(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 1, citationCapability: "partial",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Human SOP without secrets", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

test("capability input rejects secrets-shaped extras and invalid verified state", () => {
  const command = record(randomUUID());
  assert.equal(capabilityChangeSchema.safeParse(command).success, true);
  for (const extra of [{ vendorId: "Acme" }, { status: "online" }, { searchRequired: 2 }, { apiKey: "secret" }]) {
    assert.equal(capabilityChangeSchema.safeParse({ ...command, ...extra }).success, false);
  }
  assert.equal(formalRunEligibility({ status: "candidate", verifiedAt: null, expiresAt: null }, now()), "unverified");
  assert.equal(formalRunEligibility({ status: "verified", verifiedAt: now(), expiresAt: later }, later), "expired");
  assert.deepEqual(deriveNetworkEvidence({ requestedNetworkMode: "on", triggerEvidence: "none", searchRequired: 1 }), {
    actualNetwork: "unknown", qualifiesRequiredSearch: 0,
  });
  assert.deepEqual(deriveNetworkEvidence({ requestedNetworkMode: "on", triggerEvidence: "observed", searchRequired: 1 }), {
    actualNetwork: "true", qualifiesRequiredSearch: 1,
  });
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: dual-track ledger, formal-run gate, network evidence and disable history`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, kind === "sqlite" ? "0007_last_synch" : "0008_flimsy_bullseye");
    const [owner, outsider, operator, second] = await Promise.all(Array.from({ length: 4 }, () => account(db)));
    const brand = randomUUID();
    await new BrandDao(db).insertBrand(owner, brand, now());
    for (let repeat = 0; repeat < 2; repeat++) {
      execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
    }
    const ddl = await testDatabase(kind, { ddl: true });
    try { assert.deepEqual(await structure(db), await structure(ddl.connection)); }
    finally { await ddl.cleanup(); }

    const dao = new CapabilityDao(db);
    assert.equal((await dao.latest()).length, 0);
    const denied = await recordCapability(db, owner, record(owner), now);
    assert.equal(denied.reason, "not-granted");
    for (const id of [operator, second]) {
      assert.equal((await changeMaintenanceGrant(db, {
        action: "grant", operatorId: id, userId: id, permission: "capabilities.manage", reason: "initial-setup",
      })).status, "allowed");
    }

    const api = record(operator);
    const first = (await recordCapability(db, operator, api, now)).data;
    assert.equal(first.before, null);
    assert.equal(first.after.version, 1);
    assert.deepEqual((await recordCapability(db, operator, api, now)).data, first);
    assert.equal((await recordCapability(db, operator, { ...api, displayName: "Other" })).data.error, "OPERATION_CONFLICT");
    assert.equal((await recordCapability(db, second, api, now)).data.error, "SESSION_CHANGED");

    const consumer = record(operator, {
      kind: "consumer_ui", displayName: "Acme chat", productEntry: "consumer-app", mode: "consumer-ui",
    });
    const consumerResult = (await recordCapability(db, operator, consumer, now)).data.after;
    const listed = await dao.latest();
    assert.equal(listed.length, 2);
    assert.notEqual(first.after.channelId, consumerResult.channelId);
    assert.equal(new Set(listed.map((item) => item.kind)).size, 2);

    const verify = record(operator, {
      expectedVersion: 1, channelId: first.after.channelId, reason: "verification", status: "verified",
      verifiedAt: now(), publicVisible: 1,
    });
    const verified = (await recordCapability(db, operator, verify, now)).data.after;
    assert.equal(verified.status, "verified");
    assert.equal(verified.expiresAt, later);
    assert.equal((await dao.publicLatest(now())).length, 1);

    const racing = await Promise.all([
      recordCapability(db, operator, record(operator, {
        expectedVersion: 2, channelId: verified.channelId, reason: "disable", status: "disabled",
      }), now),
      recordCapability(db, second, record(second, {
        actorId: second, expectedVersion: 2, channelId: verified.channelId, reason: "disable", status: "disabled",
      }), now),
    ]);
    assert.equal(racing.filter(({ data }) => data.after?.version === 3).length, 1);
    assert.equal(racing.find(({ data }) => data.error === "VERSION_CONFLICT").data.current.version, 3);

    const auditFailure = { ...db, transaction: (work) => db.transaction((tx) => work({
      ...tx,
      query(sql, values) {
        if (sql.startsWith("INSERT INTO maintenance_audit")) throw new Error("synthetic audit failure");
        return tx.query(sql, values);
      },
    })) };
    const restore = record(operator, {
      expectedVersion: 3, channelId: verified.channelId, reason: "restore", status: "candidate",
    });
    assert.equal((await recordCapability(auditFailure, operator, restore, now)).status, "unavailable");
    assert.equal((await dao.snapshot(verified.channelId)).version, 3);
    assert.equal(await dao.previousChange(restore.operationId), null);

    const reverify = record(operator, {
      expectedVersion: 3, channelId: verified.channelId, reason: "verification", status: "verified",
      verifiedAt: now(), publicVisible: 1,
    });
    const live = (await recordCapability(db, operator, reverify, now)).data.after;
    const invalidation = record(operator, {
      expectedVersion: 4, channelId: live.channelId, reason: "significant-change", status: "verified",
      verifiedAt: now(), publicVisible: 1,
    });
    assert.equal((await recordCapability(db, operator, invalidation, now)).data.error, "INVALID_INPUT");
    const invalidated = (await recordCapability(db, operator, {
      ...invalidation, status: "candidate", publicVisible: 0, verifiedAt: null,
    }, now)).data.after;
    assert.equal(formalRunEligibility(invalidated, now()), "unverified");

    const blocked = await confirmFormalRun(db, owner, { space: "formal", channelIds: [consumerResult.channelId] }, now);
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.reason, "CHANNEL_UNVERIFIED");
    const restored = (await recordCapability(db, operator, record(operator, {
      expectedVersion: 5, channelId: live.channelId, reason: "verification", status: "verified",
      verifiedAt: now(), publicVisible: 1,
    }), now)).data.after;
    const eligible = await confirmFormalRun(db, owner, { space: "formal", channelIds: [restored.channelId] }, now);
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.reason, "RUN_NOT_OPEN");

    const saved = await saveAnswerNetwork(db, owner, {
      brandId: brand, channelId: restored.channelId, requestedNetworkMode: "on", triggerEvidence: "none",
    }, now);
    assert.equal(saved.status, "allowed");
    assert.equal(saved.record.actualNetwork, "unknown");
    assert.equal(saved.record.qualifiesRequiredSearch, 0);
    assert.equal((await saveAnswerNetwork(db, outsider, {
      brandId: brand, channelId: restored.channelId, requestedNetworkMode: "on", triggerEvidence: "none",
    }, now)).error, "NOT_FOUND");

    await recordCapability(db, operator, record(operator, {
      expectedVersion: 6, channelId: restored.channelId, reason: "disable", status: "disabled",
    }), now);
    const history = await dao.answerNetworkForOwner(owner, brand);
    assert.equal(history.length, 1);
    assert.equal(history[0].channelVersion, saved.record.channelVersion);
    assert.equal(JSON.stringify(history).includes("Human SOP"), false);

    const extras = Array.from({ length: 80 }, () => [randomUUID(), `vendor-${randomUUID().slice(0, 8)}`, now()]);
    await queryWithParameters(db, `INSERT INTO capability_channel (id, vendor_id, kind, created_at) VALUES
      ${extras.map(() => "(?, ?, 'model_api', ?)").join(", ")}`, extras.flat());
    await queryWithParameters(db, `INSERT INTO capability_version (
      channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name, product_entry, mode,
      model_version, availability, search_required, citation_capability, region_target, region_actual, limits_summary,
      sop_summary, verified_at, expires_at, public_visible, changed_at
    ) VALUES ${extras.map(() => "(?, 1, ?, 'synthetic', ?, 'initial-record', 'candidate', 'Extra', 'entry', 'mode', 'unknown', 'fixture', 0, 'unsupported', 'CN', 'unknown', 'limits', 'sop', NULL, NULL, 0, ?)").join(", ")}`,
    extras.flatMap(([id]) => [id, randomUUID(), operator, now()]));
    const received = [];
    const monitored = new CapabilityDao({
      kind: db.kind,
      query: async (sql, args) => {
        received.push([sql, args]);
        return db.query(sql, args);
      },
    });
    if (db.kind === "postgresql") await db.query("ANALYZE capability_channel, capability_version");
    assert.ok((await monitored.latest()).length >= 80);
    assert.equal(received.length, 1);
    const [sql, values] = received[0];
    const prefix = db.kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const plan = JSON.stringify(await db.query(prefix + sql, values));
    assert.match(plan, /capability_channel|capability_version|sqlite_autoindex_capability_channel/);
  });
}
