import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import {
  invitationCreateSchema,
  invitationResendSchema,
  teamInviteLabelKey,
  teamInviteWindowMs,
  teamListLimit,
  type GrantInput,
  type InvitationCreateInput,
  type InvitationResendInput,
  type OwnerTransferView,
  type TeamGrantView,
  type TeamInvitationView,
  type TeamListView,
} from "./contracts.ts";
import { TeamAccessDao, type TeamGrantRecord, type TeamInvitationRecord } from "./dao.ts";
import { batchExport, brandDutyAllows, brandVisible, invitePreview, leaveWorkspace, revokedAction } from "./rules.ts";

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
  const invitations = await visibleInvitations(dao, userId, ownerBrandIds, now);
  return {
    grants: grants.map(toGrantView),
    actions: actions.map((action) => ({ id: action.id, grantId: action.grantId, status: action.status })),
    members: members.map(toGrantView),
    invitations,
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
    grantedBrandIds: access.filter((row) => brandDutyAllows(row.role, "download")).map((row) => row.brandId),
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

function toTransferView(row: {
  id: string;
  brandId: string;
  fromUserId: string;
  toUserId: string;
  actorId: string;
  createdAt: string;
}): OwnerTransferView {
  return {
    id: row.id,
    brandId: row.brandId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

export async function promoteBrandMember(db: DatabaseConnection, actorId: string, grantId: string, now = clock()) {
  try {
    return await db.transaction(async (tx) => {
      const dao = new TeamAccessDao(tx);
      const grant = await dao.grantById(grantId);
      if (!grant || grant.userId === actorId) return { error: "NOT_FOUND" as const };
      const access = await dao.validAccess(actorId, now);
      if (!access.some((row) => row.brandId === grant.brandId && row.role === "owner")) {
        return { error: "NOT_FOUND" as const };
      }
      const brand = await dao.brandGate(grant.brandId);
      if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" as const };
      if (grant.role !== "member" || grant.active !== 1 || isExpired(grant.expiresAt, now)) {
        return { error: "NOT_FOUND" as const };
      }
      if (!await dao.promoteMemberToOwner(grant.id, now)) return { error: "NOT_FOUND" as const };
      const transferId = randomUUID();
      await dao.insertOwnerTransfer({
        id: transferId,
        brandId: grant.brandId,
        fromUserId: actorId,
        toUserId: grant.userId,
        actorId,
        createdAt: now,
      });
      const saved = await dao.ownerTransferById(transferId);
      const next = await dao.grantById(grant.id);
      if (!saved || !next || next.role !== "owner") throw new Error("owner transfer readback failed");
      return { grant: toGrantView(next), transfer: toTransferView(saved) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "CONFLICT" as const };
    if (error instanceof Error && error.message === "owner transfer readback failed") {
      return { error: "SERVICE_UNAVAILABLE" as const };
    }
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

const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function shift(iso: string, milliseconds: number) {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

function chooseExpiry(now: string, requested?: string) {
  if (requested) return requested > now ? requested : null;
  return shift(now, teamInviteWindowMs);
}

function chooseResendExpiry(previous: string, now: string, requested?: string) {
  if (requested) return requested > now && requested > previous ? requested : null;
  const candidate = shift(now, teamInviteWindowMs);
  return candidate > previous ? candidate : shift(previous, 1000);
}

function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  if (!inviteTokenPattern.test(token)) throw new Error("invitation token encoding failed");
  return token;
}

function inviteTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(storedHash: string, token: string) {
  if (!/^[0-9a-f]{64}$/.test(storedHash) || !inviteTokenPattern.test(token)) return false;
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(storedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function toInvitationView(
  row: TeamInvitationRecord,
  actorId: string,
  ownerBrandIds: readonly string[],
  now: string,
): TeamInvitationView {
  const owned = ownerBrandIds.includes(row.brandId);
  const invitee = row.inviteeUserId === actorId;
  const timeExpired = row.expiresAt <= now;
  return {
    id: row.id,
    brandId: row.brandId,
    inviteeUserId: row.inviteeUserId,
    role: "member",
    status: row.status === "open" && timeExpired ? "expired" : row.status,
    expiresAt: row.expiresAt,
    labelKey: teamInviteLabelKey,
    canAccept: invitee && row.status === "open" && !timeExpired && row.replacedBy === null,
    canResend: owned && row.replacedBy === null && (row.status === "open" || row.status === "expired"),
  };
}

async function visibleInvitations(dao: TeamAccessDao, actorId: string, ownerBrandIds: readonly string[], now: string) {
  const mine = await dao.invitationsForInvitee(actorId);
  const owned = await dao.invitationsForBrands(ownerBrandIds);
  const byId = new Map<string, TeamInvitationRecord>();
  for (const row of [...mine, ...owned]) byId.set(row.id, row);
  return [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, teamListLimit)
    .map((row) => toInvitationView(row, actorId, ownerBrandIds, now));
}

function invitationFailure(error: unknown) {
  if (isUniqueViolation(error)) return { error: "CONFLICT" as const };
  if (error instanceof Error && error.message === "invitation readback failed") return { error: "SERVICE_UNAVAILABLE" as const };
  return null;
}

export async function listTeamInvitations(db: QueryConnection, actorId: string, now = clock()) {
  const dao = new TeamAccessDao(db);
  const access = await dao.validAccess(actorId, now);
  const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
  return { invitations: await visibleInvitations(dao, actorId, ownerBrandIds, now) };
}

export async function createTeamInvitation(
  db: DatabaseConnection,
  actorId: string,
  input: InvitationCreateInput,
  now = clock(),
) {
  const parsed = invitationCreateSchema.safeParse(input);
  if (!parsed.success || parsed.data.userId === actorId) return { error: "INVALID_INPUT" as const };
  const expiresAt = chooseExpiry(now, parsed.data.expiresAt);
  if (!expiresAt) return { error: "INVALID_INPUT" as const };
  try {
    return await db.transaction(async (tx) => {
      const dao = new TeamAccessDao(tx);
      if (!await dao.userExists(parsed.data.userId)) return { error: "NOT_FOUND" as const };
      const brand = await dao.brandGate(parsed.data.brandId);
      if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" as const };
      const access = await dao.validAccess(actorId, now);
      const managed = access.find((row) => row.brandId === parsed.data.brandId && row.role === "owner");
      if (!managed) return { error: "FORBIDDEN" as const };
      if (managed.source === "implicit") {
        await dao.insertGrant({
          id: randomUUID(), userId: actorId, brandId: parsed.data.brandId, role: "owner", expiresAt: null, createdAt: now,
        });
      }
      const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
      const id = randomUUID();
      const token = newInviteToken();
      await dao.insertInvitation({
        id,
        brandId: parsed.data.brandId,
        inviteeUserId: parsed.data.userId,
        createdBy: actorId,
        tokenHash: inviteTokenHash(token),
        expiresAt,
        createdAt: now,
      });
      const saved = await dao.invitationById(id);
      if (!saved) throw new Error("invitation readback failed");
      return { invitation: toInvitationView(saved, actorId, ownerBrandIds, now), token };
    });
  } catch (error) {
    const failure = invitationFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export async function resendTeamInvitation(
  db: DatabaseConnection,
  actorId: string,
  invitationId: string,
  input: InvitationResendInput = {},
  now = clock(),
) {
  const parsed = invitationResendSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" as const };
  try {
    return await db.transaction(async (tx) => {
      const dao = new TeamAccessDao(tx);
      const current = await dao.invitationById(invitationId);
      if (!current) return { error: "NOT_FOUND" as const };
      const access = await dao.validAccess(actorId, now);
      const managed = access.find((row) => row.brandId === current.brandId && row.role === "owner");
      if (!managed) return { error: "NOT_FOUND" as const };
      if (managed.source === "implicit") {
        await dao.insertGrant({
          id: randomUUID(), userId: actorId, brandId: current.brandId, role: "owner", expiresAt: null, createdAt: now,
        });
      }
      const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
      const brand = await dao.brandGate(current.brandId);
      if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" as const };
      if (current.status === "accepted" || current.status === "revoked" || current.replacedBy) {
        return { error: "CONFLICT" as const };
      }
      const expiresAt = chooseResendExpiry(current.expiresAt, now, parsed.data.expiresAt);
      if (!expiresAt) return { error: "INVALID_INPUT" as const };
      const id = randomUUID();
      const token = newInviteToken();
      if (!await dao.claimInvitationResend(current.id, id)) return { error: "CONFLICT" as const };
      await dao.insertInvitation({
        id,
        brandId: current.brandId,
        inviteeUserId: current.inviteeUserId,
        createdBy: actorId,
        tokenHash: inviteTokenHash(token),
        expiresAt,
        createdAt: now,
      });
      const saved = await dao.invitationById(id);
      if (!saved || saved.expiresAt <= current.expiresAt) throw new Error("invitation readback failed");
      return { invitation: toInvitationView(saved, actorId, ownerBrandIds, now), token };
    });
  } catch (error) {
    const failure = invitationFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export async function acceptTeamInvitation(
  db: DatabaseConnection,
  actorId: string,
  invitationId: string,
  token: string,
  now = clock(),
) {
  if (!inviteTokenPattern.test(token)) return { error: "NOT_FOUND" as const };
  try {
    return await db.transaction(async (tx) => {
      const dao = new TeamAccessDao(tx);
      const current = await dao.invitationByTokenHash(inviteTokenHash(token));
      if (!current || current.id !== invitationId || current.inviteeUserId !== actorId || !tokenMatches(current.tokenHash, token)) {
        return { error: "NOT_FOUND" as const };
      }
      if (current.status === "accepted" || current.status === "revoked") return { error: "CONFLICT" as const };
      if (current.status === "expired" || current.replacedBy || current.expiresAt <= now) {
        if (current.status === "open" && current.expiresAt <= now) await dao.expireInvitation(current.id, now);
        return { error: "INVITE_EXPIRED" as const };
      }
      if (!await dao.acceptInvitation(current.id, now)) return { error: "CONFLICT" as const };
      const existing = await dao.pair(actorId, current.brandId);
      if (!existing) {
        await dao.insertGrant({
          id: randomUUID(),
          userId: actorId,
          brandId: current.brandId,
          role: "member",
          expiresAt: null,
          createdAt: now,
        });
      } else if (existing.role !== "owner" && (existing.active !== 1 || isExpired(existing.expiresAt, now))) {
        if (!await dao.reactivate(existing.id, "member", null)) throw new Error("invitation readback failed");
      }
      const grant = await dao.pair(actorId, current.brandId);
      const saved = await dao.invitationById(current.id);
      if (!grant || (grant.role !== "member" && grant.role !== "owner") || !saved || saved.status !== "accepted") {
        throw new Error("invitation readback failed");
      }
      const access = await dao.validAccess(actorId, now);
      const ownerBrandIds = access.filter((row) => row.role === "owner").map((row) => row.brandId);
      return { invitation: toInvitationView(saved, actorId, ownerBrandIds, now), grant: toGrantView(grant) };
    });
  } catch (error) {
    const failure = invitationFailure(error);
    if (failure) return failure;
    throw error;
  }
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
