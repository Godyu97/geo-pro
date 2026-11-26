import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { saveApprovalPolicy } from "../../src/features/approval-policy/commands.ts";
import { openApprovalScope } from "../../src/features/approval-policy/enforce.ts";
import { readSourceOriginal, listImportedOriginals } from "../../src/features/asset-reuse/commands.ts";
import { readFactWorkspace, executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { readPromptWorkspace, executePromptCommand } from "../../src/features/prompts/service.ts";
import { authorizeBrandActor, workspaceBrand } from "../../src/features/team-access/brand-scope.ts";
import {
  acceptTeamInvitation,
  createTeamInvitation,
  grantBrandMember,
  loadTeamGroupWorkspace,
  revokeBrandGrant,
} from "../../src/features/team-access/commands.ts";
import {
  authorizePlatformAdmin,
  changePlatformRole,
  ensurePersonalGroup,
  getUserPlatformRole,
} from "../../src/features/team-access/platform-role.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T12:00:00.000Z";

async function addUser(db, id, name, email) {
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, name, email, db.kind === "sqlite" ? 1 : true],
  );
}

async function addBrandWithGroup(db, ownerId, brandId, name, groupId) {
  await queryWithParameters(
    db,
    `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
     VALUES (?, ?, 'active', 1, 1, ?)`,
    [brandId, ownerId, time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO brand_group (brand_id, group_id, created_at)
     VALUES (?, ?, ?)`,
    [brandId, groupId, time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO brand_version (brand_id, version, name, content, created_at)
     VALUES (?, 1, ?, ?, ?)`,
    [brandId, name, JSON.stringify({
      description: "合成测试品牌简介内容",
      website: "https://member-access.example.com",
      aliases: [],
      region: "CN",
      language: "zh-CN",
      competitors: [],
      questions: ["如何挑选工业方案？"],
    }), time],
  );
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: platform role, group scope, read-only invite, and revoke boundaries`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));

      const userA = randomUUID();
      const userB = randomUUID();
      const maintainer = randomUUID();
      const outsider = randomUUID();
      await addUser(db, userA, "User A", `user-a-${userA}@example.invalid`);
      await addUser(db, userB, "User B", `user-b-${userB}@example.invalid`);
      await addUser(db, maintainer, "Maintainer", `maint-${maintainer}@example.invalid`);
      await addUser(db, outsider, "Outsider", `out-${outsider}@example.invalid`);

      // Existing maintenance grant must NOT auto-elevate to admin.
      await queryWithParameters(
        db,
        "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, 'support.read', ?, ?)",
        [maintainer, time, maintainer],
      );
      assert.equal(await getUserPlatformRole(db, userA), "user");
      assert.equal(await getUserPlatformRole(db, maintainer), "user");
      assert.equal(await authorizePlatformAdmin(db, maintainer), null);

      // Non-initial grant by non-admin is denied unless first admin bootstrap.
      const deniedFirst = await changePlatformRole(db, {
        action: "grant",
        operatorId: maintainer,
        userId: userB,
        reason: "initial-setup",
      });
      assert.equal(deniedFirst.status, "denied");
      assert.equal(deniedFirst.reason, "not-authorized");

      const firstAdmin = await changePlatformRole(db, {
        action: "grant",
        operatorId: userA,
        userId: userA,
        reason: "initial-setup",
      });
      assert.equal(firstAdmin.status, "allowed");
      assert.equal(await getUserPlatformRole(db, userA), "admin");
      assert.deepEqual(await authorizePlatformAdmin(db, userA), { actorId: userA, role: "admin" });

      // Once an admin exists, non-admin cannot bootstrap self.
      const blockedSecond = await changePlatformRole(db, {
        action: "grant",
        operatorId: maintainer,
        userId: maintainer,
        reason: "initial-setup",
      });
      assert.equal(blockedSecond.status, "denied");

      // Demote userA back to user so we test normal user collaboration.
      const demoted = await changePlatformRole(db, {
        action: "revoke",
        operatorId: userA,
        userId: userA,
        reason: "access-review",
      });
      assert.equal(demoted.status, "allowed");
      assert.equal(await getUserPlatformRole(db, userA), "user");

      const groupA = await ensurePersonalGroup(db, userA, "User A", time);
      const groupB = await ensurePersonalGroup(db, userB, "User B", time);
      const groupOut = await ensurePersonalGroup(db, outsider, "Outsider", time);
      const brandA = randomUUID();
      const brandOut = randomUUID();
      await addBrandWithGroup(db, userA, brandA, "甲组私密品牌", groupA);
      await addBrandWithGroup(db, outsider, brandOut, "外组私密品牌", groupOut);

      // Member management must not grant brands outside the selected group.
      const crossGroupGrant = await grantBrandMember(db, userA, {
        userId: userB,
        brandId: brandA,
        groupId: groupB,
        role: "read_only",
      }, time);
      assert.equal(crossGroupGrant.error, "FORBIDDEN");

      // Invite userB by email with read_only role inside groupA.
      const invited = await createTeamInvitation(db, userA, {
        email: `USER-B-${userB}@example.invalid`,
        brandId: brandA,
        groupId: groupA,
        role: "read_only",
      }, time);
      assert.equal("token" in invited, true);
      if (!("token" in invited)) return;
      assert.equal(invited.invitation.role, "read_only");
      assert.equal(invited.invitation.inviteeUserId, userB);

      const accepted = await acceptTeamInvitation(db, userB, invited.invitation.id, invited.token, time);
      assert.equal("grant" in accepted, true);
      if (!("grant" in accepted)) return;
      assert.equal(accepted.grant.role, "read_only");

      // User B sees both personal groupB and joined groupA.
      const wsBInA = await loadTeamGroupWorkspace(db, userB, groupA, time);
      assert.equal("error" in wsBInA, false);
      if ("error" in wsBInA) return;
      assert.equal(wsBInA.groups.length, 2);
      assert.equal(wsBInA.activeGroup.id, groupA);
      assert.equal(wsBInA.groupBrands.length, 1);
      assert.equal(wsBInA.groupBrands[0].brandId, brandA);
      assert.equal(wsBInA.groupBrands[0].role, "read_only");
      assert.deepEqual(wsBInA.groupBrands[0].actions, {
        view: true,
        edit: false,
        factApprove: false,
        contentApprove: false,
        export: false,
        manageMembers: false,
      });

      // Read-only member can view brand, facts, prompts, sources list, but CANNOT write, download, or read outsider brand.
      assert.equal((await authorizeBrandActor(db, userB, brandA, "read", time))?.role, "read_only");
      assert.equal(await authorizeBrandActor(db, userB, brandA, "write", time), null);
      assert.equal(await authorizeBrandActor(db, userB, brandA, "download", time), null);
      assert.equal(await authorizeBrandActor(db, userB, brandOut, "read", time), null);
      assert.equal((await workspaceBrand(db, userB, undefined, "read", time))?.brandId, brandA);

      const factsView = await readFactWorkspace(db, { ownerId: userB, brandId: brandA }, {}, () => new Date(time));
      assert.equal(factsView?.readOnly, true);
      const factsWrite = await executeFactCommand(db, { ownerId: userB, brandId: brandA }, {
        action: "savePaste",
        id: randomUUID(),
        previousId: null,
        original: "不应该允许只读成员写入",
      }, () => new Date(time));
      assert.deepEqual(factsWrite, { error: "readOnly" });

      const promptsView = await readPromptWorkspace(db, { ownerId: userB, brandId: brandA }, {});
      assert.equal(promptsView?.readOnly, true);
      const promptsWrite = await executePromptCommand(db, { ownerId: userB, brandId: brandA }, {
        action: "reference",
        setVersionId: randomUUID(),
        consumerId: randomUUID(),
      });
      assert.deepEqual(promptsWrite, { error: "readOnly" });

      // Approval policy duty cannot let a read_only member approve!
      await saveApprovalPolicy(db, userA, {
        brandId: brandA,
        dualControl: true,
        duties: [{ userId: userB, factApprover: true, contentApprover: true }],
      }, time);
      assert.deepEqual(await openApprovalScope(db, userB, brandA, "fact"), { error: "NOT_FOUND" });

      // Private original download denied for read_only.
      const sourceList = await listImportedOriginals(db, userB, brandA, new Date(time));
      assert.equal("error" in sourceList, false);
      if (!("error" in sourceList)) assert.equal(sourceList.canManage, false);
      const sourceDownload = await readSourceOriginal(db, userB, { brandId: brandA, id: randomUUID() });
      assert.deepEqual(sourceDownload, { error: "NOT_FOUND" });

      // Revoke userB's grant -> loses brand access and non-personal group membership immediately.
      const revoked = await revokeBrandGrant(db, userA, accepted.grant.id, time);
      assert.equal("grant" in revoked, true);
      assert.equal(await authorizeBrandActor(db, userB, brandA, "read", time), null);
      assert.equal(await readFactWorkspace(db, { ownerId: userB, brandId: brandA }, {}, () => new Date(time)), null);
      assert.equal(await readPromptWorkspace(db, { ownerId: userB, brandId: brandA }, {}), null);
      assert.deepEqual(await loadTeamGroupWorkspace(db, userB, groupA, time), { error: "FORBIDDEN" });
      const wsBPersonal = await loadTeamGroupWorkspace(db, userB, undefined, time);
      assert.equal("error" in wsBPersonal, false);
      if (!("error" in wsBPersonal)) {
        assert.equal(wsBPersonal.groups.length, 1);
        assert.equal(wsBPersonal.activeGroup.id, groupB);
      }
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });

  test(`${kind}: legacy migration preserves owner personal brands, active members, duties, and revoked/expired/read-only state`, async () => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    try {
      const db = fixture.connection;
      await migrateThrough(db, kind === "sqlite" ? "0095_young_shriek" : "0096_narrow_tyger_tiger");
      const owner = randomUUID();
      const activeMember = randomUUID();
      const revokedUser = randomUUID();
      const expiredUser = randomUUID();
      const readerUser = randomUUID();
      const maintUser = randomUUID();
      const brandId = randomUUID();

      for (const [id, name] of [
        [owner, "Legacy Owner"],
        [activeMember, "Legacy Active"],
        [revokedUser, "Legacy Revoked"],
        [expiredUser, "Legacy Expired"],
        [readerUser, "Legacy Reader"],
        [maintUser, "Legacy Maintainer"],
      ]) {
        await addUser(db, id, name, `${id}@example.invalid`);
      }

      await queryWithParameters(
        db,
        "INSERT INTO maintenance_grant (user_id, permission, granted_at, operator_id) VALUES (?, 'capabilities.manage', ?, ?)",
        [maintUser, time, maintUser],
      );
      await queryWithParameters(
        db,
        "INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at) VALUES (?, ?, 'active', 1, 1, ?)",
        [brandId, owner, time],
      );
      await queryWithParameters(
        db,
        "INSERT INTO brand_version (brand_id, version, name, content, created_at) VALUES (?, 1, ?, ?, ?)",
        [brandId, "旧版迁移测试品牌", JSON.stringify({ description: "迁移前既有品牌", website: "", aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [] }), time],
      );
      await queryWithParameters(
        db,
        `INSERT INTO brand_member_grant (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
         VALUES
           (?, ?, ?, 'owner', 1, NULL, ?, NULL),
           (?, ?, ?, 'member', 1, NULL, ?, NULL),
           (?, ?, ?, 'member', 0, NULL, ?, ?),
           (?, ?, ?, 'member', 1, ?, ?, NULL),
           (?, ?, ?, 'read_only', 1, NULL, ?, NULL)`,
        [
          randomUUID(), owner, brandId, time,
          randomUUID(), activeMember, brandId, time,
          randomUUID(), revokedUser, brandId, time, time,
          randomUUID(), expiredUser, brandId, "2020-01-01T00:00:00.000Z", time,
          randomUUID(), readerUser, brandId, time,
        ],
      );
      await queryWithParameters(
        db,
        "INSERT INTO approval_policy (id, brand_id, version, dual_control, updated_at, updated_by) VALUES (?, ?, 1, 1, ?, ?)",
        [randomUUID(), brandId, time, owner],
      );
      await queryWithParameters(
        db,
        "INSERT INTO brand_approval_duty (id, brand_id, user_id, fact_approver, content_approver, updated_at) VALUES (?, ?, ?, 1, 0, ?)",
        [randomUUID(), brandId, activeMember, time],
      );

      execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

      assert.equal(await getUserPlatformRole(db, owner), "user");
      assert.equal(await getUserPlatformRole(db, maintUser), "user");
      assert.equal((await authorizeBrandActor(db, owner, brandId, "write", time))?.role, "owner");
      assert.equal((await authorizeBrandActor(db, activeMember, brandId, "write", time))?.role, "member");
      assert.equal(await authorizeBrandActor(db, revokedUser, brandId, "read", time), null);
      assert.equal(await authorizeBrandActor(db, expiredUser, brandId, "read", time), null);
      assert.equal((await authorizeBrandActor(db, readerUser, brandId, "read", time))?.role, "read_only");
      assert.equal(await authorizeBrandActor(db, readerUser, brandId, "download", time), null);

      const factScope = await openApprovalScope(db, activeMember, brandId, "fact");
      assert.equal("error" in factScope, false);
      if (!("error" in factScope)) assert.equal(factScope.matchingDuty, true);

      const wsOwner = await loadTeamGroupWorkspace(db, owner, undefined, time);
      assert.equal("error" in wsOwner, false);
      if (!("error" in wsOwner)) {
        assert.equal(wsOwner.groupBrands.length, 1);
        assert.equal(wsOwner.groupBrands[0].brandId, brandId);
      }
      const wsActive = await loadTeamGroupWorkspace(db, activeMember, undefined, time);
      assert.equal("error" in wsActive, false);
      if (!("error" in wsActive)) {
        assert.equal(wsActive.groups.length, 2);
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
