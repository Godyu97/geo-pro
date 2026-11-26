import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { importBusinessLeads, listBusinessLeads } from "../../src/features/business-feedback/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveDataConnection,
  listDataConnections,
  readBrandSyncSurface,
  registerDataConnection,
  syncDataConnection,
} from "../../src/features/data-connections/commands.ts";
import {
  syncBatchByCursorQuery,
  syncBatchReceiptStatesQuery,
} from "../../src/features/data-connections/dao.ts";
import { listConnectorEvents } from "../../src/features/data-connections/event-commands.ts";
import { registerSyncAuthorization, revokeSyncAuthorization } from "../../src/features/data-connections/revocation-commands.ts";
import { syncAuthorizationForSourceQuery } from "../../src/features/data-connections/revocation-dao.ts";
import { csvEventDigest } from "../../src/features/data-connections/sync.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T03:00:00.000Z";
const sourceName = "站点同步";
const fields = ["event_id", "page_path"];
const eventId = "evt-sync-1";
const connectorDigest = createHash("sha256").update("connector:evt-sync-1").digest("hex");

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 60_000).toISOString();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Sync owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function count(db, sql, values) {
  const [row] = await queryWithParameters(db, sql, values);
  return Number(row.count);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: cursor sync dedupes csv and connector, preserves current cursor on historical replay, guards concurrency and stops after revocation`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        await new BrandDao(db).insertBrand(owner, brand, time);
        const clock = clockFrom(time);
        const created = await registerDataConnection(db, owner, {
          brandId: brand,
          displayName: sourceName,
          fieldNames: fields,
        }, clock);
        const approved = await approveDataConnection(db, owner, created.connection.id, clock);
        assert.equal(approved.connection.status, "approved");
        assert.equal(approved.connection.syncCursor, null);
        assert.equal(approved.connection.missingHistoricalReceipts, false);
        const blocked = await syncDataConnection(db, owner, created.connection.id, {
          cursor: "batch-0",
          coverageComplete: true,
          events: [],
        }, clock);
        assert.deepEqual(blocked, { error: "SYNC_BLOCKED" });

        const authorization = await registerSyncAuthorization(db, owner, {
          brandId: brand,
          sourceName,
          retainedRows: 4,
        }, clock);
        const imported = await importBusinessLeads(db, owner, {
          brandId: brand,
          rows: [{ eventId, evidence: "self_report", directIdentifier: false }],
        }, clock);
        assert.equal(imported.leads.length, 1);
        assert.equal(imported.leads[0].count, 1);

        const phone = "13800000000";
        const poisoned = await syncDataConnection(db, owner, created.connection.id, {
          cursor: "batch-pii",
          coverageComplete: true,
          events: [{ eventKey: phone, payloadDigest: connectorDigest, evidence: "unknown" }],
        }, clock);
        assert.deepEqual(poisoned, { error: "INVALID_INPUT" });
        assert.equal(JSON.stringify(poisoned).includes(phone), false);

        const batch1Payload = {
          cursor: "batch-1",
          coverageComplete: false,
          events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "referral" }],
        };
        const synced = await syncDataConnection(db, owner, created.connection.id, batch1Payload, clock);
        assert.equal(synced.replayed, false);
        assert.equal(synced.connection.syncCursor, "batch-1");
        assert.equal(synced.connection.coverageComplete, false);
        assert.equal(synced.connection.syncStopped, false);
        assert.equal(synced.connection.missingHistoricalReceipts, false);
        assert.deepEqual(synced.connection.sources.map((source) => source.source).sort(), ["connector", "csv"]);

        const leads = await listBusinessLeads(db, owner, brand);
        assert.equal(leads.leads.length, 1);
        assert.equal(leads.leads[0].count, 1);
        assert.equal(leads.leads[0].eventId, eventId);
        assert.deepEqual(leads.leads[0].evidence, ["self_report", "referral"]);
        const events = await listConnectorEvents(db, owner);
        assert.equal(events.events.length, 1);
        assert.equal(events.events[0].count, 1);
        assert.equal(events.events[0].conflict, true);
        assert.deepEqual(events.events[0].sources.map((source) => source.source).sort(), ["connector", "csv"]);
        assert.equal(events.events[0].sources.find((source) => source.source === "csv").payloadDigest, csvEventDigest(eventId));
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 1);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 1);

        // Existing replay protection on the current cursor still applies.
        const replayedCurrent = await syncDataConnection(db, owner, created.connection.id, {
          cursor: "batch-1",
          coverageComplete: true,
          events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "landing_page" }],
        }, clock);
        assert.equal(replayedCurrent.replayed, true);
        assert.equal(replayedCurrent.connection.syncCursor, "batch-1");
        assert.equal(replayedCurrent.connection.coverageComplete, false);
        const afterReplay = await listBusinessLeads(db, owner, brand);
        assert.deepEqual(afterReplay.leads[0].evidence, ["self_report", "referral"]);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 1);

        const advancedB = await syncDataConnection(db, owner, created.connection.id, {
          expectedCursor: "batch-1",
          cursor: "batch-2",
          coverageComplete: true,
          events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "landing_page" }],
        }, clock);
        assert.equal(advancedB.replayed, false);
        assert.equal(advancedB.connection.syncCursor, "batch-2");
        assert.equal(advancedB.connection.coverageComplete, true);
        assert.equal(advancedB.connection.missingHistoricalReceipts, false);
        const afterAdvancedB = await listBusinessLeads(db, owner, brand);
        assert.equal(afterAdvancedB.leads.length, 1);
        assert.deepEqual(afterAdvancedB.leads[0].evidence, ["self_report", "referral", "landing_page"]);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 1);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event_source WHERE brand_id = ?`, [brand]), 2);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 2);

        // Delayed replay of historical batch-1 preserves batch-2 and coverageComplete=true without new writes.
        const historicalReplay = await syncDataConnection(db, owner, created.connection.id, batch1Payload, clock);
        assert.equal(historicalReplay.replayed, true);
        assert.equal(historicalReplay.connection.syncCursor, "batch-2");
        assert.equal(historicalReplay.connection.coverageComplete, true);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 2);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 1);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 1);

        // Historical cursor with a different payload returns explicit CONFLICT and leaves state intact.
        const historicalConflict = await syncDataConnection(db, owner, created.connection.id, {
          cursor: "batch-1",
          coverageComplete: true,
          events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "referral" }],
        }, clock);
        assert.deepEqual(historicalConflict, { error: "CONFLICT" });
        const historicalPayloadConflict = await syncDataConnection(db, owner, created.connection.id, {
          cursor: "batch-1",
          coverageComplete: false,
          events: [{ eventKey: "evt-conflict-extra", payloadDigest: connectorDigest, evidence: "unknown" }],
        }, clock);
        assert.deepEqual(historicalPayloadConflict, { error: "CONFLICT" });
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 2);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 1);

        // Opaque cursor token ("batch-0" < "batch-2" lexicographically) can advance and carry a late CSV event.
        const lateCsvId = "evt-late-csv-1";
        const lateCsvDigest = createHash("sha256").update("connector:evt-late-csv-1").digest("hex");
        await importBusinessLeads(db, owner, {
          brandId: brand,
          rows: [{ eventId: lateCsvId, evidence: "self_report", directIdentifier: false }],
        }, clock);
        const opaqueTokenAdvance = await syncDataConnection(db, owner, created.connection.id, {
          expectedCursor: "batch-2",
          cursor: "batch-0",
          coverageComplete: false,
          events: [{ eventKey: lateCsvId, payloadDigest: lateCsvDigest, evidence: "referral" }],
        }, clock);
        assert.equal(opaqueTokenAdvance.replayed, false);
        assert.equal(opaqueTokenAdvance.connection.syncCursor, "batch-0");
        assert.equal(opaqueTokenAdvance.connection.coverageComplete, false);
        const leadsAfterLate = await listBusinessLeads(db, owner, brand);
        const lateLead = leadsAfterLate.leads.find((row) => row.eventId === lateCsvId);
        assert.equal(lateLead.count, 1);
        assert.deepEqual(lateLead.evidence, ["self_report", "referral"]);
        const eventsAfterLate = await listConnectorEvents(db, owner);
        const lateEvent = eventsAfterLate.events.find((row) => row.eventKey === lateCsvId);
        assert.equal(lateEvent.count, 1);
        assert.deepEqual(lateEvent.sources.map((source) => source.source).sort(), ["connector", "csv"]);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 3);

        // Two concurrent new batches with the same predecessor state: only one advances, other gets CONFLICT with no partial writes.
        const raceEventA = "evt-race-a";
        const raceEventB = "evt-race-b";
        const [raceA, raceB] = await Promise.all([
          syncDataConnection(db, owner, created.connection.id, {
            expectedCursor: "batch-0",
            cursor: "tok-race-a",
            coverageComplete: true,
            events: [{ eventKey: raceEventA, payloadDigest: connectorDigest, evidence: "referral" }],
          }, clock),
          syncDataConnection(db, owner, created.connection.id, {
            expectedCursor: "batch-0",
            cursor: "tok-race-b",
            coverageComplete: false,
            events: [{ eventKey: raceEventB, payloadDigest: connectorDigest, evidence: "landing_page" }],
          }, clock),
        ]);
        const outcomes = [
          { tag: "a", result: raceA, cursor: "tok-race-a", eventKey: raceEventA, evidence: "referral" },
          { tag: "b", result: raceB, cursor: "tok-race-b", eventKey: raceEventB, evidence: "landing_page" },
        ];
        const winners = outcomes.filter((item) => "connection" in item.result);
        const losers = outcomes.filter((item) => "error" in item.result);
        assert.equal(winners.length, 1);
        assert.equal(losers.length, 1);
        assert.deepEqual(losers[0].result, { error: "CONFLICT" });
        assert.equal(winners[0].result.replayed, false);
        assert.equal(winners[0].result.connection.syncCursor, winners[0].cursor);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 4);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 3);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 3);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ? AND event_key = ?`, [brand, losers[0].eventKey]), 0);

        // Losing batch re-reads current state and succeeds cleanly when resubmitted with the new cursor.
        const refreshed = await listDataConnections(db, owner);
        const currentView = refreshed.connections.find((row) => row.id === created.connection.id);
        assert.equal(currentView.syncCursor, winners[0].cursor);
        const retriedLoser = await syncDataConnection(db, owner, created.connection.id, {
          expectedCursor: currentView.syncCursor,
          cursor: losers[0].cursor,
          coverageComplete: true,
          events: [{ eventKey: losers[0].eventKey, payloadDigest: connectorDigest, evidence: losers[0].evidence }],
        }, clock);
        assert.equal(retriedLoser.replayed, false);
        assert.equal(retriedLoser.connection.syncCursor, losers[0].cursor);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 4);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 4);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 5);

        // Mid-transaction failure rolls back events, leads, cursor, batch receipt, and attempt cleanly.
        const rollbackEvent = "evt-rollback-1";
        const wrapRollback = (target) => ({
          kind: target.kind,
          query(sql, values) {
            if (/^\s*insert\s+into\s+data_connection_sync_batch\b/i.test(sql)) {
              throw new Error("synthetic batch receipt write failure");
            }
            return target.query(sql, values);
          },
          transaction: target.transaction ? (work) => target.transaction((tx) => work(wrapRollback(tx))) : undefined,
          savepoint: target.savepoint ? (work) => target.savepoint((inner) => work(wrapRollback(inner))) : undefined,
        });
        await assert.rejects(
          () => syncDataConnection(wrapRollback(db), owner, created.connection.id, {
            expectedCursor: losers[0].cursor,
            cursor: "tok-after-rollback",
            coverageComplete: false,
            events: [{ eventKey: rollbackEvent, payloadDigest: connectorDigest, evidence: "unknown" }],
          }, clock),
          /synthetic batch receipt write failure/,
        );
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ? AND event_key = ?`, [brand, rollbackEvent]), 0);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ? AND event_id = ?`, [brand, rollbackEvent]), 0);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 5);
        const [afterRollbackRow] = await queryWithParameters(
          db,
          `SELECT sync_cursor AS "syncCursor" FROM data_connection WHERE id = ?`,
          [created.connection.id],
        );
        assert.equal(afterRollbackRow.syncCursor, losers[0].cursor);

        // Retrying after transient failure succeeds.
        const recovered = await syncDataConnection(db, owner, created.connection.id, {
          expectedCursor: losers[0].cursor,
          cursor: "tok-after-rollback",
          coverageComplete: false,
          events: [{ eventKey: rollbackEvent, payloadDigest: connectorDigest, evidence: "unknown" }],
        }, clock);
        assert.equal(recovered.replayed, false);
        assert.equal(recovered.connection.syncCursor, "tok-after-rollback");
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 5);
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 5);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 6);

        // Pre-existing connection created before receipts existed: shows missingHistoricalReceipts boundary,
        // refuses unverifiable stale expectedCursor, and continues cleanly from its provable current cursor.
        const legacySource = "旧版站点同步";
        await registerSyncAuthorization(db, owner, {
          brandId: brand,
          sourceName: legacySource,
          retainedRows: 2,
        }, clock);
        const legacy = await registerDataConnection(db, owner, {
          brandId: brand,
          displayName: legacySource,
          fieldNames: fields,
        }, clock);
        await approveDataConnection(db, owner, legacy.connection.id, clock);
        await queryWithParameters(
          db,
          `UPDATE data_connection SET sync_cursor = ?, coverage_complete = 1, updated_at = ? WHERE id = ?`,
          ["legacy-cur-2", time, legacy.connection.id],
        );
        const legacyListed = await listDataConnections(db, owner);
        const legacyView = legacyListed.connections.find((row) => row.id === legacy.connection.id);
        assert.equal(legacyView.syncCursor, "legacy-cur-2");
        assert.equal(legacyView.missingHistoricalReceipts, true);
        const legacySurface = await readBrandSyncSurface(db, owner, brand, []);
        assert.equal(legacySurface.connections.find((row) => row.id === legacy.connection.id).missingHistoricalReceipts, true);

        const unverifiableStale = await syncDataConnection(db, owner, legacy.connection.id, {
          expectedCursor: null,
          cursor: "legacy-cur-1",
          coverageComplete: true,
          events: [],
        }, clock);
        assert.deepEqual(unverifiableStale, { error: "CONFLICT" });
        const legacyContinued = await syncDataConnection(db, owner, legacy.connection.id, {
          expectedCursor: "legacy-cur-2",
          cursor: "legacy-cur-3",
          coverageComplete: false,
          events: [],
        }, clock);
        assert.equal(legacyContinued.replayed, false);
        assert.equal(legacyContinued.connection.syncCursor, "legacy-cur-3");
        assert.equal(legacyContinued.connection.coverageComplete, false);
        assert.equal(legacyContinued.connection.missingHistoricalReceipts, true);

        // Revocation stops subsequent retries without mutating cursor or events.
        const revoked = await revokeSyncAuthorization(db, owner, authorization.authorization.id, clock);
        assert.equal(revoked.authorization.revoked, true);
        const stopped = await syncDataConnection(db, owner, created.connection.id, {
          expectedCursor: "tok-after-rollback",
          cursor: "batch-3",
          coverageComplete: true,
          events: [{ eventKey: "evt-sync-2", payloadDigest: connectorDigest, evidence: "unknown" }],
        }, clock);
        assert.deepEqual(stopped, { error: "SYNC_STOPPED" });
        assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 5);
        assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 5);
        assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'stopped'`, []), 1);
        const [stored] = await queryWithParameters(
          db,
          `SELECT sync_cursor AS "syncCursor", coverage_complete AS "coverageComplete", sync_stopped AS "syncStopped"
           FROM data_connection WHERE id = ?`,
          [created.connection.id],
        );
        assert.equal(stored.syncCursor, "tok-after-rollback");
        assert.equal(Number(stored.coverageComplete), 0);
        assert.equal(Number(stored.syncStopped), 1);

        const hidden = await syncDataConnection(db, outsider, created.connection.id, {
          cursor: "batch-4",
          coverageComplete: true,
          events: [],
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(eventId), false);
        assert.equal(JSON.stringify(hidden).includes("tok-after-rollback"), false);

        const otherBrand = randomUUID();
        await new BrandDao(db).insertBrand(outsider, otherBrand, time);
        const outsiderConn = await registerDataConnection(db, outsider, {
          brandId: otherBrand,
          displayName: "outsider-sync",
          fieldNames: fields,
        }, clock);
        const noise = Array.from({ length: 400 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO sync_authorization (
            id, brand_id, owner_id, source_name, revoked, retained_rows, history_deleted, created_at, updated_at
          ) VALUES ${noise.map(() => "(?, ?, ?, 'noise', 0, 0, 0, ?, ?)").join(", ")}`,
          noise.flatMap((id) => [id, brand, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO data_connection_sync_batch (
            id, connection_id, brand_id, owner_id, cursor, previous_cursor, payload_digest, coverage_complete, synced_at
          ) VALUES ${noise.map((_, index) => "(?, ?, ?, ?, ?, NULL, ?, 1, ?)").join(", ")}`,
          noise.flatMap((id, index) => [id, outsiderConn.connection.id, otherBrand, outsider, `noise-cur-${index}`, connectorDigest, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE sync_authorization");
          await db.query("ANALYZE data_connection_sync_batch");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const sourceQuery = syncAuthorizationForSourceQuery(owner, brand, sourceName);
        const batchLookupQuery = syncBatchByCursorQuery(owner, created.connection.id, "batch-1");
        const receiptStateQuery = syncBatchReceiptStatesQuery(owner, [
          { id: created.connection.id, syncCursor: "tok-after-rollback" },
          { id: legacy.connection.id, syncCursor: "legacy-cur-3" },
        ]);
        const plan = JSON.stringify(await queryWithParameters(db, explain + sourceQuery.sql, sourceQuery.values));
        const batchLookupPlan = JSON.stringify(await queryWithParameters(db, explain + batchLookupQuery.sql, batchLookupQuery.values));
        const receiptStatePlan = JSON.stringify(await queryWithParameters(db, explain + receiptStateQuery.sql, receiptStateQuery.values));
        assert.match(plan, /sync_authorization_owner_idx/);
        assert.match(batchLookupPlan, /data_connection_sync_batch_(cursor_uidx|owner_idx)/);
        assert.match(receiptStatePlan, /data_connection_sync_batch_owner_idx/);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
