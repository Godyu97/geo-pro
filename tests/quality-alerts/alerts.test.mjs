import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  acknowledgeQualityAlert,
  listQualityAlerts,
  recordQualityAlert,
  snoozeQualityAlert,
} from "../../src/features/quality-alerts/commands.ts";
import { qualityAlertErrors, recordQualityAlertSchema } from "../../src/features/quality-alerts/contracts.ts";
import { qualityAlertEventQuery, qualityAlertListQuery } from "../../src/features/quality-alerts/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";

test("decline percentages are rejected and unknown alerts stay private", () => {
  assert.equal(qualityAlertErrors.NOT_FOUND, 404);
  assert.equal(qualityAlertErrors.ALERT_STATE_CONFLICT, 409);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const windows = [sample("w-latest", { coverageSufficient: false, recommendationRate: 0.2 })];
  assert.equal(recordQualityAlertSchema.safeParse({
    action: "record",
    brandId,
    windows: [{ ...windows[0], dropPp: 20 }],
  }).success, false);
  assert.equal(recordQualityAlertSchema.safeParse({ action: "record", brandId, windows }).success, true);
});

function sample(windowId, overrides = {}) {
  return {
    windowId,
    completed: true,
    coverageSufficient: true,
    citationFieldChanged: false,
    modeChanged: false,
    recommendationRate: 0.4,
    ...overrides,
  };
}

