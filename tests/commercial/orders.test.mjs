import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { recordOrder } from "../../src/features/commercial/billing.ts";
import {
  formatOrderMoney,
  orderErrors,
  orderRegistrationInput,
} from "../../src/features/commercial/order-contracts.ts";
import {
  listServiceOrders,
  loadOrderWorkspace,
  readServiceOrder,
  registerServiceOrder,
} from "../../src/features/commercial/order-commands.ts";
import { serviceOrderQuery, serviceOrdersQuery } from "../../src/features/commercial/order-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T04:00:00.000Z";
const later = "2026-11-23T05:00:00.000Z";
const nameA = "品牌甲订单名称合成";
const nameB = "品牌乙订单名称合成";
const factA = "品牌甲订单事实合成不可泄露";
const secretAmount = 86421397;

test("order input rejects a payment claim and keeps amount text stable", async () => {
  assert.equal(orderErrors.INVALID_INPUT, 400);
  assert.equal(orderErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/commercial/orders"), "/dashboard/commercial/orders");
  const brandId = randomUUID();
  const valid = { brandId, quoted: true, amount: 1200, currency: "CNY" };
  assert.deepEqual(orderRegistrationInput(valid), { input: valid });
  assert.equal(orderRegistrationInput({ ...valid, paid: 1 }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, paid: true }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, paymentConnected: true }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, paymentConnected: false }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, status: "paid" }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, currency: "cny" }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, amount: -1 }).error, "INVALID_INPUT");
  assert.equal(orderRegistrationInput({ ...valid, name: nameA }).error, "INVALID_INPUT");
  assert.equal(formatOrderMoney(1200, "CNY"), "1200 CNY");
  assert.equal(formatOrderMoney(1200, "CNY"), formatOrderMoney(1200, "CNY"));
  const quoted = recordOrder({ paymentConnected: false, quoted: true });
  const draft = recordOrder({ paymentConnected: false, quoted: false });
  assert.equal(quoted.state, "awaiting_payment");
  assert.equal(quoted.paid, false);
  assert.equal(draft.state, "draft");
  assert.equal(draft.paid, false);
  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.equal(zh.orders.statusAwaitingPayment, "待支付");
  assert.equal(zh.orders.statusDraft, "草稿");
  assert.equal(en.orders.statusAwaitingPayment, "Awaiting payment");
  assert.equal(en.orders.statusDraft, "Draft");
  assert.equal(zh.orders.currencyHint.includes("CNY"), true);
  assert.equal(en.orders.currencyHint.includes("CNY"), true);
  for (const catalog of [zh.orders, en.orders]) {
    assert.equal(/收款成功|payment received|paid successfully|payment successful/i.test(JSON.stringify(catalog)), false);
  }
  const query = serviceOrdersQuery(brandId);
  assert.deepEqual(query.values, [brandId, 100]);
  assert.equal(query.sql.includes("service_order"), true);
  assert.equal(query.sql.includes("owner_id = ?"), true);
  assert.equal(query.sql.includes("brand_version"), false);
  const one = serviceOrderQuery(brandId, brandId);
  assert.equal(one.sql.includes("id = ? AND owner_id = ?"), true);
});

