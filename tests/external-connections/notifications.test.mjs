import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  getNotificationEndpoint,
  listNotificationEndpoints,
  registerNotificationEndpoint,
  requestNotificationDelivery,
  revokeNotificationEndpoint,
} from "../../src/features/notification-endpoints/commands.ts";
import {
  notificationEndpointErrors,
  registerNotificationEndpointSchema,
  requestNotificationDeliverySchema,
  revokeNotificationEndpointSchema,
} from "../../src/features/notification-endpoints/contracts.ts";
import {
  notificationDeliveryListQuery,
  notificationEndpointListQuery,
} from "../../src/features/notification-endpoints/dao.ts";
import { classifyNoticeBody, decideDelivery } from "../../src/features/notification-endpoints/rules.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";

function hash(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

test("notification input rejects credentials and classifies customer text without keeping the body", async () => {
  assert.equal(notificationEndpointErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const base = { brandId, label: " Ops desk " };
  assert.equal(registerNotificationEndpointSchema.safeParse({ ...base, token: "secret" }).success, false);
  assert.equal(registerNotificationEndpointSchema.safeParse({ ...base, accessToken: "secret" }).success, false);
  assert.equal(registerNotificationEndpointSchema.safeParse({ ...base, password: "secret" }).success, false);
  assert.equal(registerNotificationEndpointSchema.safeParse({ ...base, label: "desk token" }).success, false);
  assert.equal(registerNotificationEndpointSchema.safeParse({ ...base, label: "pending" }).success, true);
  assert.equal(registerNotificationEndpointSchema.parse(base).label, "Ops desk");
  assert.equal(revokeNotificationEndpointSchema.safeParse({ token: "secret" }).success, false);
  assert.equal(revokeNotificationEndpointSchema.safeParse({}).success, true);
  const customer = `客户原文 ${randomUUID()}`;
  assert.equal(requestNotificationDeliverySchema.safeParse({ body: customer, token: "secret" }).success, false);
  assert.equal(requestNotificationDeliverySchema.parse({ body: ` ${customer} ` }).body, customer);
  const classified = classifyNoticeBody(customer);
  assert.equal(classified.bodyHasCustomerText, true);
  assert.equal(classified.bodyHash, hash(customer));
  assert.equal("body" in classified, false);
  const clean = "weekly local reminder";
  assert.deepEqual(decideDelivery({ revoked: false, body: clean }), {
    sent: true, historyDeleted: false, bodyHasCustomerText: false, bodyHash: hash(clean),
  });
  assert.equal(decideDelivery({ revoked: true, body: clean }).sent, false);
  assert.equal(decideDelivery({ revoked: false, body: "Customer text stays here" }).sent, false);
  assert.equal(decideDelivery({ revoked: true, body: customer }).historyDeleted, false);
  const source = await readFile(new URL("../../src/features/notification-endpoints/commands.ts", import.meta.url), "utf8");
  const dao = await readFile(new URL("../../src/features/notification-endpoints/dao.ts", import.meta.url), "utf8");
  assert.match(source, /notifyNext\(/);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|external_connection/.test(source), false);
  assert.equal(/\bfetch\s*\(|\bundici\b|external_connection|\bbody_text\b|\bcontent\b/.test(dao), false);
  assert.equal(safeReturnTo("/dashboard/settings/notifications"), "/dashboard/settings/notifications");
});

test("notification copy tells both locales that revocation stops the next send and customer text is not stored", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  for (const phrase of ["撤销", "停止发送", "历史", "客户原文", "customer text", "哈希", "原文", "本地允许", "访问令牌"]) {
    assert.match(zhCN.notificationEndpoints.description, new RegExp(phrase));
  }
  for (const phrase of ["revok", "stop", "history", "客户原文", "customer text", "hash", "original", "locally allowed", "access token"]) {
    assert.match(en.notificationEndpoints.description, new RegExp(phrase, "i"));
  }
  assert.equal(zhCN.settings.openNotificationEndpoints.length > 0, true);
  assert.equal(en.settings.openNotificationEndpoints.length > 0, true);
  assert.equal(zhCN.notificationEndpoints.NOT_FOUND.includes("端点名称"), false);
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

function columnText(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "notification_endpoint" || row.tbl_name === "notification_delivery")
      .map((row) => row.sql ?? "")
      .join("\n");
  }
  return shape.columns
    .filter((row) => row.table_name === "notification_endpoint" || row.table_name === "notification_delivery")
    .map((row) => row.column_name)
    .join(",");
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Notification owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function rowsContaining(db, secret) {
  const endpoints = await queryWithParameters(db, "SELECT * FROM notification_endpoint", []);
  const deliveries = await queryWithParameters(db, "SELECT * FROM notification_delivery", []);
  return JSON.stringify({ endpoints, deliveries }).includes(secret);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: revocation stops the next notice, customer text is not stored, and another user gets nothing`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /notification_endpoint_owner_idx/);
        assert.match(defined, /notification_delivery_endpoint_idx/);
        assert.match(defined, /notification_endpoint_state_check/);
        assert.match(defined, /notification_delivery_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /notification_delivery_endpoint_fk/);
        else assert.match(defined, /FOREIGN KEY \(`endpoint_id`\) REFERENCES `notification_endpoint`/);
        const columns = columnText(migrated);
        for (const name of ["password", "token", "secret", "cookie", "authorization", "body_text", "content"]) {
          assert.equal(columns.toLowerCase().includes(name), false, name);
        }
        assert.match(columns, /body_hash/);
        assert.match(columns, /body_has_customer_text/);
        assert.equal(columns.includes('"body"') || columns.includes("`body`") || columns.split(",").includes("body"), false);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom("2026-11-23T10:00:00.000Z");
        const label = `Desk ${randomUUID()}`;

        const hidden = await registerNotificationEndpoint(db, outsider, { brandId: brand, label: "Hidden desk" }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(label), false);

        const registered = await registerNotificationEndpoint(db, owner, { brandId: brand, label }, clock);
        assert.equal(registered.endpoint.status, "verified");
        assert.equal(registered.endpoint.label, label);
        assert.deepEqual(registered.endpoint.deliveries, []);
        const endpointId = registered.endpoint.id;

        const clean = `weekly local reminder ${randomUUID()}`;
        const allowedWatch = watch(db);
        const allowed = await requestNotificationDelivery(allowedWatch.connection, owner, endpointId, { body: clean }, clock);
        const allowedRow = allowed.endpoint.deliveries.at(-1);
        assert.equal(allowedRow.sent, true);
        assert.equal(allowedRow.bodyHasCustomerText, false);
        assert.equal(allowedRow.bodyHash, hash(clean));
        assert.equal(JSON.stringify(allowed).includes(clean), false);
        assert.equal(await rowsContaining(db, clean), false);
        const allowedInsert = allowedWatch.captured.find((item) => /insert into notification_delivery\b/i.test(item.sql));
        assert.equal(allowedInsert.values.includes(clean), false);
        assert.equal(allowedInsert.values.includes(1), true);
        assert.equal(allowedWatch.captured.some((item) => /^\s*delete\b/i.test(item.sql)), false);

        const customer = `客户原文 ${randomUUID()}`;
        const leakedWatch = watch(db);
        const leaked = await requestNotificationDelivery(leakedWatch.connection, owner, endpointId, { body: customer }, clock);
        const leakedRow = leaked.endpoint.deliveries.at(-1);
        assert.equal(leakedRow.sent, false);
        assert.equal(leakedRow.bodyHasCustomerText, true);
        assert.equal(leakedRow.bodyHash, hash(customer));
        assert.equal(JSON.stringify(leaked).includes(customer), false);
        assert.equal(await rowsContaining(db, customer), false);
        const leakedInsert = leakedWatch.captured.find((item) => /insert into notification_delivery\b/i.test(item.sql));
        assert.equal(leakedInsert.values.includes(customer), false);
        assert.equal(leakedInsert.values[4], 0);
        assert.equal(leakedInsert.values[5], 1);
        assert.equal(leaked.endpoint.deliveries[0].sent, true);
        assert.equal(leaked.endpoint.deliveries.length, 2);

        const invalid = await requestNotificationDelivery(db, owner, endpointId, { body: customer, token: "secret" }, clock);
        assert.deepEqual(invalid, { error: "INVALID_INPUT" });
        assert.equal(JSON.stringify(invalid).includes(customer), false);
        assert.equal((await queryWithParameters(db, "SELECT id FROM notification_delivery WHERE endpoint_id = ?", [endpointId])).length, 2);

        const beforeRevoke = leaked.endpoint.deliveries.length;
        const revoked = await revokeNotificationEndpoint(db, owner, endpointId, clock);
        assert.equal(revoked.endpoint.status, "revoked");
        assert.equal(revoked.endpoint.deliveries.length, beforeRevoke);
        assert.equal(revoked.endpoint.deliveries[0].sent, true);
        assert.equal(revoked.endpoint.deliveries[0].bodyHash, hash(clean));

        const stoppedBody = `weekly local reminder ${randomUUID()}`;
        const stopped = await requestNotificationDelivery(db, owner, endpointId, { body: stoppedBody }, clock);
        assert.equal(stopped.endpoint.deliveries.length, beforeRevoke + 1);
        assert.equal(stopped.endpoint.deliveries.at(-1).sent, false);
        assert.equal(stopped.endpoint.deliveries.at(-1).bodyHasCustomerText, false);
        assert.equal(stopped.endpoint.deliveries[0].sent, true);
        assert.equal(await rowsContaining(db, stoppedBody), false);
        const again = await revokeNotificationEndpoint(db, owner, endpointId, clock);
        assert.equal(again.endpoint.status, "revoked");
        assert.equal(again.endpoint.deliveries.length, stopped.endpoint.deliveries.length);

        const deniedWatch = watch(db);
        const denied = await getNotificationEndpoint(deniedWatch.connection, outsider, endpointId);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes(label), false);
        assert.equal(deniedWatch.captured.some((item) => isSelect(item.sql, "notification_delivery")), false);
        const deniedDelivery = await requestNotificationDelivery(db, outsider, endpointId, { body: clean }, clock);
        assert.deepEqual(deniedDelivery, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedDelivery).includes(label), false);
        const deniedRevoke = await revokeNotificationEndpoint(db, outsider, endpointId, clock);
        assert.deepEqual(deniedRevoke, { error: "NOT_FOUND" });

        const ownerRead = await getNotificationEndpoint(db, owner, endpointId);
        assert.equal(ownerRead.endpoint.label, label);
        assert.equal(ownerRead.endpoint.deliveries.length, stopped.endpoint.deliveries.length);
        assert.equal(JSON.stringify(ownerRead).includes(customer), false);
        assert.equal(JSON.stringify(ownerRead).includes(clean), false);

        const listWatch = watch(db);
        const listed = await listNotificationEndpoints(listWatch.connection, owner);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "notification_endpoint")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "notification_delivery")).length, 1);
        assert.equal(listed.endpoints.some((endpoint) => endpoint.id === endpointId), true);
        const outsiderList = await listNotificationEndpoints(db, outsider);
        assert.equal(outsiderList.endpoints.some((endpoint) => endpoint.label === label), false);

        const hex = "ab".repeat(32);
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO notification_endpoint (
              id, brand_id, owner_id, label, status, created_at, updated_at
            ) VALUES (?, ?, ?, 'bad', 'pending', ?, ?)`,
            [randomUUID(), brand, owner, time, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO notification_delivery (
              id, endpoint_id, brand_id, owner_id, sent, body_has_customer_text, body_hash, created_at
            ) VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
            [randomUUID(), endpointId, brand, owner, hex, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO notification_delivery (
              id, endpoint_id, brand_id, owner_id, sent, body_has_customer_text, body_hash, created_at
            ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
            [randomUUID(), endpointId, brand, owner, "g".repeat(64), time],
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
          `INSERT INTO notification_endpoint (
            id, brand_id, owner_id, label, status, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'noise', 'verified', ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO notification_delivery (
            id, endpoint_id, brand_id, owner_id, sent, body_has_customer_text, body_hash, created_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 1, 0, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, hex, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE notification_endpoint");
          await db.query("ANALYZE notification_delivery");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const endpointQuery = notificationEndpointListQuery(owner);
        const deliveryQuery = notificationDeliveryListQuery(owner, endpointId);
        const endpointPlan = JSON.stringify(await queryWithParameters(db, explain + endpointQuery.sql, endpointQuery.values));
        const deliveryPlan = JSON.stringify(await queryWithParameters(db, explain + deliveryQuery.sql, deliveryQuery.values));
        assert.match(endpointPlan, /notification_endpoint_owner_idx/);
        assert.match(deliveryPlan, /notification_delivery_endpoint_idx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(endpointPlan, /Seq Scan on notification_endpoint/);
          assert.doesNotMatch(deliveryPlan, /Seq Scan on notification_delivery/);
        }
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