function recordInput(brandId, windows) {
  return { action: "record", brandId, windows };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Quality alert owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function watch(db) {
  const captured = [];
  const wrap = (target) => ({
    kind: target.kind,
    query(sql, values) {
      captured.push({ sql, values });
      return target.query(sql, values);
    },
    transaction: target.transaction
      ? (work) => target.transaction((tx) => work(wrap(tx)))
      : undefined,
    savepoint: target.savepoint
      ? (work) => target.savepoint((inner) => work(wrap(inner)))
      : undefined,
  });
  return { captured, connection: wrap(db) };
}

function clockFrom(stamps) {
  let index = 0;
  return () => stamps[Math.min(index++, stamps.length - 1)];
}

async function rows(db, brandId) {
  const alerts = await queryWithParameters(
    db,
    `SELECT kind, claim_brand_decline AS "claimBrandDecline", status, reason, window_id AS "windowId"
     FROM quality_alert WHERE brand_id = ? ORDER BY kind ASC, window_id ASC`,
    [brandId],
  );
  const events = await queryWithParameters(
    db,
    `SELECT id FROM quality_alert_event WHERE brand_id = ?`,
    [brandId],
  );
  return { alerts, eventCount: events.length };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: poor coverage never claims a decline and repeats append one occurrence`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom([
          "2026-11-22T08:00:00.000Z",
          "2026-11-22T08:00:01.000Z",
          "2026-11-22T08:00:02.000Z",
          "2026-11-22T08:00:03.000Z",
          "2026-11-22T08:00:04.000Z",
        ]);
        const poor = [
          sample("w-prev", { recommendationRate: 0.4 }),
          sample("w-latest", { coverageSufficient: false, recommendationRate: 0.2 }),
        ];
        const hidden = await recordQualityAlert(db, outsider, recordInput(brand, poor), clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("w-latest"), false);
        assert.deepEqual(await rows(db, brand), { alerts: [], eventCount: 0 });

        const firstWatch = watch(db);
        const first = await recordQualityAlert(firstWatch.connection, owner, recordInput(brand, poor), clock);
        assert.equal(first.recorded, true);
        assert.equal(first.created, true);
        assert.equal(first.alert.kind, "data_quality");
        assert.equal(first.alert.claimBrandDecline, false);
        assert.equal(first.alert.reason, "coverage_insufficient");
        assert.equal(first.alert.windowId, "w-latest");
        assert.equal(JSON.stringify(first).includes("recommendationRate"), false);
        assert.equal(firstWatch.captured.filter((item) => item.sql.includes("INSERT INTO quality_alert ")).length, 1);
        assert.equal(firstWatch.captured.filter((item) => item.sql.includes("INSERT INTO quality_alert_event")).length, 1);
        let stored = await rows(db, brand);
        assert.equal(stored.alerts.length, 1);
        assert.equal(stored.alerts[0].kind, "data_quality");
        assert.equal(stored.alerts[0].claimBrandDecline, 0);
        assert.equal(stored.eventCount, 1);
        assert.equal(stored.alerts.some((alert) => alert.kind === "trend"), false);

        const secondWatch = watch(db);
        const second = await recordQualityAlert(secondWatch.connection, owner, recordInput(brand, poor), clock);
        assert.equal(second.created, false);
        assert.equal(second.alert.id, first.alert.id);
        assert.equal(second.alert.events.length, 2);
        assert.equal(secondWatch.captured.filter((item) => item.sql.includes("INSERT INTO quality_alert ")).length, 0);
        assert.equal(secondWatch.captured.filter((item) => item.sql.includes("INSERT INTO quality_alert_event")).length, 1);
        stored = await rows(db, brand);
        assert.equal(stored.alerts.length, 1);
        assert.equal(stored.eventCount, 2);

        const deniedAck = await acknowledgeQualityAlert(db, outsider, first.alert.id, clock);
        assert.deepEqual(deniedAck, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedAck).includes("w-latest"), false);
        const acknowledged = await acknowledgeQualityAlert(db, owner, first.alert.id, clock);
        assert.equal(acknowledged.alert.status, "acknowledged");
        assert.equal(acknowledged.alert.events.length, 2);
        assert.equal(acknowledged.alert.claimBrandDecline, false);
        stored = await rows(db, brand);
        assert.equal(stored.alerts[0].status, "acknowledged");
        assert.equal(stored.eventCount, 2);
        const repeated = await recordQualityAlert(db, owner, recordInput(brand, poor), clock);
        assert.equal(repeated.created, false);
        assert.equal(repeated.alert.events.length, 3);
        assert.equal((await rows(db, brand)).alerts.length, 1);

        const snoozed = await snoozeQualityAlert(db, owner, first.alert.id, clock);
        assert.equal(snoozed.alert.status, "snoozed");
        assert.equal(snoozed.alert.events.length, 3);
        assert.equal((await rows(db, brand)).eventCount, 3);
        const snoozeAgain = await snoozeQualityAlert(db, owner, first.alert.id, clock);
        assert.equal(snoozeAgain.error, "ALERT_STATE_CONFLICT");
        assert.equal((await rows(db, brand)).eventCount, 3);

        const cited = await recordQualityAlert(db, owner, recordInput(brand, [
          sample("w-cite-prev"),
          sample("w-cite", { citationFieldChanged: true, recommendationRate: 0.1 }),
        ]), clock);
        assert.equal(cited.alert.kind, "data_quality");
        assert.equal(cited.alert.reason, "citation_field_changed");
        assert.equal(cited.alert.claimBrandDecline, false);
        const mode = await recordQualityAlert(db, owner, recordInput(brand, [
          sample("w-mode", { modeChanged: true, coverageSufficient: true, recommendationRate: 0.1 }),
        ]), clock);
        assert.equal(mode.alert.reason, "mode_changed");
        const quiet = await recordQualityAlert(db, owner, recordInput(brand, [
          sample("w-one", { recommendationRate: 0.2 }),
        ]), clock);
        assert.deepEqual(quiet, { recorded: false });
        const trend = await recordQualityAlert(db, owner, recordInput(brand, [
          sample("w-trend-prev", { recommendationRate: 0.4 }),
          sample("w-trend", { recommendationRate: 0.2 }),
        ]), clock);
        assert.equal(trend.alert.kind, "trend");
        assert.equal(trend.alert.claimBrandDecline, true);
        assert.equal(trend.alert.reason, "recommendation_drop");
        assert.equal(JSON.stringify(trend).includes("0.2"), false);
        stored = await rows(db, brand);
        assert.equal(stored.alerts.filter((alert) => alert.kind === "trend").length, 1);
        assert.equal(stored.alerts.find((alert) => alert.kind === "trend").claimBrandDecline, 1);

        const outsiderList = await listQualityAlerts(db, outsider, brand);
        assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderList).includes("w-latest"), false);
        assert.equal(JSON.stringify(outsiderList).includes("w-trend"), false);
        const ownEmpty = await listQualityAlerts(db, outsider, otherBrand);
        assert.deepEqual(ownEmpty, { alerts: [] });
        const listWatch = watch(db);
        const ownedList = await listQualityAlerts(listWatch.connection, owner, brand);
        assert.equal(ownedList.alerts.length, 4);
        assert.equal(listWatch.captured.filter((item) => /FROM quality_alert\b/.test(item.sql)).length, 1);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM quality_alert_event")).length, 1);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO quality_alert (
              id, brand_id, owner_id, kind, window_id, status, claim_brand_decline, reason, created_at, updated_at
            ) VALUES (?, ?, ?, 'data_quality', 'w-bad', 'open', 1, 'coverage_insufficient', ?, ?)`,
            [randomUUID(), brand, owner, time, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO quality_alert (
              id, brand_id, owner_id, kind, window_id, status, claim_brand_decline, reason, created_at, updated_at
            ) VALUES (?, ?, ?, 'trend', 'w-bad-trend', 'open', 0, 'recommendation_drop', ?, ?)`,
            [randomUUID(), brand, owner, time, time],
          ),
          /CHECK|check constraint/i,
        );

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extraBrands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO quality_alert (
            id, brand_id, owner_id, kind, window_id, status, claim_brand_decline, reason, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'data_quality', 'bulk', 'open', 0, 'coverage_insufficient', ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO quality_alert_event (id, alert_id, brand_id, owner_id, occurred_at)
           VALUES ${extraBrands.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE quality_alert");
          await db.query("ANALYZE quality_alert_event");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = qualityAlertListQuery(owner, brand);
        const eventQuery = qualityAlertEventQuery(owner, [first.alert.id]);
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        const eventPlan = JSON.stringify(await queryWithParameters(db, explain + eventQuery.sql, eventQuery.values));
        assert.match(listPlan, /quality_alert_owner_idx/);
        assert.match(eventPlan, /quality_alert_event_alert_idx/);
        const scaled = watch(db);
        const scaledList = await listQualityAlerts(scaled.connection, owner, brand);
        assert.equal(scaledList.alerts.length, 4);
        assert.equal(scaled.captured.filter((item) => item.sql.includes("FROM quality_alert_event")).length, 1);
        assert.equal(scaled.captured.filter((item) => /FROM quality_alert\b/.test(item.sql)).length, 1);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