function hidden(value, forbidden) {
  const text = JSON.stringify(value);
  for (const secret of forbidden) assert.equal(text.includes(String(secret)), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "订单夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ fact: factA, name }), time]);
}

async function countOf(db, table) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table}`, []);
  return Number(row.n);
}

function watch(db) {
  const sqls = [];
  const calls = [];
  return {
    sqls,
    calls,
    connection: {
      kind: db.kind,
      query(sql, values) {
        sqls.push(sql);
        calls.push(values ?? []);
        return db.query(sql, values);
      },
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a quote without a payment connector stays unpaid and hidden from another owner`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const frozen = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addBrand(db, ownerA, frozen, "冻结品牌订单名称合成");
      await queryWithParameters(db, `UPDATE brand SET frozen_at = ? WHERE id = ?`, [time, frozen]);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      const claim = { brandId: brandA, quoted: true, amount: secretAmount, currency: "CNY" };
      assert.equal(orderRegistrationInput({ ...claim, paid: 1 }).error, "INVALID_INPUT");
      assert.equal(orderRegistrationInput({ ...claim, paymentConnected: true }).error, "INVALID_INPUT");
      assert.equal(await countOf(db, "service_order"), 0);

      const watched = watch(db);
      const quoted = await registerServiceOrder(watched.connection, ownerA, {
        brandId: brandA, quoted: true, amount: 1200, currency: "CNY",
      }, time);
      assert.equal(watched.sqls.length, 1);
      assert.match(watched.sqls[0], /,\s*0\s*,/);
      assert.equal(watched.calls[0].includes(0), false);
      assert.equal(quoted.order.status, recordOrder({ paymentConnected: false, quoted: true }).state);
      assert.equal(quoted.order.paid, 0);
      assert.equal(quoted.order.amount, 1200);
      assert.equal(quoted.order.currency, "CNY");
      const draft = await registerServiceOrder(db, ownerA, {
        brandId: brandA, quoted: false, amount: 50, currency: "USD",
      }, later);
      assert.equal(draft.order.status, "draft");
      assert.equal(draft.order.paid, 0);
      assert.equal(draft.order.currency, "USD");
      const [stored] = await queryWithParameters(db, `SELECT status, paid, quoted, amount, currency FROM service_order WHERE id = ?`, [quoted.order.id]);
      assert.equal(stored.status, "awaiting_payment");
      assert.equal(Number(stored.paid), 0);
      assert.equal(Number(stored.quoted), 1);
      assert.equal(Number(stored.amount), 1200);
      assert.equal(stored.currency, "CNY");

      const foreignBrand = await registerServiceOrder(db, ownerA, {
        brandId: brandB, quoted: true, amount: secretAmount, currency: "EUR",
      }, time);
      assert.equal(foreignBrand.error, "NOT_FOUND");
      const frozenBrand = await registerServiceOrder(db, ownerA, {
        brandId: frozen, quoted: true, amount: 10, currency: "CNY",
      }, time);
      assert.equal(frozenBrand.error, "NOT_FOUND");
      const secret = await registerServiceOrder(db, ownerB, {
        brandId: brandB, quoted: true, amount: secretAmount, currency: "EUR",
      }, time);
      assert.equal(secret.order.paid, 0);
      assert.equal(await countOf(db, "service_order"), 3);

      const missed = await readServiceOrder(db, ownerA, secret.order.id);
      assert.deepEqual(missed, { error: "NOT_FOUND" });
      hidden(missed, [secretAmount, "EUR", nameB, factA]);
      const seen = await readServiceOrder(db, ownerA, quoted.order.id);
      assert.equal(seen.order.status, "awaiting_payment");
      assert.equal(seen.order.paid, 0);
      assert.equal(formatOrderMoney(seen.order.amount, seen.order.currency), "1200 CNY");

      const listed = watch(db);
      const own = await listServiceOrders(listed.connection, ownerA);
      assert.equal(listed.sqls.length, 1);
      assert.deepEqual(own.orders.map((order) => order.status), ["awaiting_payment", "draft"]);
      assert.equal(own.orders.every((order) => order.paid === 0), true);
      hidden(own, [secretAmount, "EUR", factA, nameB]);
      const other = await listServiceOrders(db, ownerB);
      assert.equal(other.orders.length, 1);
      assert.equal(other.orders[0].amount, secretAmount);
      hidden(other, [1200, "CNY", nameA, factA]);

      const workspaceWatch = watch(db);
      const workspace = await loadOrderWorkspace(workspaceWatch.connection, ownerA);
      assert.equal(workspaceWatch.sqls.length, 2);
      assert.equal(workspaceWatch.sqls.filter((sql) => sql.includes("service_order")).length, 1);
      assert.equal(workspace.brands[0].name, nameA);
      hidden(workspace, [factA, secretAmount, nameB]);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO service_order
          (id, brand_id, owner_id, quoted, status, paid, amount, currency, created_at)
          VALUES (?, ?, ?, 1, 'awaiting_payment', 1, 100, 'CNY', ?)`, [randomUUID(), brandA, ownerA, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO service_order
          (id, brand_id, owner_id, quoted, status, paid, amount, currency, created_at)
          VALUES (?, ?, ?, 1, 'paid', 0, 100, 'CNY', ?)`, [randomUUID(), brandA, ownerA, time]),
        /CHECK|check|constraint/i,
      );
      const [paidRows] = await queryWithParameters(db, `SELECT count(*) AS n FROM service_order WHERE paid = 1`, []);
      assert.equal(Number(paidRows.n), 0);

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO service_order
          (id, brand_id, owner_id, quoted, status, paid, amount, currency, created_at)
          VALUES (?, ?, ?, 1, 'awaiting_payment', 0, 100, 'CNY', ?)`, [randomUUID(), brandA, ownerA, time]);
      }
      const scale = watch(db);
      const scaled = await listServiceOrders(scale.connection, ownerA);
      assert.equal(scale.sqls.length, 1);
      assert.equal(scaled.orders.length, 26);
      hidden(scaled, [secretAmount, "EUR"]);
      if (db.kind === "postgresql") await db.query("ANALYZE service_order");
      const listQuery = serviceOrdersQuery(ownerA);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const plan = await planFor(listQuery.sql, listQuery.values);
      assert.match(plan, /service_order_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /service_order_owner_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
