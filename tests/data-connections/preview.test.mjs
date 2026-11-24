import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveDataConnection,
  listDataConnections,
  pullDataConnection,
  registerDataConnection,
} from "../../src/features/data-connections/commands.ts";
import {
  dataConnectionErrors,
  registerDataConnectionSchema,
} from "../../src/features/data-connections/contracts.ts";
import { dataConnectionFieldsQuery, dataConnectionOwnerQuery } from "../../src/features/data-connections/dao.ts";
import { previewSync } from "../../src/features/data-connections/sync.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const fields = ["event_id", "page_path", "session_count"];

test("field preview rejects secrets and keeps unapproved pulls stopped", async () => {
  assert.equal(dataConnectionErrors.PULL_BLOCKED, 409);
  assert.deepEqual(previewSync({ approved: false, fieldNames: fields }), { pull: false, fields });
  assert.deepEqual(previewSync({ approved: true, fieldNames: fields }), { pull: true, fields });
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const base = { brandId, displayName: " Site preview ", fieldNames: fields };
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, accessToken: "secret" }).success, false);
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, displayName: "desk token" }).success, false);
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, displayName: "https://logs.example" }).success, false);
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, fieldNames: ["event_id", "access_token"] }).success, false);
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, fieldNames: ["event_id", "event_id"] }).success, false);
  assert.equal(registerDataConnectionSchema.safeParse({ ...base, fieldNames: [] }).success, false);
  assert.deepEqual(registerDataConnectionSchema.parse(base).fieldNames, fields);
  assert.equal(registerDataConnectionSchema.parse(base).displayName, "Site preview");
  assert.equal(safeReturnTo("/dashboard/settings/data-connections"), "/dashboard/settings/data-connections");
  const source = await readFile(new URL("../../src/features/data-connections/commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("previewSync"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
});

test("data connection copy shows preview and approved states in both languages", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.dataConnections.description, /预览/);
  assert.match(zhCN.dataConnections.description, /已批准/);
  assert.match(zhCN.dataConnections.description, /字段名/);
  assert.match(zhCN.dataConnections.description, /数量/);
  assert.match(zhCN.dataConnections.description, /事件/);
  assert.match(zhCN.dataConnections.description, /访问令牌/);
  assert.equal(zhCN.dataConnections.statusPreview, "预览");
  assert.equal(zhCN.dataConnections.statusApproved, "已批准");
  assert.match(en.dataConnections.description, /preview/i);
  assert.match(en.dataConnections.description, /approved/i);
  assert.match(en.dataConnections.description, /field names/i);
  assert.match(en.dataConnections.description, /count/i);
  assert.match(en.dataConnections.description, /event row/i);
  assert.match(en.dataConnections.description, /access token/i);
  assert.equal(en.dataConnections.statusPreview, "Preview");
  assert.equal(en.dataConnections.statusApproved, "Approved");
  assert.equal(zhCN.settings.openDataConnections.length > 0, true);
  assert.equal(en.settings.openDataConnections.length > 0, true);
  const panel = await readFile(new URL("../../src/features/data-connections/preview-panel.tsx", import.meta.url), "utf8");
  assert.equal(panel.includes("statusPreview") && panel.includes("statusApproved"), true);
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
      .filter((row) => row.tbl_name === "data_connection" || row.tbl_name === "data_connection_field")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "data_connection" || row.table_name === "data_connection_field")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Connection owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function plainRows(rows) {
  return rows.map((row) => ({ position: row.position, fieldName: row.fieldName }));
}

