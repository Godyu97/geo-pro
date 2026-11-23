import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { delegationErrors, registerDelegationSchema, registerMembershipSchema } from "../../src/features/commercial/contracts.ts";
import {
  executeDelegationAction,
  expireBrandDelegation,
  listDelegationWorkspace,
  portfolioForUser,
  readDelegatedBrand,
  registerAgencyMember,
  registerBrandDelegation,
} from "../../src/features/commercial/commands.ts";
import { delegationAccessQuery } from "../../src/features/commercial/dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T04:00:00.000Z";
const later = "2026-12-31T00:00:00.000Z";
const past = "2026-11-01T00:00:00.000Z";
const evidenceA = "evidence-alpha01";
const evidenceB = "evidence-beta0002";
const evidencePast = "evidence-past0001";
const nameA = "品牌甲委托名称合成";
const nameB = "品牌乙委托名称合成";
const factA = "品牌甲事实合成不可泄露";

test("delegation input rejects private names and keeps the return path", () => {
  assert.equal(delegationErrors.NOT_FOUND, 404);
  assert.equal(delegationErrors.FORBIDDEN, 403);
  assert.equal(safeReturnTo("/dashboard/settings/delegations"), "/dashboard/settings/delegations");
  const brandId = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  assert.equal(registerMembershipSchema.safeParse({ organizationId, userId, name: nameA }).success, false);
  assert.equal(registerMembershipSchema.safeParse({ organizationId, userId }).success, true);
  assert.equal(registerDelegationSchema.safeParse({
    brandId, organizationId, expiresAt: later, scope: evidenceA, name: nameA,
  }).success, false);
  assert.equal(registerDelegationSchema.safeParse({
    brandId, organizationId, expiresAt: later, scope: "Evidence-Alpha01",
  }).success, false);
  assert.equal(registerDelegationSchema.safeParse({
    brandId, organizationId, expiresAt: later, scope: evidenceA,
  }).success, true);
  const query = delegationAccessQuery(userId);
  assert.deepEqual(query.values, [userId, 200]);
  assert.equal(query.sql.includes("brand_member_grant"), false);
  assert.equal(query.sql.includes("brand_id = ?"), false);
  assert.equal(query.sql.includes("agency_membership"), true);
  assert.equal(query.sql.includes("brand_delegation"), true);
});

