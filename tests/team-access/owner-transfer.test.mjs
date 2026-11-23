import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { teamErrors } from "../../src/features/team-access/contracts.ts";
import {
  grantBrandMember,
  leaveTeam,
  promoteBrandMember,
  revokeBrandGrant,
} from "../../src/features/team-access/commands.ts";
import { ownerTransfersByBrandQuery } from "../../src/features/team-access/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T01:00:00.000Z";
const nameA = "品牌甲私密名称合成";
const nameB = "品牌乙私密名称合成";

function secrets(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(nameA), false);
  assert.equal(text.includes(nameB), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "负责人转移夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ name }), time]);
}

async function grantState(db, id) {
  const [row] = await queryWithParameters(db, `SELECT role, active, revoked_at AS "revokedAt"
    FROM brand_member_grant WHERE id = ?`, [id]);
  return row;
}

async function transferCount(db, brandId) {
  const [row] = await queryWithParameters(db, "SELECT count(*) AS n FROM brand_owner_transfer WHERE brand_id = ?", [brandId]);
  return Number(row.n);
}

async function activeOwners(db, brandId) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM brand_member_grant
    WHERE brand_id = ? AND role = 'owner' AND active = 1`, [brandId]);
  return Number(row.n);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: promoting an active member records the transfer and unlocks leave`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      assert.equal(teamErrors.NOT_FOUND, 404);
      assert.equal(teamErrors.CONFLICT, 409);
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const member = randomUUID();
      const successor = randomUUID();
      const former = randomUUID();
      const expired = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      for (const id of [ownerA, ownerB, member, successor, former, expired]) await addUser(db, id);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      const blockedLeave = await leaveTeam(db, ownerA, time);
      assert.equal(blockedLeave.allowed, false);
      assert.equal(blockedLeave.reason, "transfer_required");
      assert.equal(await transferCount(db, brandA), 0);
      assert.equal(await activeOwners(db, brandA), 0);

      const granted = await grantBrandMember(db, ownerA, { userId: member, brandId: brandA, role: "member", expiresAt: null }, time);
      assert.equal(granted.grant.role, "member");
      const ownerGrant = (await queryWithParameters(db, `SELECT id FROM brand_member_grant
        WHERE user_id = ? AND brand_id = ? AND role = 'owner'`, [ownerA, brandA]))[0];
      const stillLast = await leaveTeam(db, ownerA, time);
      assert.equal(stillLast.allowed, false);
      assert.equal(Number((await grantState(db, ownerGrant.id)).active), 1);
      assert.equal((await revokeBrandGrant(db, ownerA, ownerGrant.id, time)).error, "CONFLICT");
      assert.equal(Number((await grantState(db, ownerGrant.id)).active), 1);
      assert.equal((await grantState(db, ownerGrant.id)).revokedAt, null);

      const missing = await promoteBrandMember(db, ownerA, randomUUID(), time);
      assert.equal(missing.error, "NOT_FOUND");
      secrets(missing);
      assert.equal(await transferCount(db, brandA), 0);

      const otherBrand = await grantBrandMember(db, ownerB, { userId: successor, brandId: brandB, role: "member", expiresAt: null }, time);
      const foreign = await promoteBrandMember(db, ownerA, otherBrand.grant.id, time);
      assert.equal(foreign.error, "NOT_FOUND");
      assert.equal(secrets(foreign).includes(brandB), false);
      assert.equal((await grantState(db, otherBrand.grant.id)).role, "member");
      assert.equal(await transferCount(db, brandA) + await transferCount(db, brandB), 0);

      const revoked = await grantBrandMember(db, ownerA, { userId: former, brandId: brandA, role: "member", expiresAt: null }, time);
      assert.equal((await revokeBrandGrant(db, ownerA, revoked.grant.id, time)).grant.active, 0);
      const revive = await promoteBrandMember(db, ownerA, revoked.grant.id, time);
      assert.equal(revive.error, "NOT_FOUND");
      assert.equal((await grantState(db, revoked.grant.id)).role, "member");
      assert.equal(Number((await grantState(db, revoked.grant.id)).active), 0);
      assert.equal(await transferCount(db, brandA), 0);

      const expiredGrant = randomUUID();
      await queryWithParameters(db, `INSERT INTO brand_member_grant
        (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
        VALUES (?, ?, ?, 'member', 1, ?, ?, NULL)`, [expiredGrant, expired, brandA, time, time]);
      assert.equal((await promoteBrandMember(db, ownerA, expiredGrant, time)).error, "NOT_FOUND");
      assert.equal((await grantState(db, expiredGrant)).role, "member");
      assert.equal(await transferCount(db, brandA), 0);

      const captured = [];
      const observed = {
        kind: db.kind,
        async transaction(work) {
          return db.transaction(async (tx) => work({
            kind: tx.kind,
            query(sql, values) {
              captured.push(sql);
              return tx.query(sql, values);
            },
          }));
        },
        query(sql, values) {
          captured.push(sql);
          return db.query(sql, values);
        },
      };
      const promoted = await promoteBrandMember(observed, ownerA, granted.grant.id, time);
      assert.equal(promoted.grant.role, "owner");
      assert.equal(promoted.grant.active, 1);
      assert.equal(promoted.transfer.brandId, brandA);
      assert.equal(promoted.transfer.fromUserId, ownerA);
      assert.equal(promoted.transfer.toUserId, member);
      assert.equal(promoted.transfer.actorId, ownerA);
      assert.equal(promoted.transfer.createdAt, time);
      secrets(promoted);
      assert.equal(captured.length, 7);
      assert.equal(captured.filter((sql) => sql.includes("INSERT INTO brand_owner_transfer")).length, 1);
      const [stored] = await queryWithParameters(db, `SELECT brand_id AS "brandId", from_user_id AS "fromUserId",
        to_user_id AS "toUserId", actor_id AS "actorId", created_at AS "createdAt"
        FROM brand_owner_transfer WHERE id = ?`, [promoted.transfer.id]);
      assert.equal(stored.brandId, brandA);
      assert.equal(stored.fromUserId, ownerA);
      assert.equal(stored.toUserId, member);
      assert.equal(stored.actorId, ownerA);
      assert.equal(stored.createdAt, time);
      assert.equal((await grantState(db, granted.grant.id)).role, "owner");
      assert.equal(await transferCount(db, brandA), 1);

      const again = await promoteBrandMember(db, ownerA, granted.grant.id, time);
      assert.equal(again.error, "NOT_FOUND");
      assert.equal(await transferCount(db, brandA), 1);

      const left = await leaveTeam(db, ownerA, time);
      assert.equal(left.allowed, true);
      assert.equal(left.reason, "ok");
      assert.equal(Number((await grantState(db, ownerGrant.id)).active), 0);
      assert.equal(await activeOwners(db, brandA), 1);
      assert.equal(Number((await grantState(db, granted.grant.id)).active), 1);

      const lastLeave = await leaveTeam(db, member, time);
      assert.equal(lastLeave.allowed, false);
      assert.equal(lastLeave.reason, "transfer_required");
      assert.equal(Number((await grantState(db, granted.grant.id)).active), 1);
      assert.equal((await revokeBrandGrant(db, member, granted.grant.id, time)).error, "CONFLICT");
      assert.equal(Number((await grantState(db, granted.grant.id)).active), 1);
      assert.equal((await grantState(db, granted.grant.id)).revokedAt, null);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO brand_owner_transfer
          (id, brand_id, from_user_id, to_user_id, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`, [randomUUID(), brandA, ownerA, ownerA, ownerA, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO brand_owner_transfer
          (id, brand_id, from_user_id, to_user_id, actor_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`, [randomUUID(), brandA, ownerA, member, ownerA, time]);
      }
      if (db.kind === "postgresql") await db.query("ANALYZE brand_owner_transfer");
      const listQuery = ownerTransfersByBrandQuery(brandA);
      const plan = db.kind === "postgresql"
        ? await db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${listQuery.sql}`, listQuery.values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${listQuery.sql}`, listQuery.values));
      assert.match(plan, /brand_owner_transfer_brand_idx/);
      if (db.kind === "postgresql") assert.doesNotMatch(plan, /Seq Scan on brand_owner_transfer/);
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /brand_owner_transfer/);
      assert.match(defined, /brand_owner_transfer_brand_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
