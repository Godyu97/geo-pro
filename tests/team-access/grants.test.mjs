import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { grantInputSchema, teamErrors } from "../../src/features/team-access/contracts.ts";
import {
  executeQueuedBrandAction,
  exportGrantedBrands,
  grantBrandMember,
  leaveTeam,
  listTeamGrants,
  loadOwnedLabels,
  readGrantedBrand,
  revokeBrandGrant,
} from "../../src/features/team-access/commands.ts";
import { membersByBrandQuery, validGrantQuery } from "../../src/features/team-access/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const nameA = "品牌甲私密名称合成";
const nameB = "品牌乙私密名称合成";
const factB = "品牌乙事实合成不可泄露";
const evidenceB = "品牌乙证据合成不可泄露";

test("grant input rejects a private brand name and unknown fields", () => {
  assert.equal(teamErrors.FORBIDDEN, 403);
  assert.equal(teamErrors.CONFLICT, 409);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  assert.equal(grantInputSchema.safeParse({
    userId: randomUUID(), brandId, role: "member", expiresAt: null, name: nameB,
  }).success, false);
  assert.equal(grantInputSchema.safeParse({
    userId: randomUUID(), brandId, role: "member", expiresAt: "2026-12-31T00:00:00.000Z",
  }).success, true);
});

function secrets(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(nameA), false);
  assert.equal(text.includes(nameB), false);
  assert.equal(text.includes(factB), false);
  assert.equal(text.includes(evidenceB), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "团队授权夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ fact: factB, evidence: evidenceB, name }), time]);
}

