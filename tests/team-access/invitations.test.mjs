import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { teamErrors, teamInviteLabelKey } from "../../src/features/team-access/contracts.ts";
import {
  acceptTeamInvitation,
  createTeamInvitation,
  listTeamInvitations,
  resendTeamInvitation,
} from "../../src/features/team-access/commands.ts";
import {
  invitationByTokenHashQuery,
  invitationsForBrandQuery,
  invitationsForInviteeQuery,
} from "../../src/features/team-access/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T02:00:00.000Z";
const expiresAt = "2026-11-25T02:00:00.000Z";
const nameA = "品牌甲私密名称合成";
const nameB = "品牌乙私密名称合成";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function secrets(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(nameA), false);
  assert.equal(text.includes(nameB), false);
  assert.equal(text.includes("\"name\""), false);
  return text;
}

function assertMailSourceUntouched() {
  for (const relative of [
    "../../src/features/team-access/commands.ts",
    "../../src/features/team-access/dao.ts",
    "../../src/features/team-access/api.ts",
    "../../src/features/team-access/rules.ts",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.equal(source.includes("deliverAccountMail"), false);
    assert.equal(source.includes("account/email"), false);
    assert.equal(source.includes("import("), false);
  }
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "邀请夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ name }), time]);
}

async function grantsFor(db, userId, brandId) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM brand_member_grant
    WHERE user_id = ? AND brand_id = ?`, [userId, brandId]);
  return Number(row.n);
}

async function invitation(db, id) {
  const [row] = await queryWithParameters(db, `SELECT role, status, token_hash AS "tokenHash",
    expires_at AS "expiresAt", replaced_by AS "replacedBy"
    FROM team_invitation WHERE id = ?`, [id]);
  return row;
}

async function explain(db, query) {
  if (db.kind === "postgresql") {
    return db.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${query.sql}`, query.values));
    });
  }
  return JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${query.sql}`, query.values));
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: invitations hide brand names, expire, and resend without sending mail`, async () => {
    assertMailSourceUntouched();
    const mailSignals = [];
    const originalInfo = console.info;
    const originalError = console.error;
    const originalFetch = globalThis.fetch;
    console.info = (...args) => {
      const text = args.map((item) => String(item)).join(" ");
      if (text.includes("account-mail") || text.includes("deliverAccountMail")) mailSignals.push(text);
      originalInfo(...args);
    };
    console.error = (...args) => {
      const text = args.map((item) => String(item)).join(" ");
      if (text.includes("account-mail") || text.includes("deliverAccountMail")) mailSignals.push(text);
      originalError(...args);
    };
    globalThis.fetch = async (...args) => {
      mailSignals.push("fetch");
      return originalFetch(...args);
    };
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      assert.equal(teamErrors.NOT_FOUND, 404);
      assert.equal(teamErrors.INVITE_EXPIRED, 409);
      assert.equal(teamInviteLabelKey, "inviteMember");
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const invitee = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      for (const id of [ownerA, ownerB, invitee]) await addUser(db, id);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      await queryWithParameters(db, "UPDATE brand SET frozen_at = ? WHERE id = ?", [time, brandA]);
      assert.equal((await createTeamInvitation(db, ownerA, { userId: invitee, brandId: brandA, expiresAt }, time)).error, "NOT_FOUND");
      await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL WHERE id = ?", [brandA]);
      assert.equal(await grantsFor(db, invitee, brandA), 0);

      assert.equal((await createTeamInvitation(db, ownerA, { userId: ownerA, brandId: brandA, expiresAt }, time)).error, "INVALID_INPUT");
      assert.equal((await createTeamInvitation(db, ownerA, { userId: invitee, brandId: brandA, expiresAt: time }, time)).error, "INVALID_INPUT");
      assert.equal((await createTeamInvitation(db, ownerA, { userId: randomUUID(), brandId: brandA, expiresAt }, time)).error, "NOT_FOUND");
      const forbidden = await createTeamInvitation(db, ownerB, { userId: invitee, brandId: brandA, expiresAt }, time);
      assert.equal(forbidden.error, "FORBIDDEN");
      secrets(forbidden);
      assert.equal(await grantsFor(db, invitee, brandA), 0);

      const created = await createTeamInvitation(db, ownerA, { userId: invitee, brandId: brandA, expiresAt }, time);
      assert.equal(created.invitation.brandId, brandA);
      assert.equal(created.invitation.inviteeUserId, invitee);
      assert.equal(created.invitation.role, "member");
      assert.equal(created.invitation.status, "open");
      assert.equal(created.invitation.expiresAt, expiresAt);
      assert.equal(created.invitation.labelKey, "inviteMember");
      assert.equal(created.invitation.canResend, true);
      assert.equal(created.invitation.canAccept, false);
      assert.equal(created.token.length, 43);
      secrets(created);
      const stored = await invitation(db, created.invitation.id);
      assert.equal(stored.role, "member");
      assert.equal(stored.status, "open");
      assert.equal(stored.tokenHash, hash(created.token));
      assert.equal(stored.tokenHash === created.token, false);
      assert.equal(JSON.stringify(stored).includes(created.token), false);
      assert.equal(JSON.stringify(stored).includes(nameA), false);
      assert.equal(await grantsFor(db, invitee, brandA), 0);
      const [ownerGrant] = await queryWithParameters(db, `SELECT role, active FROM brand_member_grant
        WHERE user_id = ? AND brand_id = ?`, [ownerA, brandA]);
      assert.equal(ownerGrant.role, "owner");
      assert.equal(Number(ownerGrant.active), 1);
      const [actionsBefore] = await queryWithParameters(db, "SELECT count(*) AS n FROM queued_brand_action", []);

      const ownerList = await listTeamInvitations(db, ownerA, time);
      const inviteeList = await listTeamInvitations(db, invitee, time);
      const strangerList = await listTeamInvitations(db, ownerB, time);
      assert.equal(ownerList.invitations.some((row) => row.id === created.invitation.id && row.labelKey === "inviteMember"), true);
      assert.equal(inviteeList.invitations.some((row) => row.id === created.invitation.id && row.canAccept), true);
      assert.equal(strangerList.invitations.some((row) => row.id === created.invitation.id || row.brandId === brandA), false);
      for (const list of [ownerList, inviteeList, strangerList]) {
        secrets(list);
        assert.equal(JSON.stringify(list).includes(created.token), false);
        assert.equal(JSON.stringify(list).includes("tokenHash"), false);
      }
      assert.equal(invitationsForInviteeQuery(invitee).sql.includes("brand_version"), false);
      assert.equal(invitationsForBrandQuery(brandA).sql.includes("brand_version"), false);
      assert.equal(invitationByTokenHashQuery(stored.tokenHash).sql.includes("brand_version"), false);

      assert.equal((await resendTeamInvitation(db, invitee, created.invitation.id, {}, time)).error, "NOT_FOUND");
      assert.equal((await invitation(db, created.invitation.id)).status, "open");
      assert.equal((await acceptTeamInvitation(db, ownerB, created.invitation.id, created.token, time)).error, "NOT_FOUND");
      assert.equal((await acceptTeamInvitation(db, invitee, created.invitation.id, "a".repeat(43), time)).error, "NOT_FOUND");
      assert.equal(await grantsFor(db, invitee, brandA), 0);
      assert.equal((await invitation(db, created.invitation.id)).status, "open");

      const expired = await acceptTeamInvitation(db, invitee, created.invitation.id, created.token, expiresAt);
      assert.equal(expired.error, "INVITE_EXPIRED");
      secrets(expired);
      assert.equal((await invitation(db, created.invitation.id)).status, "expired");
      assert.equal(await grantsFor(db, invitee, brandA), 0);

      const resent = await resendTeamInvitation(db, ownerA, created.invitation.id, {}, expiresAt);
      assert.equal(resent.invitation.status, "open");
      assert.equal(resent.invitation.labelKey, "inviteMember");
      assert.equal(resent.invitation.expiresAt > expiresAt, true);
      assert.notEqual(resent.token, created.token);
      secrets(resent);
      const oldRow = await invitation(db, created.invitation.id);
      const newRow = await invitation(db, resent.invitation.id);
      assert.equal(oldRow.status, "expired");
      assert.equal(oldRow.replacedBy, resent.invitation.id);
      assert.equal(oldRow.tokenHash, hash(created.token));
      assert.equal(newRow.tokenHash, hash(resent.token));
      assert.notEqual(oldRow.tokenHash, newRow.tokenHash);
      assert.equal(JSON.stringify(newRow).includes(resent.token), false);
      assert.equal((await acceptTeamInvitation(db, invitee, created.invitation.id, created.token, expiresAt)).error, "INVITE_EXPIRED");
      assert.equal((await acceptTeamInvitation(db, invitee, created.invitation.id, resent.token, expiresAt)).error, "NOT_FOUND");
      assert.equal(await grantsFor(db, invitee, brandA), 0);

      const accepted = await acceptTeamInvitation(db, invitee, resent.invitation.id, resent.token, expiresAt);
      assert.equal(accepted.grant.role, "member");
      assert.equal(accepted.grant.active, 1);
      assert.equal(accepted.grant.userId, invitee);
      assert.equal(accepted.grant.brandId, brandA);
      assert.equal(accepted.invitation.status, "accepted");
      secrets(accepted);
      assert.equal(JSON.stringify(accepted).includes(resent.token), false);
      assert.equal(await grantsFor(db, invitee, brandA), 1);
      const [grant] = await queryWithParameters(db, `SELECT role, active FROM brand_member_grant
        WHERE user_id = ? AND brand_id = ?`, [invitee, brandA]);
      assert.equal(grant.role, "member");
      assert.equal(Number(grant.active), 1);
      assert.equal((await acceptTeamInvitation(db, invitee, resent.invitation.id, resent.token, expiresAt)).error, "CONFLICT");
      assert.equal(await grantsFor(db, invitee, brandA), 1);
      assert.equal((await resendTeamInvitation(db, ownerA, resent.invitation.id, {}, expiresAt)).error, "CONFLICT");
      const [actionsAfter] = await queryWithParameters(db, "SELECT count(*) AS n FROM queued_brand_action", []);
      assert.equal(Number(actionsAfter.n), Number(actionsBefore.n));
      assert.equal(mailSignals.length, 0);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO team_invitation
          (id, brand_id, invitee_user_id, created_by, role, token_hash, expires_at, status, created_at, replaced_by)
          VALUES (?, ?, ?, ?, 'owner', ?, ?, 'open', ?, NULL)`, [randomUUID(), brandA, invitee, ownerA, hash("owner-role"), expiresAt, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO team_invitation
          (id, brand_id, invitee_user_id, created_by, role, token_hash, expires_at, status, created_at, replaced_by)
          VALUES (?, ?, ?, ?, 'member', ?, ?, 'open', ?, NULL)`, [
          randomUUID(), brandA, invitee, ownerA, hash(`plan-${kind}-${index}`), expiresAt, time,
        ]);
      }
      if (db.kind === "postgresql") await db.query("ANALYZE team_invitation");
      const tokenPlan = await explain(db, invitationByTokenHashQuery(hash("plan-token")));
      const inviteePlan = await explain(db, invitationsForInviteeQuery(invitee));
      const brandPlan = await explain(db, invitationsForBrandQuery(brandA));
      assert.match(tokenPlan, /team_invitation_token_uidx/);
      assert.match(inviteePlan, /team_invitation_invitee_idx/);
      assert.match(brandPlan, /team_invitation_brand_idx/);
      if (db.kind === "postgresql") {
        assert.doesNotMatch(tokenPlan, /Seq Scan on team_invitation/);
        assert.doesNotMatch(inviteePlan, /Seq Scan on team_invitation/);
        assert.doesNotMatch(brandPlan, /Seq Scan on team_invitation/);
      }
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /team_invitation/);
      assert.match(defined, /team_invitation_token_uidx/);
      assert.match(defined, /team_invitation_invitee_idx/);
      assert.match(defined, /team_invitation_brand_idx/);
    } finally {
      console.info = originalInfo;
      console.error = originalError;
      globalThis.fetch = originalFetch;
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
