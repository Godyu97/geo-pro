import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  getExternalConnection,
  listBrandConnections,
  registerExternalConnection,
  retryExternalAction,
  submitExternalAction,
  updateExternalConnection,
} from "../../src/features/external-connections/commands.ts";
import {
  externalConnectionErrors,
  registerConnectionSchema,
  retryActionSchema,
  submitActionSchema,
  updateConnectionSchema,
} from "../../src/features/external-connections/contracts.ts";
import {
  externalActionListQuery,
  externalConnectionBrandQuery,
} from "../../src/features/external-connections/dao.ts";
import { receiptEffect, requestPublish, retryAction } from "../../src/features/external-connections/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const effective = "2026-11-23T09:30:00.000Z";

test("connection input rejects credentials and keeps draft receipts off the public timeline", async () => {
  assert.equal(externalConnectionErrors.REVOKED, 409);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const base = { brandId, label: " Local desk ", canRead: true, canDraft: true, canPublish: false };
  assert.equal(registerConnectionSchema.safeParse({ ...base, password: "secret" }).success, false);
  assert.equal(registerConnectionSchema.safeParse({ ...base, token: "secret" }).success, false);
  assert.equal(registerConnectionSchema.safeParse({ ...base, accessToken: "secret" }).success, false);
  assert.equal(registerConnectionSchema.safeParse({ ...base, cookie: "secret" }).success, false);
  assert.equal(registerConnectionSchema.safeParse({ ...base, label: "desk password" }).success, false);
  assert.equal(registerConnectionSchema.parse(base).label, "Local desk");
  const action = {
    idempotencyKey: "draft-key-1",
    confirmed: true,
    remoteState: "acknowledged",
    receiptKind: "public_url",
    effectiveAt: effective,
  };
  assert.equal(submitActionSchema.safeParse({ ...action, endpoint: "https://cms.example" }).success, false);
  assert.equal(submitActionSchema.safeParse({ ...action, idempotencyKey: "short" }).success, false);
  assert.equal(retryActionSchema.safeParse({ remoteState: null, receiptKind: null, effectiveAt: null, password: "x" }).success, false);
  assert.equal(updateConnectionSchema.safeParse({ id: brandId, status: "expired" }).success, false);
  assert.deepEqual(requestPublish({ scopes: ["read", "draft"], confirmed: true }), {
    accepted: false, reason: "manual_followup", countsAsPublic: false,
  });
  assert.equal(receiptEffect("draft_created").interventionEffective, false);
  assert.equal(receiptEffect("public_url").interventionEffective, true);
  assert.deepEqual(retryAction({ state: "unknown", sameKey: true }), { submit: false, reconcile: true });
  assert.deepEqual(retryAction({ state: "acknowledged", sameKey: true }), { submit: false, reconcile: true });
  const source = await readFile(new URL("../../src/features/external-connections/commands.ts", import.meta.url), "utf8");
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request/.test(source), false);
});

test("connection copy keeps draft publish, unknown reconciliation, and tokens out of the page", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.externalConnections.description, /草稿/);
  assert.match(zhCN.externalConnections.description, /公开发布/);
  assert.match(zhCN.externalConnections.description, /人工后续/);
  assert.match(zhCN.externalConnections.description, /manual_followup/);
  assert.match(zhCN.externalConnections.description, /对账/);
  assert.match(zhCN.externalConnections.description, /未知/);
  assert.match(zhCN.externalConnections.description, /生效时间/);
  assert.match(zhCN.externalConnections.description, /draft_created/);
  assert.match(zhCN.externalConnections.description, /public_url/);
  assert.match(zhCN.externalConnections.description, /口令/);
  assert.match(zhCN.externalConnections.description, /访问令牌/);
  assert.match(zhCN.externalConnections.description, /历史/);
  assert.match(en.externalConnections.description, /draft/i);
  assert.match(en.externalConnections.description, /public publish/i);
  assert.match(en.externalConnections.description, /manual follow-up/i);
  assert.match(en.externalConnections.description, /manual_followup/);
  assert.match(en.externalConnections.description, /reconcile/i);
  assert.match(en.externalConnections.description, /unknown/i);
  assert.match(en.externalConnections.description, /effective time/i);
  assert.match(en.externalConnections.description, /draft_created/);
  assert.match(en.externalConnections.description, /public_url/);
  assert.match(en.externalConnections.description, /password/i);
  assert.match(en.externalConnections.description, /access token/i);
  assert.match(en.externalConnections.description, /history/i);
  assert.equal(zhCN.settings.openExternalConnections.length > 0, true);
  assert.equal(en.settings.openExternalConnections.length > 0, true);
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