async function grantRow(db, id) {
  const [row] = await queryWithParameters(db, `SELECT user_id AS "userId", role, active, revoked_at AS "revokedAt"
    FROM brand_member_grant WHERE id = ?`, [id]);
  return row;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: brand grants block cross-brand export and stop revoked downloads`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const member = randomUUID();
      const successor = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addUser(db, member);
      await addUser(db, successor);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      const ownRead = await readGrantedBrand(db, ownerA, brandA, time);
      assert.deepEqual(ownRead, { brandId: brandA, visible: true });
      assert.deepEqual(await loadOwnedLabels(db, [brandA]), [{ brandId: brandA, name: nameA }]);
      const [beforeGrants] = await queryWithParameters(db, "SELECT count(*) AS n FROM brand_member_grant", []);
      assert.equal(Number(beforeGrants.n), 0);
      const blockedLeave = await leaveTeam(db, ownerA, time);
      assert.equal(blockedLeave.allowed, false);
      assert.equal(blockedLeave.reason, "transfer_required");
      assert.equal(Number((await queryWithParameters(db, "SELECT count(*) AS n FROM brand_member_grant", []))[0].n), 0);
      assert.deepEqual(await readGrantedBrand(db, ownerA, brandA, time), { brandId: brandA, visible: true });

      const ownerExport = await exportGrantedBrands(db, ownerA, [brandA, brandB], time);
      assert.deepEqual(ownerExport, { allowed: false, rows: [] });
      assert.equal(secrets(ownerExport).includes(brandB), false);

      const granted = await grantBrandMember(db, ownerA, { userId: member, brandId: brandA, role: "member", expiresAt: null }, time);
      assert.equal(granted.grant.role, "member");
      assert.equal(granted.grant.active, 1);
      assert.equal(granted.action.status, "queued");
      assert.equal(granted.invite.exposesPrivateBrandName, false);
      secrets(granted);
      const ownerGrant = (await queryWithParameters(db, `SELECT id, active FROM brand_member_grant
        WHERE user_id = ? AND brand_id = ? AND role = 'owner'`, [ownerA, brandA]))[0];
      assert.equal(Number(ownerGrant.active), 1);

      assert.deepEqual(await readGrantedBrand(db, member, brandB, time), { error: "FORBIDDEN" });
      secrets(await readGrantedBrand(db, member, brandB, time));
      const memberRead = await readGrantedBrand(db, member, brandA, time);
      assert.deepEqual(memberRead, { brandId: brandA, visible: true });
      secrets(memberRead);
      const mixed = await exportGrantedBrands(db, member, [brandA, brandB], time);
      assert.deepEqual(mixed, { allowed: false, rows: [] });
      assert.equal(secrets(mixed).includes(brandB), false);
      const allowed = await exportGrantedBrands(db, member, [brandA], time);
      assert.deepEqual(allowed, { allowed: true, rows: [brandA] });
      secrets(allowed);
      assert.deepEqual(await loadOwnedLabels(db, []), []);
      assert.equal((await grantBrandMember(db, member, { userId: successor, brandId: brandB, role: "member" }, time)).error, "FORBIDDEN");

      const captured = [];
      const observed = { kind: db.kind, query(sql, values) { captured.push(sql); return db.query(sql, values); } };
      const listed = await listTeamGrants(observed, member, time);
      assert.equal(listed.invite.exposesPrivateBrandName, false);
      assert.equal(listed.accessibleBrandIds.includes(brandB), false);
      assert.deepEqual(listed.ownerBrandIds, []);
      secrets(listed);
      assert.equal(captured.filter((sql) => sql.includes("UNION ALL")).length, 1);
      assert.equal(captured.some((sql) => sql.includes("brand_version")), false);

      const downloaded = await executeQueuedBrandAction(db, member, granted.action.id, time);
      const [storedBefore] = await queryWithParameters(db, "SELECT attachment, status FROM queued_brand_action WHERE id = ?", [granted.action.id]);
      assert.equal(downloaded.action.download, storedBefore.attachment);
      assert.equal(downloaded.action.status, "queued");
      const revoked = await revokeBrandGrant(db, ownerA, granted.grant.id, time);
      assert.equal(revoked.grant.active, 0);
      secrets(revoked);
      const stopped = await executeQueuedBrandAction(db, member, granted.action.id, time);
      assert.deepEqual(stopped.action, { id: granted.action.id, status: "stopped", download: "" });
      const again = await executeQueuedBrandAction(db, member, granted.action.id, time);
      assert.equal(again.action.download, "");
      const [stored] = await queryWithParameters(db, "SELECT attachment, status FROM queued_brand_action WHERE id = ?", [granted.action.id]);
      assert.equal(stored.status, "stopped");
      assert.equal(stored.attachment, storedBefore.attachment);
      assert.equal(JSON.stringify(stopped).includes(stored.attachment), false);
      assert.equal(Number((await queryWithParameters(db, "SELECT count(*) AS n FROM queued_brand_action WHERE id = ?", [granted.action.id]))[0].n), 1);

      const stillOwner = await leaveTeam(db, ownerA, time);
      assert.equal(stillOwner.allowed, false);
      assert.equal(Number((await grantRow(db, ownerGrant.id)).active), 1);
      assert.equal((await grantRow(db, ownerGrant.id)).revokedAt, null);

      const transferred = await grantBrandMember(db, ownerA, { userId: successor, brandId: brandA, role: "owner" }, time);
      assert.equal(transferred.grant.role, "owner");
      assert.equal(transferred.action, null);
      const left = await leaveTeam(db, ownerA, time);
      assert.equal(left.allowed, true);
      assert.equal(Number((await grantRow(db, ownerGrant.id)).active), 0);
      const [brandOwner] = await queryWithParameters(db, 'SELECT owner_id AS "ownerId" FROM brand WHERE id = ?', [brandA]);
      assert.equal(brandOwner.ownerId, ownerA);
      assert.deepEqual(await readGrantedBrand(db, ownerA, brandA, time), { error: "FORBIDDEN" });
      assert.deepEqual(await readGrantedBrand(db, successor, brandA, time), { brandId: brandA, visible: true });

      const outsider = randomUUID();
      await addUser(db, outsider);
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO brand_member_grant
          (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
          VALUES (?, ?, ?, 'admin', 1, NULL, ?, NULL)`, [randomUUID(), outsider, brandA, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        const userId = randomUUID();
        const active = index % 2 === 0 ? 1 : 0;
        await addUser(db, userId);
        await queryWithParameters(db, `INSERT INTO brand_member_grant
          (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
          VALUES (?, ?, ?, 'member', ?, NULL, ?, ?)`, [
          randomUUID(), userId, brandA, active, time, active === 1 ? null : time,
        ]);
      }
      if (db.kind === "postgresql") await db.query("ANALYZE brand_member_grant");
      const listQuery = validGrantQuery(member, time);
      const memberQuery = membersByBrandQuery([brandA]);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const accessPlan = await planFor(listQuery.sql, listQuery.values);
      const memberPlan = await planFor(memberQuery.sql, memberQuery.values);
      assert.match(accessPlan, /brand_member_grant_user_idx|brand_member_grant_pair_uidx/);
      assert.match(memberPlan, /brand_member_grant_brand_idx/);
      if (db.kind === "postgresql") {
        assert.doesNotMatch(accessPlan, /Seq Scan on brand_member_grant/);
        assert.doesNotMatch(memberPlan, /Seq Scan on brand_member_grant/);
      }
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /brand_member_grant_user_idx/);
      assert.match(defined, /brand_member_grant_brand_idx/);
      assert.match(defined, /queued_brand_action_grant_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
