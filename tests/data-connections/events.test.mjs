import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { importConnectorEvents, listConnectorEvents, readConnectorEvent } from "../../src/features/data-connections/event-commands.ts";
import { importConnectorEventsSchema, parseConnectorEventLines } from "../../src/features/data-connections/event-contracts.ts";
import {
  connectorEventSourcesQuery,
  connectorEventsByKeysQuery,
  connectorEventsForOwnerQuery,
} from "../../src/features/data-connections/event-dao.ts";
import { planConnectorEvents } from "../../src/features/data-connections/event-plan.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const eventKey = "fixture-lead-1";
const digest = (label) => createHash("sha256").update(`fixture:${label}`).digest("hex");
const digestA = digest("a");
const digestB = digest("b");

test("connector event plan keeps one count and both sources", async () => {
  const planned = planConnectorEvents([
    { eventKey, source: "csv", payloadDigest: digestA },
    { eventKey, source: "connector", payloadDigest: digestA },
    { eventKey, source: "csv", payloadDigest: digestA },
  ]);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].count, 1);
  assert.deepEqual(planned[0].sources.map((source) => source.source).sort(), ["connector", "csv"]);
  assert.equal(planned[0].conflict, false);
  const conflicted = planConnectorEvents([
    { eventKey, source: "csv", payloadDigest: digestA },
    { eventKey, source: "connector", payloadDigest: digestB },
  ]);
  assert.equal(conflicted[0].count, 1);
  assert.equal(conflicted[0].conflict, true);
  assert.equal(conflicted[0].sources.length, 2);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const row = { eventKey, source: "csv", payloadDigest: digestA };
  assert.equal(importConnectorEventsSchema.safeParse({ brandId, rows: [row], customerText: "原文" }).success, false);
  assert.equal(importConnectorEventsSchema.safeParse({ brandId, rows: [{ ...row, eventKey: "客户张三13800000000" }] }).success, false);
  assert.equal(importConnectorEventsSchema.safeParse({ brandId, rows: [{ ...row, payloadDigest: "not-a-digest" }] }).success, false);
  assert.equal(importConnectorEventsSchema.safeParse({ brandId, rows: [{ ...row, source: "crawler" }] }).success, false);
  assert.equal(parseConnectorEventLines(`${eventKey}, csv, ${digestA}\n${eventKey}, connector, ${digestA}`).rows.length, 2);
  assert.deepEqual(parseConnectorEventLines("hello world"), { error: "INVALID_INPUT" });
  assert.equal(safeReturnTo("/dashboard/reports/connector-events"), "/dashboard/reports/connector-events");
  const source = await readFile(new URL("../../src/features/data-connections/event-commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("planConnectorEvents"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
  const plan = await readFile(new URL("../../src/features/data-connections/event-plan.ts", import.meta.url), "utf8");
  assert.equal(plan.includes("syncEvents"), true);
});

test("connector event copy keeps both sources and refuses an inclusion claim", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.connectorEvents.description, /一条/);
  assert.match(zhCN.connectorEvents.description, /csv/);
  assert.match(zhCN.connectorEvents.description, /connector/);
  assert.match(zhCN.connectorEvents.description, /冲突/);
  assert.match(zhCN.connectorEvents.description, /收录/);
  assert.match(zhCN.connectorEvents.description, /客户正文/);
  assert.match(en.connectorEvents.description, /one consultation/i);
  assert.match(en.connectorEvents.description, /csv/);
  assert.match(en.connectorEvents.description, /connector/);
  assert.match(en.connectorEvents.description, /conflict/i);
  assert.match(en.connectorEvents.description, /inclusion/i);
  assert.match(en.connectorEvents.description, /customer text/i);
  assert.equal(zhCN.reports.openConnectorEvents.length > 0, true);
  assert.equal(en.reports.openConnectorEvents.length > 0, true);
  const page = await readFile(new URL("../../src/features/data-connections/event-page.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
});

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

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 60_000).toISOString();
}

