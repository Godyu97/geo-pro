import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { revokeSync } from "../../src/features/data-connections/crawler-identity.ts";
import {
  listSyncAuthorizations,
  pullSyncAuthorization,
  registerSyncAuthorization,
  revokeSyncAuthorization,
} from "../../src/features/data-connections/revocation-commands.ts";
import {
  registerSyncAuthorizationSchema,
  syncAuthorizationErrors,
} from "../../src/features/data-connections/revocation-contracts.ts";
import {
  syncAttemptsForOwnerQuery,
  syncAuthorizationsForOwnerQuery,
} from "../../src/features/data-connections/revocation-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const sourceName = "北岸同步源";
const retainedRows = 41827;

test("sync revocation keeps retained rows and refuses the next pull", () => {
  assert.equal(syncAuthorizationErrors.NOT_FOUND, 404);
  const kept = revokeSync({ revoked: true, retainedRows });
  assert.equal(kept.pull, false);
  assert.equal(kept.retainedRows, retainedRows);
  assert.equal(kept.historyDeleted, false);
  const open = revokeSync({ revoked: false, retainedRows });
  assert.equal(open.pull, true);
  assert.equal(open.historyDeleted, false);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const base = { brandId, sourceName: ` ${sourceName} `, retainedRows };
  assert.equal(registerSyncAuthorizationSchema.safeParse({ ...base, accessToken: "secret" }).success, false);
  assert.equal(registerSyncAuthorizationSchema.safeParse({ ...base, sourceName: "desk token" }).success, false);
  assert.equal(registerSyncAuthorizationSchema.safeParse({ ...base, sourceName: "https://logs.example" }).success, false);
  assert.equal(registerSyncAuthorizationSchema.safeParse({ ...base, retainedRows: -1 }).success, false);
  assert.equal(registerSyncAuthorizationSchema.safeParse({ ...base, retainedRows: 1.5 }).success, false);
  assert.equal(registerSyncAuthorizationSchema.parse(base).sourceName, sourceName);
  assert.equal(registerSyncAuthorizationSchema.parse(base).retainedRows, retainedRows);
  assert.equal(safeReturnTo("/dashboard/settings/sync-authorizations"), "/dashboard/settings/sync-authorizations");
});

