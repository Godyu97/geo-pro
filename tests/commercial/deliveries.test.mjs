import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  acceptDelivery,
  disputeDelivery,
  registerDeliveryState,
} from "../../src/features/commercial/delivery.ts";
import {
  deliveryAcceptInput,
  deliveryDisputeInput,
  deliveryErrors,
  deliveryHasPaymentClaim,
  deliveryRegistrationInput,
} from "../../src/features/commercial/delivery-contracts.ts";
import {
  acceptBrandDelivery,
  disputeBrandDelivery,
  listBrandDeliveries,
  loadDeliveryWorkspace,
  readBrandDelivery,
  registerBrandDelivery,
} from "../../src/features/commercial/delivery-commands.ts";
import { brandDeliveriesQuery, brandDeliveryQuery } from "../../src/features/commercial/delivery-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T06:00:00.000Z";
const later = "2026-11-23T07:00:00.000Z";
const nameA = "品牌甲交付名称合成";
const nameB = "品牌乙交付名称合成";
const factA = "品牌甲交付事实合成不可泄露";
const titleA = "北岸交付标题合成";
const titleB = "东岸交付标题合成";
const secretTitle = "机密交付标题合成不可见";
const reasonA = "范围与约定不一致";
const secretReason = "机密争议原因合成不可见";