function isSelect(sql, table) {
  return /^\s*select/i.test(sql) && new RegExp(`\\b${table}\\b`, "i").test(sql);
}

function writes(captured) {
  return captured.filter((item) => /^\s*(insert|update|delete)/i.test(item.sql));
}

function storedColumns(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "connector_event" || row.tbl_name === "connector_event_source")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "connector_event" || row.table_name === "connector_event_source")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Event owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function sourceRows(db, eventId) {
  return queryWithParameters(
    db,
    `SELECT source, payload_digest AS "payloadDigest" FROM connector_event_source
     WHERE event_id = ? ORDER BY source ASC`,
    [eventId],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: one event key keeps csv and connector and marks a digest conflict`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /connector_event_key_uidx/);
        assert.match(defined, /connector_event_owner_idx/);
        assert.match(defined, /connector_event_source_event_uidx/);
        assert.match(defined, /connector_event_source_owner_idx/);
        assert.match(defined, /connector_event_state_check/);
        assert.match(defined, /connector_event_source_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /connector_event_source_event_fk/);
        else assert.match(defined, /FOREIGN KEY \(`event_id`\) REFERENCES `connector_event`/);
        const columns = storedColumns(migrated);
        for (const word of ["password", "token", "secret", "cookie", "body", "recommended", "citation", "customer"]) {
          assert.equal(columns.includes(word), false, word);
        }

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);
        const hidden = await importConnectorEvents(db, outsider, {
          brandId: brand,
          rows: [{ eventKey, source: "csv", payloadDigest: digestA }],
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(eventKey), false);

        const csv = await importConnectorEvents(db, owner, {
          brandId: brand,
          rows: [{ eventKey, source: "csv", payloadDigest: digestA }],
        }, clock);
        assert.equal(csv.events.length, 1);
        assert.equal(csv.events[0].count, 1);
        assert.equal(csv.events[0].conflict, false);
        assert.deepEqual(csv.events[0].sources, [{ source: "csv", payloadDigest: digestA }]);

        const both = await importConnectorEvents(db, owner, {
          brandId: brand,
          rows: [{ eventKey, source: "connector", payloadDigest: digestA }],
        }, clock);
        assert.equal(both.events.length, 1);
        assert.equal(both.events[0].id, csv.events[0].id);
        assert.equal(both.events[0].count, 1);
        assert.equal(both.events[0].conflict, false);
        assert.deepEqual(both.events[0].sources.map((source) => source.source).sort(), ["connector", "csv"]);

        const repeatWatch = watch(db);
        const repeated = await importConnectorEvents(repeatWatch.connection, owner, {
          brandId: brand,
          rows: [{ eventKey, source: "csv", payloadDigest: digestA }],
        }, clock);
        assert.equal(repeated.events[0].count, 1);
        assert.equal(repeated.events[0].conflict, false);
        assert.equal(writes(repeatWatch.captured).length, 0);
        assert.equal((await sourceRows(db, csv.events[0].id)).length, 2);
        const keySelects = repeatWatch.captured.filter((item) => isSelect(item.sql, "connector_event") && isSelect(item.sql, "connector_event_source"));
        assert.equal(keySelects.length, 1);
        assert.match(keySelects[0].sql, /event_key IN/i);

        const conflicted = await importConnectorEvents(db, owner, {
          brandId: brand,
          rows: [{ eventKey, source: "connector", payloadDigest: digestB }],
        }, clock);
        assert.equal(conflicted.events[0].count, 1);
        assert.equal(conflicted.events[0].conflict, true);
        assert.equal(conflicted.events[0].id, csv.events[0].id);
        const stored = await sourceRows(db, csv.events[0].id);
        assert.equal(stored.length, 2);
        assert.equal(stored.find((row) => row.source === "connector").payloadDigest, digestA);

        const sameSource = await importConnectorEvents(db, owner, {
          brandId: brand,
          rows: [
            { eventKey: "fixture-lead-2", source: "csv", payloadDigest: digestA },
            { eventKey: "fixture-lead-2", source: "csv", payloadDigest: digestB },
          ],
        }, clock);
        assert.equal(sameSource.events.length, 1);
        assert.equal(sameSource.events[0].count, 1);
        assert.equal(sameSource.events[0].conflict, true);
        assert.deepEqual(sameSource.events[0].sources, [{ source: "csv", payloadDigest: digestA }]);

        const hiddenRead = await readConnectorEvent(db, outsider, csv.events[0].id);
        assert.deepEqual(hiddenRead, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hiddenRead).includes(eventKey), false);
        const hiddenList = await listConnectorEvents(db, outsider);
        assert.equal(hiddenList.events.some((event) => event.id === csv.events[0].id), false);
        assert.equal(JSON.stringify(hiddenList).includes(eventKey), false);
        const visible = await readConnectorEvent(db, owner, csv.events[0].id);
        assert.equal(visible.event.count, 1);
        assert.equal(visible.event.conflict, true);
        assert.equal(JSON.stringify(visible.event).includes("recommended"), false);

        const listWatch = watch(db);
        const listed = await listConnectorEvents(listWatch.connection, owner);
        const eventSelects = listWatch.captured.filter((item) => isSelect(item.sql, "connector_event") && !isSelect(item.sql, "connector_event_source"));
        const sourceSelects = listWatch.captured.filter((item) => isSelect(item.sql, "connector_event_source") && !/\bjoin\b/i.test(item.sql));
        assert.equal(eventSelects.length, 1);
        assert.equal(sourceSelects.length, 1);
        assert.match(sourceSelects[0].sql, /event_id IN/i);
        assert.equal(listed.events.some((event) => event.eventKey === eventKey), true);

        const extra = Array.from({ length: 3000 }, (_, index) => ({
          id: randomUUID(),
          key: `n${index.toString(16).padStart(4, "0")}`,
        }));
        const noiseDigest = "ab".repeat(32);
        await queryWithParameters(
          db,
          `INSERT INTO connector_event (
            id, brand_id, owner_id, event_key, count, conflict, created_at, updated_at
          ) VALUES ${extra.map(() => "(?, ?, ?, ?, 1, 0, ?, ?)").join(", ")}`,
          extra.flatMap((row) => [row.id, otherBrand, outsider, row.key, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO connector_event_source (
            id, event_id, brand_id, owner_id, source, payload_digest, created_at
          ) VALUES ${extra.map(() => "(?, ?, ?, ?, 'csv', ?, ?)").join(", ")}`,
          extra.flatMap((row) => [randomUUID(), row.id, otherBrand, outsider, noiseDigest, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE connector_event");
          await db.query("ANALYZE connector_event_source");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = connectorEventsForOwnerQuery(owner);
        const sourceQuery = connectorEventSourcesQuery(owner, [csv.events[0].id]);
        const keyQuery = connectorEventsByKeysQuery(owner, brand, [eventKey]);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        const sourcePlan = JSON.stringify(await queryWithParameters(db, explain + sourceQuery.sql, sourceQuery.values));
        const keyPlan = JSON.stringify(await queryWithParameters(db, explain + keyQuery.sql, keyQuery.values));
        assert.match(ownerPlan, /connector_event_owner_idx/);
        assert.match(sourcePlan, /connector_event_source_owner_idx/);
        assert.match(keyPlan, /connector_event_key_uidx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(ownerPlan, /Seq Scan on connector_event/);
          assert.doesNotMatch(sourcePlan, /Seq Scan on connector_event_source/);
        }

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE connector_event SET count = 2 WHERE id = ?`, [csv.events[0].id]),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO connector_event_source (
              id, event_id, brand_id, owner_id, source, payload_digest, created_at
            ) VALUES (?, ?, ?, ?, 'csv', ?, ?)`,
            [randomUUID(), csv.events[0].id, brand, owner, digestA, time],
          ),
          /UNIQUE|unique/i,
        );
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