async function fieldRows(db, connectionId) {
  return queryWithParameters(
    db,
    `SELECT position, field_name AS "fieldName" FROM data_connection_field
     WHERE connection_id = ? ORDER BY position ASC`,
    [connectionId],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: preview keeps the submitted fields and records one pull only after approval`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /data_connection_owner_idx/);
        assert.match(defined, /data_connection_field_connection_idx/);
        assert.match(defined, /data_connection_field_name_uidx/);
        assert.match(defined, /data_connection_field_owner_idx/);
        assert.match(defined, /data_connection_state_check/);
        assert.match(defined, /data_connection_field_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /data_connection_field_connection_fk/);
        else assert.match(defined, /FOREIGN KEY \(`connection_id`\) REFERENCES `data_connection`/);
        const columns = storedColumns(migrated);
        for (const word of ["password", "token", "secret", "cookie", "authorization", "host"]) {
          assert.equal(columns.includes(word), false, word);
        }

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);
        const created = await registerDataConnection(db, owner, {
          brandId: brand,
          displayName: "站点预览",
          fieldNames: fields,
        }, clock);
        assert.equal(created.connection.status, "preview");
        assert.equal(created.connection.fieldCount, 3);
        assert.deepEqual(created.connection.fieldNames, fields);
        assert.equal(created.connection.preview.pull, false);
        assert.equal(created.connection.pullAttemptedAt, null);
        assert.deepEqual(plainRows(await fieldRows(db, created.connection.id)), fields.map((fieldName, position) => ({ position, fieldName })));

        const blockedWatch = watch(db);
        const blocked = await pullDataConnection(blockedWatch.connection, owner, created.connection.id, clock);
        assert.deepEqual(blocked, { error: "PULL_BLOCKED" });
        assert.equal(JSON.stringify(blocked).includes("event_id"), false);
        assert.equal(writes(blockedWatch.captured).length, 0);
        const stillPreview = await listDataConnections(db, owner);
        const previewRow = stillPreview.connections.find((connection) => connection.id === created.connection.id);
        assert.equal(previewRow.status, "preview");
        assert.equal(previewRow.pullAttemptedAt, null);
        assert.deepEqual(previewRow.fieldNames, fields);

        const hidden = await pullDataConnection(db, outsider, created.connection.id, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("event_id"), false);
        assert.equal(JSON.stringify(hidden).includes("page_path"), false);
        const hiddenWatch = watch(db);
        const hiddenList = await listDataConnections(hiddenWatch.connection, outsider);
        assert.equal(hiddenList.connections.some((connection) => connection.id === created.connection.id), false);
        assert.equal(JSON.stringify(hiddenList).includes("event_id"), false);
        assert.equal(JSON.stringify(hiddenList).includes("站点预览"), false);

        const approved = await approveDataConnection(db, owner, created.connection.id, clock);
        assert.equal(approved.connection.status, "approved");
        assert.equal(approved.connection.preview.pull, true);
        assert.deepEqual(approved.connection.fieldNames, fields);
        assert.equal(approved.connection.pullAttemptedAt, null);
        const again = await approveDataConnection(db, owner, created.connection.id, clock);
        assert.equal(again.connection.status, "approved");
        assert.equal(again.connection.updatedAt, approved.connection.updatedAt);

        const pullWatch = watch(db);
        const pulled = await pullDataConnection(pullWatch.connection, owner, created.connection.id, clock);
        assert.match(pulled.connection.pullAttemptedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.equal(writes(pullWatch.captured).length, 1);
        assert.match(writes(pullWatch.captured)[0].sql, /update data_connection/i);
        const repeatWatch = watch(db);
        const repeated = await pullDataConnection(repeatWatch.connection, owner, created.connection.id, clock);
        assert.equal(repeated.connection.pullAttemptedAt, pulled.connection.pullAttemptedAt);
        assert.equal(writes(repeatWatch.captured).length, 0);
        assert.deepEqual(plainRows(await fieldRows(db, created.connection.id)), fields.map((fieldName, position) => ({ position, fieldName })));
        const attempts = await queryWithParameters(
          db,
          `SELECT pull_attempted_at AS "pullAttemptedAt", status FROM data_connection WHERE id = ?`,
          [created.connection.id],
        );
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].status, "approved");
        assert.equal(attempts[0].pullAttemptedAt, pulled.connection.pullAttemptedAt);

        const outsiderApprove = await approveDataConnection(db, outsider, created.connection.id, clock);
        assert.deepEqual(outsiderApprove, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderApprove).includes("session_count"), false);

        const listWatch = watch(db);
        const listed = await listDataConnections(listWatch.connection, owner);
        const connectionSelects = listWatch.captured.filter((item) => isSelect(item.sql, "data_connection") && !isSelect(item.sql, "data_connection_field"));
        const fieldSelects = listWatch.captured.filter((item) => isSelect(item.sql, "data_connection_field"));
        assert.equal(connectionSelects.length, 1);
        assert.equal(fieldSelects.length, 1);
        assert.match(fieldSelects[0].sql, /connection_id IN/i);
        assert.equal(listed.connections.some((connection) => connection.id === created.connection.id), true);
        assert.equal(listWatch.captured.flatMap((item) => item.values ?? []).includes(owner), true);

        const extra = Array.from({ length: 3000 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO data_connection (
            id, brand_id, owner_id, display_name, status, field_count, pull_attempted_at, created_at, updated_at
          ) VALUES ${extra.map(() => "(?, ?, ?, 'noise', 'preview', 1, NULL, ?, ?)").join(", ")}`,
          extra.flatMap((id) => [id, otherBrand, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO data_connection_field (
            id, connection_id, brand_id, owner_id, position, field_name
          ) VALUES ${extra.map(() => "(?, ?, ?, ?, 0, 'noise_field')").join(", ")}`,
          extra.flatMap((id) => [randomUUID(), id, otherBrand, outsider]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE data_connection");
          await db.query("ANALYZE data_connection_field");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = dataConnectionOwnerQuery(owner);
        const fieldQuery = dataConnectionFieldsQuery(owner, [created.connection.id]);
        const connectionPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        const fieldPlan = JSON.stringify(await queryWithParameters(db, explain + fieldQuery.sql, fieldQuery.values));
        assert.match(connectionPlan, /data_connection_owner_idx/);
        assert.match(fieldPlan, /data_connection_field_owner_idx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(connectionPlan, /Seq Scan on data_connection/);
          assert.doesNotMatch(fieldPlan, /Seq Scan on data_connection_field/);
        }

        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE data_connection SET pull_attempted_at = ? WHERE id = ? AND status = 'preview'`,
            [time, extra[0]],
          ),
          /CHECK|check constraint/i,
        );
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
