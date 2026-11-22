import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import type { GrantInput, TeamGrantView, TeamListView } from "./contracts.ts";
import { TeamAccessDao, type TeamGrantRecord } from "./dao.ts";
import { batchExport, brandVisible, invitePreview, leaveWorkspace, revokedAction } from "./rules.ts";

function clock() {
  return new Date().toISOString();
}

function isExpired(expiresAt: string | null, now: string) {
  return expiresAt !== null && expiresAt <= now;
}

function toGrantView(row: TeamGrantRecord): TeamGrantView {
  return {
    id: row.id,
    userId: row.userId,
    brandId: row.brandId,
    role: row.role,
    active: row.active,
    expiresAt: row.expiresAt,
  };
}

function isUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /unique|duplicate key/i.test(message);
}

export async function listTeamGrants(db: QueryConnection, userId: string, now = clock()): Promise<TeamListView> {
  const dao = new TeamAccessDao(db);
  const access = await dao.validAccess(userId, now);
  const grants = await dao.grantsForUser(userId);
  const actions = await dao.actionsForUser(userId);
  const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
  const members = await dao.membersForBrands(ownerBrandIds);
  return {
    grants: grants.map(toGrantView),
    actions: actions.map((action) => ({ id: action.id, grantId: action.grantId, status: action.status })),
    members: members.map(toGrantView),
    accessibleBrandIds: access.map((row) => row.brandId),
    ownerBrandIds,
    invite: invitePreview(),
  };
}

export async function loadOwnedLabels(db: QueryConnection, ownerBrandIds: readonly string[]) {
  return new TeamAccessDao(db).brandLabels(ownerBrandIds);
}

export async function readGrantedBrand(db: QueryConnection, userId: string, brandId: string, now = clock()) {
  const access = await new TeamAccessDao(db).validAccess(userId, now);
  const visible = brandVisible(access.map((row) => ({ brandId: row.brandId, active: true })), brandId);
  if (!visible) return { error: "FORBIDDEN" as const };
  return { brandId, visible: true as const };
}

export async function exportGrantedBrands(db: QueryConnection, userId: string, requestedBrandIds: readonly string[], now = clock()) {
  const access = await new TeamAccessDao(db).validAccess(userId, now);
  const decision = batchExport({
    grantedBrandIds: access.map((row) => row.brandId),
    requestedBrandIds: [...new Set(requestedBrandIds)],
  });
  if (!decision.allowed) return { allowed: false as const, rows: [] as string[] };
  return { allowed: true as const, rows: decision.rows };
}

export async function grantBrandMember(db: DatabaseConnection, actorId: string, input: GrantInput, now = clock()) {
  if (input.userId === actorId) return { error: "INVALID_INPUT" as const };
  if (input.expiresAt && input.expiresAt <= now) return { error: "INVALID_INPUT" as const };
  try {
    return await db.transaction(async (tx) => {
      const dao = new TeamAccessDao(tx);
      if (!await dao.userExists(input.userId)) return { error: "NOT_FOUND" as const };
      const brand = await dao.brandGate(input.brandId);
      if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" as const };
      const access = await dao.validAccess(actorId, now);
      const managed = access.find((row) => row.brandId === input.brandId && row.role === "owner");
      if (!managed) return { error: "FORBIDDEN" as const };
      if (managed.source === "implicit") {
        await dao.insertGrant({
          id: randomUUID(), userId: actorId, brandId: input.brandId, role: "owner", expiresAt: null, createdAt: now,
        });
      }
      const existing = await dao.pair(input.userId, input.brandId);
      const grantId = existing?.id ?? randomUUID();
      if (existing) {
        if (!await dao.reactivate(existing.id, input.role, input.expiresAt ?? null)) return { error: "CONFLICT" as const };
      } else {
        await dao.insertGrant({
          id: grantId,
          userId: input.userId,
          brandId: input.brandId,
          role: input.role,
          expiresAt: input.expiresAt ?? null,
          createdAt: now,
        });
      }
      let action: { id: string; status: "queued" } | null = null;
      if (input.role === "member") {
        const actionId = randomUUID();
        await dao.insertAction({
          id: actionId,
          grantId,
          attachment: randomBytes(16).toString("hex"),
          createdAt: now,
        });
        action = { id: actionId, status: "queued" };
      }
      const grant = await dao.grantById(grantId);
      if (!grant) return { error: "SERVICE_UNAVAILABLE" as const };
      return { grant: toGrantView(grant), action, invite: invitePreview() };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "CONFLICT" as const };
    throw error;
  }
}

export async function revokeBrandGrant(db: DatabaseConnection, actorId: string, grantId: string, now = clock()) {
  return db.transaction(async (tx) => {
    const dao = new TeamAccessDao(tx);
    const grant = await dao.grantById(grantId);
    if (!grant) return { error: "NOT_FOUND" as const };
    const access = await dao.validAccess(actorId, now);
    if (!access.some((row) => row.brandId === grant.brandId && row.role === "owner")) return { error: "FORBIDDEN" as const };
    if (grant.role === "owner" && grant.active === 1 && !isExpired(grant.expiresAt, now)) {
      const others = await dao.otherOwnerCounts([grant.brandId], grant.userId, now);
      if (!leaveWorkspace({ actorIsLastOwner: (others.get(grant.brandId) ?? 0) === 0 }).allowed) {
        return { error: "CONFLICT" as const };
      }
    }
    if (!await dao.revoke(grant.id, now)) return { error: "CONFLICT" as const };
    const next = await dao.grantById(grant.id);
    if (!next) return { error: "SERVICE_UNAVAILABLE" as const };
    return { grant: toGrantView(next), invite: invitePreview() };
  });
}

export async function executeQueuedBrandAction(db: DatabaseConnection, actorId: string, actionId: string, now = clock()) {
  return db.transaction(async (tx) => {
    const dao = new TeamAccessDao(tx);
    const action = await dao.actionMeta(actionId);
    if (!action) return { error: "NOT_FOUND" as const };
    const grant = await dao.grantById(action.grantId);
    if (!grant || grant.userId !== actorId) return { error: "NOT_FOUND" as const };
    const decision = revokedAction({
      queued: action.status === "queued",
      grantRevoked: grant.active !== 1 || isExpired(grant.expiresAt, now),
    });
    if (!decision.run || !decision.download) {
      if (action.status === "queued") await dao.stopAction(action.id);
      return { action: { id: action.id, status: "stopped" as const, download: "" } };
    }
    const download = await dao.attachment(action.id);
    if (!download) return { error: "NOT_FOUND" as const };
    return { action: { id: action.id, status: action.status, download } };
  });
}

export async function leaveTeam(db: DatabaseConnection, actorId: string, now = clock()) {
  return db.transaction(async (tx) => {
    const dao = new TeamAccessDao(tx);
    const access = await dao.validAccess(actorId, now);
    const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
    const others = await dao.otherOwnerCounts(ownerBrandIds, actorId, now);
    const decision = leaveWorkspace({
      actorIsLastOwner: ownerBrandIds.some((brandId) => (others.get(brandId) ?? 0) === 0),
    });
    if (!decision.allowed) return { allowed: false as const, reason: decision.reason };
    await dao.revokeAllForUser(actorId, now);
    return { allowed: true as const, reason: decision.reason };
  });
}