function findAction(connection, key) {
  const found = connection.actions.find((action) => action.idempotencyKey === key);
  assert.ok(found);
  return found;
}

function publishInput(key, extra = {}) {
  return {
    idempotencyKey: key,
    confirmed: true,
    remoteState: null,
    receiptKind: null,
    effectiveAt: null,
    ...extra,
  };
}

function storedColumns(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "external_connection" || row.tbl_name === "external_action")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "external_connection" || row.table_name === "external_action")
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

async function actionRows(db, connectionId, key) {
  return queryWithParameters(
    db,
    `SELECT id, status, receipt_kind AS "receiptKind", effective_at AS "effectiveAt"
     FROM external_action WHERE connection_id = ? AND idempotency_key = ?`,
    [connectionId, key],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: draft publish stays manual, an unknown key reconciles in one row, and another user cannot read it`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /external_connection_owner_idx/);
        assert.match(defined, /external_action_connection_idx/);
        assert.match(defined, /external_action_key_uidx/);
        assert.match(defined, /external_connection_state_check/);
        assert.match(defined, /external_action_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /external_action_connection_fk/);
        else assert.match(defined, /FOREIGN KEY \(`connection_id`\) REFERENCES `external_connection`/);
        const columns = storedColumns(migrated);
        for (const word of ["password", "token", "secret", "cookie", "authorization"]) {
          assert.equal(columns.includes(word), false, word);
        }

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom("2026-11-23T10:00:00.000Z");

        const hiddenRegister = await registerExternalConnection(db, outsider, {
          brandId: brand,
          label: "Hidden desk",
          canRead: true,
          canDraft: true,
          canPublish: true,
        }, clock);
        assert.deepEqual(hiddenRegister, { error: "NOT_FOUND" });

        const draft = await registerExternalConnection(db, owner, {
          brandId: brand,
          label: "Draft only desk",
          canRead: true,
          canDraft: true,
          canPublish: false,
        }, clock);
        assert.equal(draft.connection.status, "pending");
        assert.equal(draft.connection.canPublish, false);
        assert.deepEqual(draft.connection.actions, []);

        const refusalWatch = watch(db);
        const refused = await submitExternalAction(refusalWatch.connection, owner, draft.connection.id, publishInput("draft-publish-key", {
          remoteState: "acknowledged",
          receiptKind: "public_url",
          effectiveAt: effective,
        }), clock);
        const refusedAction = findAction(refused.connection, "draft-publish-key");
        assert.equal(refusedAction.status, "failed");
        assert.notEqual(refusedAction.status, "acknowledged");
        assert.equal(refusedAction.receiptKind, null);
        assert.equal(refusedAction.effectiveAt, null);
        assert.equal(refusedAction.reason, "manual_followup");
        assert.equal(refusedAction.countsAsPublic, false);
        assert.equal(refusedAction.interventionEffective, false);
        const refusalInsert = refusalWatch.captured.find((item) => /insert into external_action\b/i.test(item.sql));
        assert.equal(refusalInsert.values[6], "failed");
        assert.equal(refusalInsert.values[7], null);
        assert.equal(refusalInsert.values[8], null);
        assert.equal(/password|token|cookie/i.test(refusalInsert.sql), false);
        const repeated = await submitExternalAction(db, owner, draft.connection.id, publishInput("draft-publish-key", {
          remoteState: "acknowledged",
          receiptKind: "public_url",
          effectiveAt: effective,
        }), clock);
        assert.equal(findAction(repeated.connection, "draft-publish-key").status, "failed");
        assert.equal(findAction(repeated.connection, "draft-publish-key").effectiveAt, null);
        assert.equal((await actionRows(db, draft.connection.id, "draft-publish-key")).length, 1);

        const publisher = await registerExternalConnection(db, owner, {
          brandId: brand,
          label: "Publish desk",
          canRead: true,
          canDraft: true,
          canPublish: true,
        }, clock);
        const verified = await updateExternalConnection(db, owner, { id: publisher.connection.id, status: "verified" }, clock);
        assert.equal(verified.connection.status, "verified");
        const unconfirmed = await submitExternalAction(db, owner, publisher.connection.id, publishInput("needs-confirm-key", {
          confirmed: false,
        }), clock);
        const unconfirmedAction = findAction(unconfirmed.connection, "needs-confirm-key");
        assert.equal(unconfirmedAction.status, "failed");
        assert.equal(unconfirmedAction.reason, "needs_confirmation");
        assert.equal(unconfirmedAction.effectiveAt, null);
        assert.equal(unconfirmedAction.countsAsPublic, false);

        const draftReceipt = await submitExternalAction(db, owner, publisher.connection.id, publishInput("draft-receipt-key", {
          remoteState: "acknowledged",
          receiptKind: "draft_created",
          effectiveAt: null,
        }), clock);
        const draftAction = findAction(draftReceipt.connection, "draft-receipt-key");
        assert.equal(draftAction.status, "acknowledged");
        assert.equal(draftAction.receiptKind, "draft_created");
        assert.equal(draftAction.effectiveAt, null);
        assert.equal(draftAction.interventionEffective, false);
        assert.equal(draftAction.countsAsPublic, false);

        const datedDraft = await submitExternalAction(db, owner, publisher.connection.id, publishInput("draft-dated-key", {
          remoteState: "acknowledged",
          receiptKind: "draft_created",
          effectiveAt: effective,
        }), clock);
        assert.deepEqual(datedDraft, { error: "INVALID_INPUT" });
        assert.equal((await actionRows(db, publisher.connection.id, "draft-dated-key")).length, 0);

        const publicReceipt = await submitExternalAction(db, owner, publisher.connection.id, publishInput("public-url-key", {
          remoteState: "acknowledged",
          receiptKind: "public_url",
          effectiveAt: effective,
        }), clock);
        const publicAction = findAction(publicReceipt.connection, "public-url-key");
        assert.equal(publicAction.receiptKind, "public_url");
        assert.equal(publicAction.effectiveAt, effective);
        assert.equal(publicAction.interventionEffective, true);
        assert.equal(publicAction.countsAsPublic, false);

        const missingTime = await submitExternalAction(db, owner, publisher.connection.id, publishInput("public-missing-time", {
          remoteState: "acknowledged",
          receiptKind: "public_url",
          effectiveAt: null,
        }), clock);
        assert.deepEqual(missingTime, { error: "INVALID_INPUT" });
        assert.equal((await actionRows(db, publisher.connection.id, "public-missing-time")).length, 0);

        const unknown = await submitExternalAction(db, owner, publisher.connection.id, publishInput("unknown-submit-key", {
          remoteState: "unknown",
        }), clock);
        assert.equal(findAction(unknown.connection, "unknown-submit-key").status, "unknown");
        assert.equal(findAction(unknown.connection, "unknown-submit-key").effectiveAt, null);
        const againWatch = watch(db);
        const again = await submitExternalAction(againWatch.connection, owner, publisher.connection.id, publishInput("unknown-submit-key", {
          remoteState: "acknowledged",
          receiptKind: "public_url",
          effectiveAt: effective,
        }), clock);
        const reconciled = findAction(again.connection, "unknown-submit-key");
        assert.equal(reconciled.status, "reconciled");
        assert.equal(reconciled.effectiveAt, null);
        assert.equal(reconciled.receiptKind, null);
        assert.equal(againWatch.captured.some((item) => /insert into external_action\b/i.test(item.sql)), false);
        assert.equal((await actionRows(db, publisher.connection.id, "unknown-submit-key")).length, 1);

        const retryable = await submitExternalAction(db, owner, publisher.connection.id, publishInput("unknown-retry-key", {
          remoteState: "unknown",
        }), clock);
        const retryableAction = findAction(retryable.connection, "unknown-retry-key");
        const retried = await retryExternalAction(db, owner, publisher.connection.id, retryableAction.id, {
          remoteState: null,
          receiptKind: null,
          effectiveAt: null,
        }, clock);
        assert.equal(findAction(retried.connection, "unknown-retry-key").status, "reconciled");
        assert.equal((await actionRows(db, publisher.connection.id, "unknown-retry-key")).length, 1);

        const pendingUnknown = await submitExternalAction(db, owner, publisher.connection.id, publishInput("unknown-revoke-key", {
          remoteState: "unknown",
        }), clock);
        const pendingAction = findAction(pendingUnknown.connection, "unknown-revoke-key");
        const beforeRevoke = pendingUnknown.connection.actions.length;
        const revoked = await updateExternalConnection(db, owner, { id: publisher.connection.id, status: "revoked" }, clock);
        assert.equal(revoked.connection.status, "revoked");
        assert.equal(revoked.connection.actions.length, beforeRevoke);
        const blocked = await submitExternalAction(db, owner, publisher.connection.id, publishInput("after-revoke-key"), clock);
        assert.deepEqual(blocked, { error: "REVOKED" });
        const kept = await retryExternalAction(db, owner, publisher.connection.id, pendingAction.id, {
          remoteState: null,
          receiptKind: null,
          effectiveAt: null,
        }, clock);
        assert.equal(findAction(kept.connection, "unknown-revoke-key").status, "reconciled");
        assert.equal(kept.connection.actions.length, beforeRevoke);
        assert.equal(kept.connection.actions.some((action) => action.idempotencyKey === "public-url-key"), true);
        const stillPublic = findAction(kept.connection, "public-url-key");
        assert.equal(stillPublic.effectiveAt, effective);
        assert.equal((await actionRows(db, publisher.connection.id, "after-revoke-key")).length, 0);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE external_action SET receipt_kind = 'draft_created', effective_at = ?, updated_at = ? WHERE id = ?`,
            [effective, time, draftAction.id],
          ),
          /CHECK|check constraint/i,
        );

        const denied = await getExternalConnection(db, outsider, publisher.connection.id);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes("unknown-submit-key"), false);
        assert.equal(JSON.stringify(denied).includes("canPublish"), false);
        const deniedWatch = watch(db);
        const deniedList = await listBrandConnections(deniedWatch.connection, outsider, brand);
        assert.deepEqual(deniedList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedList).includes("Draft only desk"), false);
        assert.equal(JSON.stringify(deniedList).includes("unknown-submit-key"), false);
        assert.equal(deniedWatch.captured.some((item) => /\bexternal_connection\b/i.test(item.sql)), false);
        assert.equal(deniedWatch.captured.some((item) => /\bexternal_action\b/i.test(item.sql)), false);
        const ownerRead = await getExternalConnection(db, owner, draft.connection.id);
        assert.equal(ownerRead.connection.canDraft, true);
        assert.equal(ownerRead.connection.canPublish, false);
        assert.equal(findAction(ownerRead.connection, "draft-publish-key").reason, "manual_followup");

        const listWatch = watch(db);
        const listed = await listBrandConnections(listWatch.connection, owner, brand);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "external_connection")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "external_action")).length, 1);
        assert.equal(listed.connections.some((connection) => connection.id === publisher.connection.id), true);
        const listValues = listWatch.captured.flatMap((item) => item.values ?? []);
        assert.equal(listValues.includes("unknown-submit-key"), false);
        assert.equal(listValues.includes(owner), true);

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extraBrands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO external_connection (
            id, brand_id, owner_id, label, can_read, can_draft, can_publish, status, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, 'noise', 1, 1, 0, 'pending', ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO external_action (
            id, connection_id, brand_id, owner_id, idempotency_key, confirmed, status, receipt_kind, effective_at, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, ?, 0, 'failed', NULL, NULL, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, id, time, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE external_connection");
          await db.query("ANALYZE external_action");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const connectionQuery = externalConnectionBrandQuery(owner, brand);
        const actionQuery = externalActionListQuery(owner, publisher.connection.id);
        const connectionPlan = JSON.stringify(await queryWithParameters(db, explain + connectionQuery.sql, connectionQuery.values));
        const actionPlan = JSON.stringify(await queryWithParameters(db, explain + actionQuery.sql, actionQuery.values));
        assert.match(connectionPlan, /external_connection_owner_idx/);
        assert.match(actionPlan, /external_action_connection_idx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(connectionPlan, /Seq Scan on external_connection/);
          assert.doesNotMatch(actionPlan, /Seq Scan on external_action/);
        }
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
