import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { importBusinessLeads, listBusinessLeads } from "../../src/features/business-feedback/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveDataConnection,
  registerDataConnection,
  syncDataConnection,
} from "../../src/features/data-connections/commands.ts";
import { listConnectorEvents } from "../../src/features/data-connections/event-commands.ts";
import { registerSyncAuthorization, revokeSyncAuthorization } from "../../src/features/data-connections/revocation-commands.ts";
import { syncAuthorizationForSourceQuery } from "../../src/features/data-connections/revocation-dao.ts";
import { csvEventDigest } from "../../src/features/data-connections/sync.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

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
  test(`${kind}: cursor sync dedupes csv and connector, then stops after revocation`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
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

      const synced = await syncDataConnection(db, owner, created.connection.id, {
        cursor: "batch-1",
        coverageComplete: false,
        events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "referral" }],
      }, clock);
      assert.equal(synced.replayed, false);
      assert.equal(synced.connection.syncCursor, "batch-1");
      assert.equal(synced.connection.coverageComplete, false);
      assert.equal(synced.connection.syncStopped, false);
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

      const replayed = await syncDataConnection(db, owner, created.connection.id, {
        cursor: "batch-1",
        coverageComplete: true,
        events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "landing_page" }],
      }, clock);
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.connection.syncCursor, "batch-1");
      assert.equal(replayed.connection.coverageComplete, false);
      const afterReplay = await listBusinessLeads(db, owner, brand);
      assert.deepEqual(afterReplay.leads[0].evidence, ["self_report", "referral"]);
      assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'allowed'`, []), 1);

      const late = await syncDataConnection(db, owner, created.connection.id, {
        cursor: "batch-2",
        coverageComplete: true,
        events: [{ eventKey: eventId, payloadDigest: connectorDigest, evidence: "landing_page" }],
      }, clock);
      assert.equal(late.replayed, false);
      assert.equal(late.connection.syncCursor, "batch-2");
      assert.equal(late.connection.coverageComplete, true);
      const afterLate = await listBusinessLeads(db, owner, brand);
      assert.equal(afterLate.leads.length, 1);
      assert.deepEqual(afterLate.leads[0].evidence, ["self_report", "referral", "landing_page"]);
      assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 1);
      assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event_source WHERE brand_id = ?`, [brand]), 2);

      const revoked = await revokeSyncAuthorization(db, owner, authorization.authorization.id, clock);
      assert.equal(revoked.authorization.revoked, true);
      const stopped = await syncDataConnection(db, owner, created.connection.id, {
        cursor: "batch-3",
        coverageComplete: true,
        events: [{ eventKey: "evt-sync-2", payloadDigest: connectorDigest, evidence: "unknown" }],
      }, clock);
      assert.deepEqual(stopped, { error: "SYNC_STOPPED" });
      assert.equal(await count(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]), 1);
      assert.equal(await count(db, `SELECT count(*) AS count FROM connector_event WHERE brand_id = ?`, [brand]), 1);
      assert.equal(await count(db, `SELECT count(*) AS count FROM sync_attempt WHERE result = 'stopped'`, []), 1);
      const [stored] = await queryWithParameters(
        db,
        `SELECT sync_cursor AS "syncCursor", coverage_complete AS "coverageComplete", sync_stopped AS "syncStopped"
         FROM data_connection WHERE id = ?`,
        [created.connection.id],
      );
      assert.equal(stored.syncCursor, "batch-2");
      assert.equal(Number(stored.coverageComplete), 1);
      assert.equal(Number(stored.syncStopped), 1);
      const hidden = await syncDataConnection(db, outsider, created.connection.id, {
        cursor: "batch-4",
        coverageComplete: true,
        events: [],
      }, clock);
      assert.deepEqual(hidden, { error: "NOT_FOUND" });
      assert.equal(JSON.stringify(hidden).includes(eventId), false);

      const noise = Array.from({ length: 200 }, () => randomUUID());
      await queryWithParameters(
        db,
        `INSERT INTO sync_authorization (
          id, brand_id, owner_id, source_name, revoked, retained_rows, history_deleted, created_at, updated_at
        ) VALUES ${noise.map(() => "(?, ?, ?, 'noise', 0, 0, 0, ?, ?)").join(", ")}`,
        noise.flatMap((id) => [id, brand, outsider, time, time]),
      );
      if (db.kind === "postgresql") await db.query("ANALYZE sync_authorization");
      const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      const sourceQuery = syncAuthorizationForSourceQuery(owner, brand, sourceName);
      const plan = JSON.stringify(await queryWithParameters(db, explain + sourceQuery.sql, sourceQuery.values));
      assert.match(plan, /sync_authorization_owner_idx/);
    } finally {
      await fixture.cleanup();
    }
  });
}