function hidden(value, forbidden) {
  const text = JSON.stringify(value);
  for (const secret of forbidden) assert.equal(text.includes(secret), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "委托夹具", `${id}@example.invalid`]);
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
  test(`${kind}: an expired delegation blocks a live agency member and hides evidence`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const ownerC = randomUUID();
      const member = randomUUID();
      const otherUser = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const brandC = randomUUID();
      const orgA = randomUUID();
      const orgB = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addUser(db, ownerC);
      await addUser(db, member);
      await addUser(db, otherUser);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);
      await addBrand(db, ownerC, brandC, "品牌丙委托名称合成");

      const foundedByOther = await registerAgencyMember(db, ownerA, { organizationId: orgA, userId: member }, time);
      assert.equal(foundedByOther.error, "FORBIDDEN");
      assert.equal(await countOf(db, "agency_membership"), 0);
      const membership = await registerAgencyMember(db, member, { organizationId: orgA, userId: member }, time);
      assert.equal(membership.membership.active, 1);
      assert.equal(await countOf(db, "brand_delegation"), 0);
      const otherMembership = await registerAgencyMember(db, otherUser, { organizationId: orgB, userId: otherUser }, time);
      assert.equal(otherMembership.membership.organizationId, orgB);

      const tooEarly = await registerBrandDelegation(db, ownerA, {
        brandId: brandA, organizationId: orgA, expiresAt: past, scope: evidenceA,
      }, time);
      assert.equal(tooEarly.error, "INVALID_INPUT");
      assert.equal(await countOf(db, "brand_delegation"), 0);
      const created = await registerBrandDelegation(db, ownerA, {
        brandId: brandA, organizationId: orgA, expiresAt: later, scope: evidenceA,
      }, time);
      assert.equal(created.delegation.active, 1);
      assert.equal(created.action.status, "queued");
      const otherDelegation = await registerBrandDelegation(db, ownerB, {
        brandId: brandB, organizationId: orgB, expiresAt: later, scope: evidenceB,
      }, time);
      assert.equal(otherDelegation.action.status, "queued");
      assert.equal(await countOf(db, "agency_membership"), 2);
      assert.equal(await countOf(db, "brand_delegation"), 2);
      assert.equal(await countOf(db, "brand_member_grant"), 0);
      const [brandOwner] = await queryWithParameters(db, 'SELECT owner_id AS "ownerId" FROM brand WHERE id = ?', [brandA]);
      assert.equal(brandOwner.ownerId, ownerA);
      assert.notEqual(brandOwner.ownerId, orgA);

      const ownerRead = await readDelegatedBrand(db, ownerA, brandA, time);
      assert.equal(ownerRead.error, "NOT_FOUND");
      hidden(ownerRead, [evidenceA, evidenceB, nameA, factA]);
      const visible = await readDelegatedBrand(db, member, brandA, time);
      assert.deepEqual(visible, { brandId: brandA, summary: "visible", evidenceIds: [evidenceA], reason: "ok" });
      hidden(visible, [evidenceB, nameA, nameB, factA]);
      const portfolio = await portfolioForUser(db, member, time);
      assert.deepEqual(portfolio.rows, [{
        delegationId: created.delegation.id, brandId: brandA, summary: "visible", evidenceIds: [evidenceA],
      }]);
      hidden(portfolio, [evidenceB, nameA, nameB, factA]);
      const crossed = await readDelegatedBrand(db, otherUser, brandA, time);
      assert.equal(crossed.error, "NOT_FOUND");
      hidden(crossed, [evidenceA, evidenceB, nameA, nameB]);
      const otherPortfolio = await portfolioForUser(db, otherUser, time);
      assert.equal(otherPortfolio.rows.some((row) => row.brandId === brandA), false);
      hidden(otherPortfolio, [evidenceA, nameA, nameB, factA]);

      const watched = watch(db);
      const workspace = await listDelegationWorkspace(watched.connection, member, time);
      assert.equal(watched.sqls.length, 3);
      assert.equal(watched.sqls.some((sql) => sql.includes("brand_member_grant") || sql.includes("brand_id = ?")), false);
      assert.deepEqual(workspace.portfolio[0].evidenceIds, [evidenceA]);
      hidden(workspace, [evidenceB, nameA, nameB, factA]);
      const ownerWorkspace = await listDelegationWorkspace(db, ownerA, time);
      assert.equal(ownerWorkspace.managed.length, 1);
      assert.equal(ownerWorkspace.portfolio.length, 0);
      assert.equal(ownerWorkspace.brands[0].name, nameA);
      hidden(ownerWorkspace, [evidenceA, evidenceB]);

      const ran = await executeDelegationAction(db, member, created.action.id, time);
      assert.equal(ran.action.status, "queued");
      assert.equal(ran.reason, "ok");
      assert.deepEqual(ran.evidenceIds, [evidenceA]);
      hidden(ran, [evidenceB, nameA, nameB, factA]);
      const [queued] = await queryWithParameters(db, "SELECT status FROM delegation_action WHERE id = ?", [created.action.id]);
      assert.equal(queued.status, "queued");
      const memberExpire = await expireBrandDelegation(db, member, created.delegation.id, time);
      assert.equal(memberExpire.error, "NOT_FOUND");
      assert.equal((await queryWithParameters(db, "SELECT status FROM delegation_action WHERE id = ?", [created.action.id]))[0].status, "queued");
      const duplicate = await registerBrandDelegation(db, ownerA, {
        brandId: brandA, organizationId: orgA, expiresAt: later, scope: evidenceA,
      }, time);
      assert.equal(duplicate.error, "CONFLICT");
      assert.equal(await countOf(db, "brand_delegation"), 2);

      const expired = await expireBrandDelegation(db, ownerA, created.delegation.id, time);
      assert.equal(expired.delegation.active, 0);
      hidden(expired, [evidenceA, evidenceB, nameA, nameB]);
      assert.equal(await countOf(db, "brand_delegation"), 2);
      const [kept] = await queryWithParameters(db, `SELECT active, expired_at AS "expiredAt" FROM brand_delegation WHERE id = ?`, [created.delegation.id]);
      assert.equal(Number(kept.active), 0);
      assert.equal(kept.expiredAt, time);
      const [stoppedRow] = await queryWithParameters(db, "SELECT status FROM delegation_action WHERE id = ?", [created.action.id]);
      assert.equal(stoppedRow.status, "stopped");

      const denied = await readDelegatedBrand(db, member, brandA, time);
      assert.deepEqual(denied, { error: "FORBIDDEN", reason: "grant" });
      hidden(denied, [evidenceA, evidenceB, nameA, nameB, factA]);
      const blocked = await portfolioForUser(db, member, time);
      assert.deepEqual(blocked.rows, [{
        delegationId: created.delegation.id, brandId: brandA, summary: "blocked", evidenceIds: [],
      }]);
      hidden(blocked, [evidenceA, evidenceB, nameA, nameB, factA]);
      const stopped = await executeDelegationAction(db, member, created.action.id, time);
      assert.equal(stopped.action.status, "stopped");
      assert.equal(stopped.reason, "grant");
      assert.equal("evidenceIds" in stopped, false);
      hidden(stopped, [evidenceA, evidenceB, nameA, nameB, factA]);
      const outsider = await executeDelegationAction(db, otherUser, created.action.id, time);
      assert.equal(outsider.error, "NOT_FOUND");
      hidden(outsider, [evidenceA, evidenceB, nameA, nameB]);

      const pastDelegation = randomUUID();
      const pastAction = randomUUID();
      await queryWithParameters(db, `INSERT INTO brand_delegation
        (id, brand_id, organization_id, active, expires_at, scope, created_at, expired_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, NULL)`, [pastDelegation, brandC, orgA, past, evidencePast, time]);
      await queryWithParameters(db, `INSERT INTO delegation_action (id, delegation_id, status, created_at)
        VALUES (?, ?, 'queued', ?)`, [pastAction, pastDelegation, time]);
      const pastRead = await readDelegatedBrand(db, member, brandC, time);
      assert.deepEqual(pastRead, { error: "FORBIDDEN", reason: "grant" });
      hidden(pastRead, [evidencePast, evidenceA, evidenceB]);
      const pastRun = await executeDelegationAction(db, member, pastAction, time);
      assert.equal(pastRun.action.status, "stopped");
      assert.equal(pastRun.reason, "grant");
      hidden(pastRun, [evidencePast, evidenceA, evidenceB]);
      assert.equal((await queryWithParameters(db, "SELECT status FROM delegation_action WHERE id = ?", [pastAction]))[0].status, "stopped");
      const pastPortfolio = await portfolioForUser(db, member, time);
      const pastRow = pastPortfolio.rows.find((row) => row.brandId === brandC);
      assert.equal(pastRow.summary, "blocked");
      assert.deepEqual(pastRow.evidenceIds, []);
      hidden(pastPortfolio, [evidencePast, evidenceA, evidenceB, nameA, nameB]);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO delegation_action (id, delegation_id, status, created_at)
          VALUES (?, ?, 'done', ?)`, [randomUUID(), created.delegation.id, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO agency_membership (id, organization_id, user_id, active, created_at)
          VALUES (?, ?, ?, 1, ?)`, [randomUUID(), randomUUID(), member, time]);
      }
      if (db.kind === "postgresql") {
        await db.query("ANALYZE agency_membership");
        await db.query("ANALYZE brand_delegation");
        await db.query("ANALYZE delegation_action");
      }
      const accessQuery = delegationAccessQuery(member);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const accessPlan = await planFor(accessQuery.sql, accessQuery.values);
      assert.match(accessPlan, /agency_membership_user_idx/);
      assert.match(accessPlan, /brand_delegation_org_idx/);
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /agency_membership_user_idx/);
      assert.match(defined, /brand_delegation_org_idx/);
      assert.match(defined, /delegation_action_delegation_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