test("delivery transitions stay pending until accept or dispute and reject payment claims", async () => {
  assert.equal(deliveryErrors.CONFLICT, 409);
  assert.equal(deliveryErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/commercial/deliveries"), "/dashboard/commercial/deliveries");
  const brandId = randomUUID();
  const opened = registerDeliveryState();
  assert.deepEqual(opened, { status: "pending", disputeReason: null });
  assert.deepEqual(acceptDelivery(opened), { ok: true, state: { status: "accepted", disputeReason: null } });
  const disputed = { status: "disputed", disputeReason: reasonA };
  assert.deepEqual(acceptDelivery(disputed), { ok: false, error: "CONFLICT" });
  assert.deepEqual(disputeDelivery(disputed, "另一原因"), { ok: false, error: "CONFLICT" });
  assert.equal(disputed.disputeReason, reasonA);
  assert.deepEqual(acceptDelivery({ status: "accepted", disputeReason: null }), { ok: false, error: "CONFLICT" });
  assert.deepEqual(disputeDelivery(opened, reasonA), { ok: true, state: { status: "disputed", disputeReason: reasonA } });

  const valid = { brandId, title: titleA };
  assert.deepEqual(deliveryRegistrationInput(valid), { input: valid });
  assert.equal(deliveryRegistrationInput({ ...valid, paid: 1 }).error, "INVALID_INPUT");
  assert.equal(deliveryRegistrationInput({ ...valid, paymentReceived: true }).error, "INVALID_INPUT");
  assert.equal(deliveryRegistrationInput({ ...valid, collected: true }).error, "INVALID_INPUT");
  assert.equal(deliveryRegistrationInput({ ...valid, status: "accepted" }).error, "INVALID_INPUT");
  assert.equal(deliveryRegistrationInput({ ...valid, disputeReason: reasonA }).error, "INVALID_INPUT");
  assert.equal(deliveryDisputeInput({ reason: reasonA }).reason, reasonA);
  assert.equal(deliveryDisputeInput({ reason: reasonA, paid: true }).error, "INVALID_INPUT");
  assert.equal(deliveryDisputeInput({ reason: " " }).error, "INVALID_INPUT");
  assert.deepEqual(deliveryAcceptInput(null), { ok: true });
  assert.deepEqual(deliveryAcceptInput({}), { ok: true });
  assert.equal(deliveryAcceptInput({ paid: true }).error, "INVALID_INPUT");
  assert.equal(deliveryAcceptInput({ status: "accepted" }).error, "INVALID_INPUT");

  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.equal(zh.deliveries.statusPending, "待签收");
  assert.equal(zh.deliveries.statusAccepted, "已接受");
  assert.equal(zh.deliveries.statusDisputed, "争议中");
  assert.equal(en.deliveries.statusPending, "Awaiting acceptance");
  assert.equal(en.deliveries.statusAccepted, "Accepted");
  assert.equal(en.deliveries.statusDisputed, "Disputed");
  for (const catalog of [zh.deliveries, en.deliveries]) {
    assert.equal(/收款成功|payment received|paid successfully|payment successful/i.test(JSON.stringify(catalog)), false);
  }
  const query = brandDeliveriesQuery(brandId);
  assert.deepEqual(query.values, [brandId, 100]);
  assert.equal(query.sql.includes("brand_delivery"), true);
  assert.equal(query.sql.includes("owner_id = ?"), true);
  assert.equal(query.sql.includes("paid"), false);
  assert.equal(query.sql.includes("brand_version"), false);
  const one = brandDeliveryQuery(brandId, brandId);
  assert.equal(one.sql.includes("id = ? AND owner_id = ?"), true);
});

function hidden(value, forbidden) {
  const text = JSON.stringify(value);
  for (const secret of forbidden) assert.equal(text.includes(String(secret)), false);
  return text;
}

function deliveryColumns(kind, snapshot) {
  if (kind === "postgresql") {
    return snapshot.columns
      .filter((column) => column.table_name === "brand_delivery")
      .map((column) => column.column_name)
      .sort()
      .join(",");
  }
  return snapshot.find((row) => row.name === "brand_delivery").sql;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "交付夹具", `${id}@example.invalid`]);
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
  return {
    sqls,
    connection: {
      kind: db.kind,
      query(sql, values) {
        sqls.push(sql);
        return db.query(sql, values);
      },
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a delivery can be accepted or disputed, and a dispute blocks acceptance`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const columns = deliveryColumns(db.kind, await structure(db));
      assert.match(columns, /title/);
      assert.match(columns, /dispute_reason/);
      assert.equal(columns.includes("paid"), false);
      assert.equal(columns.includes("payment"), false);
      assert.equal(columns.includes("collected"), false);

      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const frozen = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addBrand(db, ownerA, frozen, "冻结品牌交付名称合成");
      await queryWithParameters(db, `UPDATE brand SET frozen_at = ? WHERE id = ?`, [time, frozen]);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      assert.equal(deliveryRegistrationInput({ brandId: brandA, title: titleA, paid: true }).error, "INVALID_INPUT");
      assert.equal(await countOf(db, "brand_delivery"), 0);

      const createdWatch = watch(db);
      const created = await registerBrandDelivery(createdWatch.connection, ownerA, { brandId: brandA, title: titleA }, time);
      assert.equal(createdWatch.sqls.length, 1);
      assert.match(createdWatch.sqls[0], /INSERT INTO brand_delivery/);
      assert.equal(created.delivery.status, "pending");
      assert.equal(created.delivery.disputeReason, null);
      assert.equal(created.delivery.title, titleA);
      assert.equal(deliveryHasPaymentClaim(created.delivery), false);
      assert.equal(JSON.stringify(created).includes("paid"), false);

      const acceptedWatch = watch(db);
      const accepted = await acceptBrandDelivery(acceptedWatch.connection, ownerA, created.delivery.id);
      assert.equal(acceptedWatch.sqls.length, 2);
      assert.match(acceptedWatch.sqls[1], /UPDATE brand_delivery/);
      assert.equal(accepted.delivery.status, "accepted");
      assert.equal(accepted.delivery.disputeReason, null);
      assert.equal(deliveryHasPaymentClaim(accepted.delivery), false);
      assert.equal(/paid|paymentReceived|collected/.test(JSON.stringify(accepted)), false);
      const repeatAccept = await acceptBrandDelivery(db, ownerA, created.delivery.id);
      assert.equal(repeatAccept.error, "CONFLICT");

      const pending = await registerBrandDelivery(db, ownerA, { brandId: brandA, title: titleB }, later);
      assert.equal(pending.delivery.status, "pending");
      const disputedWatch = watch(db);
      const disputed = await disputeBrandDelivery(disputedWatch.connection, ownerA, pending.delivery.id, reasonA);
      assert.equal(disputedWatch.sqls.filter((sql) => sql.includes("UPDATE")).length, 1);
      assert.equal(disputed.delivery.status, "disputed");
      assert.equal(disputed.delivery.disputeReason, reasonA);
      const blockedWatch = watch(db);
      const blocked = await acceptBrandDelivery(blockedWatch.connection, ownerA, pending.delivery.id);
      assert.deepEqual(blocked, { error: "CONFLICT" });
      assert.equal(blockedWatch.sqls.some((sql) => sql.includes("UPDATE")), false);
      hidden(blocked, [titleB, reasonA, secretTitle, secretReason]);
      const overwrite = await disputeBrandDelivery(db, ownerA, pending.delivery.id, secretReason);
      assert.equal(overwrite.error, "CONFLICT");
      const [stored] = await queryWithParameters(
        db,
        `SELECT status, dispute_reason AS "disputeReason" FROM brand_delivery WHERE id = ?`,
        [pending.delivery.id],
      );
      assert.equal(stored.status, "disputed");
      assert.equal(stored.disputeReason, reasonA);

      const foreignBrand = await registerBrandDelivery(db, ownerA, { brandId: brandB, title: secretTitle }, time);
      assert.equal(foreignBrand.error, "NOT_FOUND");
      const frozenBrand = await registerBrandDelivery(db, ownerA, { brandId: frozen, title: titleA }, time);
      assert.equal(frozenBrand.error, "NOT_FOUND");
      const secret = await registerBrandDelivery(db, ownerB, { brandId: brandB, title: secretTitle }, time);
      const secretDispute = await disputeBrandDelivery(db, ownerB, secret.delivery.id, secretReason);
      assert.equal(secretDispute.delivery.status, "disputed");
      assert.equal(await countOf(db, "brand_delivery"), 3);

      const missed = await readBrandDelivery(db, ownerA, secret.delivery.id);
      assert.deepEqual(missed, { error: "NOT_FOUND" });
      hidden(missed, [secretTitle, secretReason, nameB, factA]);
      const foreignAccept = await acceptBrandDelivery(db, ownerA, secret.delivery.id);
      assert.deepEqual(foreignAccept, { error: "NOT_FOUND" });
      hidden(foreignAccept, [secretTitle, secretReason]);
      const seen = await readBrandDelivery(db, ownerA, created.delivery.id);
      assert.equal(seen.delivery.status, "accepted");
      assert.equal(deliveryHasPaymentClaim(seen.delivery), false);

      const listed = watch(db);
      const own = await listBrandDeliveries(listed.connection, ownerA);
      assert.equal(listed.sqls.length, 1);
      assert.deepEqual(own.deliveries.map((delivery) => delivery.status), ["accepted", "disputed"]);
      hidden(own, [secretTitle, secretReason, factA, nameB]);
      const other = await listBrandDeliveries(db, ownerB);
      assert.equal(other.deliveries.length, 1);
      assert.equal(other.deliveries[0].title, secretTitle);
      hidden(other, [titleA, titleB, reasonA, nameA, factA]);

      const workspaceWatch = watch(db);
      const workspace = await loadDeliveryWorkspace(workspaceWatch.connection, ownerA);
      assert.equal(workspaceWatch.sqls.length, 2);
      assert.equal(workspaceWatch.sqls.filter((sql) => sql.includes("brand_delivery")).length, 1);
      assert.equal(workspace.brands[0].name, nameA);
      hidden(workspace, [factA, secretTitle, secretReason, nameB]);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO brand_delivery
          (id, brand_id, owner_id, title, status, dispute_reason, created_at)
          VALUES (?, ?, ?, ?, 'paid', NULL, ?)`, [randomUUID(), brandA, ownerA, titleA, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO brand_delivery
          (id, brand_id, owner_id, title, status, dispute_reason, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`, [randomUUID(), brandA, ownerA, titleA, reasonA, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO brand_delivery
          (id, brand_id, owner_id, title, status, dispute_reason, created_at)
          VALUES (?, ?, ?, ?, 'disputed', NULL, ?)`, [randomUUID(), brandA, ownerA, titleA, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `UPDATE brand_delivery SET status = 'accepted' WHERE id = ?`, [pending.delivery.id]),
        /CHECK|check|constraint/i,
      );
      const [stillDisputed] = await queryWithParameters(
        db,
        `SELECT status, dispute_reason AS "disputeReason" FROM brand_delivery WHERE id = ?`,
        [pending.delivery.id],
      );
      assert.equal(stillDisputed.status, "disputed");
      assert.equal(stillDisputed.disputeReason, reasonA);

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO brand_delivery
          (id, brand_id, owner_id, title, status, dispute_reason, created_at)
          VALUES (?, ?, ?, ?, 'pending', NULL, ?)`, [randomUUID(), brandA, ownerA, `批量交付${index}`, time]);
      }
      const scale = watch(db);
      const scaled = await listBrandDeliveries(scale.connection, ownerA);
      assert.equal(scale.sqls.length, 1);
      assert.equal(scaled.deliveries.length, 26);
      hidden(scaled, [secretTitle, secretReason]);
      if (db.kind === "postgresql") await db.query("ANALYZE brand_delivery");
      const listQuery = brandDeliveriesQuery(ownerA);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const plan = await planFor(listQuery.sql, listQuery.values);
      assert.match(plan, /brand_delivery_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /brand_delivery_owner_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