test("sync authorization copy states revocation without deleting history", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.syncAuthorizations.description, /撤销/);
  assert.match(zhCN.syncAuthorizations.description, /保留行数/);
  assert.match(zhCN.syncAuthorizations.description, /已停止/);
  assert.match(zhCN.syncAuthorizations.description, /不会删除/);
  assert.equal(zhCN.syncAuthorizations.resultAllowed, "允许");
  assert.equal(zhCN.syncAuthorizations.resultStopped, "已停止");
  assert.match(en.syncAuthorizations.description, /revocation/i);
  assert.match(en.syncAuthorizations.description, /retained/i);
  assert.match(en.syncAuthorizations.description, /stopped/i);
  assert.match(en.syncAuthorizations.description, /not deleted/i);
  assert.equal(en.syncAuthorizations.resultAllowed, "Allowed");
  assert.equal(en.syncAuthorizations.resultStopped, "Stopped");
  assert.equal(zhCN.settings.openSyncAuthorizations.length > 0, true);
  assert.equal(en.settings.openSyncAuthorizations.length > 0, true);
  const panel = await readFile(new URL("../../src/features/data-connections/revocation-panel.tsx", import.meta.url), "utf8");
  assert.equal(panel.includes("statusActive") && panel.includes("statusRevoked"), true);
  assert.equal(panel.includes("resultAllowed") && panel.includes("resultStopped"), true);
  const source = await readFile(new URL("../../src/features/data-connections/revocation-commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("revokeSync"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
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
      .filter((row) => row.tbl_name === "sync_authorization" || row.tbl_name === "sync_attempt")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "sync_authorization" || row.table_name === "sync_attempt")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
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

async function storedAuthorization(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT revoked, retained_rows AS "retainedRows", history_deleted AS "historyDeleted"
      FROM sync_authorization WHERE id = ?`,
    [id],
  );
  return row;
}

async function storedAttempts(db, id) {
  return queryWithParameters(
    db,
    `SELECT result FROM sync_attempt WHERE authorization_id = ? ORDER BY attempted_at ASC, id ASC`,
    [id],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: revocation stops the next pull and keeps retained rows`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /sync_authorization_owner_idx/);
        assert.match(defined, /sync_attempt_owner_idx/);
        assert.match(defined, /sync_authorization_state_check/);
        assert.match(defined, /sync_attempt_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /sync_attempt_authorization_fk/);
        else assert.match(defined, /FOREIGN KEY \(`authorization_id`\) REFERENCES `sync_authorization`/);
        const columns = storedColumns(migrated);
        for (const word of ["password", "token", "secret", "cookie", "host"]) {
          assert.equal(columns.includes(word), false, word);
        }

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);
        const created = await registerSyncAuthorization(db, owner, {
          brandId: brand,
          sourceName,
          retainedRows,
        }, clock);
        assert.equal(created.authorization.revoked, false);
        assert.equal(created.authorization.pull, true);
        assert.equal(created.authorization.historyDeleted, false);
        assert.equal(created.authorization.retainedRows, retainedRows);
        assert.equal(created.authorization.sourceName, sourceName);
        assert.deepEqual(created.authorization.attempts, []);

        const pullWatch = watch(db);
        const pulled = await pullSyncAuthorization(pullWatch.connection, owner, created.authorization.id, clock);
        assert.equal(pulled.authorization.pull, true);
        assert.equal(pulled.authorization.attempts.length, 1);
        assert.equal(pulled.authorization.attempts[0].result, "allowed");
        assert.equal(pulled.authorization.retainedRows, retainedRows);
        assert.equal(writes(pullWatch.captured).length, 1);
        assert.match(writes(pullWatch.captured)[0].sql, /insert into sync_attempt/i);
        assert.equal(/^\s*delete/i.test(writes(pullWatch.captured)[0].sql), false);

        const hidden = await pullSyncAuthorization(db, outsider, created.authorization.id, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(sourceName), false);
        assert.equal(JSON.stringify(hidden).includes(String(retainedRows)), false);
        const hiddenRevoke = await revokeSyncAuthorization(db, outsider, created.authorization.id, clock);
        assert.deepEqual(hiddenRevoke, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hiddenRevoke).includes(sourceName), false);
        assert.equal(JSON.stringify(hiddenRevoke).includes(String(retainedRows)), false);

        const revokeWatch = watch(db);
        const revoked = await revokeSyncAuthorization(revokeWatch.connection, owner, created.authorization.id, clock);
        assert.equal(revoked.authorization.revoked, true);
        assert.equal(revoked.authorization.pull, false);
        assert.equal(revoked.authorization.historyDeleted, false);
        assert.equal(revoked.authorization.retainedRows, retainedRows);
        assert.equal(revoked.authorization.attempts.length, 1);
        assert.equal(revoked.authorization.attempts[0].result, "allowed");
        assert.equal(writes(revokeWatch.captured).some((item) => /^\s*delete/i.test(item.sql)), false);
        assert.equal(writes(revokeWatch.captured).filter((item) => /update sync_authorization/i.test(item.sql)).length, 1);
        const again = await revokeSyncAuthorization(db, owner, created.authorization.id, clock);
        assert.equal(again.authorization.updatedAt, revoked.authorization.updatedAt);
        assert.equal(again.authorization.retainedRows, retainedRows);
        assert.equal(again.authorization.attempts.length, 1);

        const stoppedWatch = watch(db);
        const stopped = await pullSyncAuthorization(stoppedWatch.connection, owner, created.authorization.id, clock);
        assert.equal(stopped.authorization.pull, false);
        assert.equal(stopped.authorization.historyDeleted, false);
        assert.equal(stopped.authorization.retainedRows, retainedRows);
        assert.equal(stopped.authorization.attempts.some((attempt) => attempt.result === "stopped"), true);
        assert.equal(stopped.authorization.attempts.some((attempt) => attempt.result === "allowed"), true);
        assert.match(writes(stoppedWatch.captured)[0].sql, /insert into sync_attempt/i);
        assert.equal(writes(stoppedWatch.captured).some((item) => /update sync_authorization/i.test(item.sql)), false);
        const persisted = await storedAuthorization(db, created.authorization.id);
        assert.equal(persisted.revoked, 1);
        assert.equal(persisted.retainedRows, retainedRows);
        assert.equal(persisted.historyDeleted, 0);
        const attemptRows = await storedAttempts(db, created.authorization.id);
        assert.deepEqual(attemptRows.map((row) => row.result), ["allowed", "stopped"]);

        const hiddenWatch = watch(db);
        const hiddenList = await listSyncAuthorizations(hiddenWatch.connection, outsider);
        assert.equal(hiddenList.authorizations.some((row) => row.id === created.authorization.id), false);
        assert.equal(JSON.stringify(hiddenList).includes(sourceName), false);
        assert.equal(JSON.stringify(hiddenList).includes(String(retainedRows)), false);

        const listWatch = watch(db);
        const listed = await listSyncAuthorizations(listWatch.connection, owner);
        const authorizationSelects = listWatch.captured.filter((item) => isSelect(item.sql, "sync_authorization"));
        const attemptSelects = listWatch.captured.filter((item) => isSelect(item.sql, "sync_attempt"));
        assert.equal(authorizationSelects.length, 1);
        assert.equal(attemptSelects.length, 1);
        assert.match(attemptSelects[0].sql, /authorization_id IN/i);
        assert.equal(listed.authorizations.some((row) => row.id === created.authorization.id), true);
        const visible = listed.authorizations.find((row) => row.id === created.authorization.id);
        assert.equal(visible.retainedRows, retainedRows);
        assert.equal(visible.historyDeleted, false);
        assert.deepEqual(visible.attempts.map((attempt) => attempt.result).sort(), ["allowed", "stopped"]);
        assert.equal(listWatch.captured.flatMap((item) => item.values ?? []).includes(owner), true);

        const extra = Array.from({ length: 3000 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO sync_authorization (
            id, brand_id, owner_id, source_name, revoked, retained_rows, history_deleted, created_at, updated_at
          ) VALUES ${extra.map(() => "(?, ?, ?, 'noise', 0, 0, 0, ?, ?)").join(", ")}`,
          extra.flatMap((id) => [id, otherBrand, outsider, time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO sync_attempt (
            id, authorization_id, brand_id, owner_id, result, attempted_at
          ) VALUES ${extra.map(() => "(?, ?, ?, ?, 'allowed', ?)").join(", ")}`,
          extra.flatMap((id) => [randomUUID(), id, otherBrand, outsider, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE sync_authorization");
          await db.query("ANALYZE sync_attempt");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = syncAuthorizationsForOwnerQuery(owner);
        const attemptQuery = syncAttemptsForOwnerQuery(owner, [created.authorization.id]);
        const authorizationPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        const attemptPlan = JSON.stringify(await queryWithParameters(db, explain + attemptQuery.sql, attemptQuery.values));
        assert.match(authorizationPlan, /sync_authorization_owner_idx/);
        assert.match(attemptPlan, /sync_attempt_owner_idx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(authorizationPlan, /Seq Scan on sync_authorization/);
          assert.doesNotMatch(attemptPlan, /Seq Scan on sync_attempt/);
        }

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE sync_authorization SET history_deleted = 1 WHERE id = ?`, [created.authorization.id]),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE sync_attempt SET result = 'deleted' WHERE authorization_id = ?`,
            [created.authorization.id],
          ),
          /CHECK|check constraint/i,
        );
        const afterReject = await storedAuthorization(db, created.authorization.id);
        assert.equal(afterReject.historyDeleted, 0);
        assert.equal(afterReject.retainedRows, retainedRows);
        assert.deepEqual((await storedAttempts(db, created.authorization.id)).map((row) => row.result), ["allowed", "stopped"]);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
