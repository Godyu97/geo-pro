import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { agencyAccess, portfolioRow } from "./delegation.ts";
import type {
  DelegationActionView,
  DelegationWorkspace,
  ManagedDelegationView,
  PortfolioRowView,
  RegisterDelegationInput,
  RegisterMembershipInput,
} from "./contracts.ts";
import { DelegationDao, type DelegationAccess } from "./dao.ts";

function clock() {
  return new Date().toISOString();
}

function isUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /unique|duplicate key/i.test(message);
}

function evidenceIds(scope: string) {
  return scope.split(",").filter((part) => part.length > 0);
}

function grantOpen(delegation: { active: boolean; expiresAt: string }, now: string) {
  return delegation.active && delegation.expiresAt > now;
}

function projectDelegation(delegation: DelegationAccess["delegations"][number], now: string, queued: boolean) {
  const decision = agencyAccess({
    agencyMember: true,
    grantActive: grantOpen(delegation, now),
    queued,
  });
  const row = portfolioRow({
    brandId: delegation.brandId,
    grantActive: decision.allowed,
    evidenceIds: evidenceIds(delegation.scope),
  });
  return { decision, row };
}

function portfolioFrom(access: DelegationAccess, now: string): PortfolioRowView[] {
  return access.delegations.map((delegation) => {
    const { row } = projectDelegation(delegation, now, false);
    return { delegationId: delegation.id, brandId: row.brandId, summary: row.summary, evidenceIds: row.evidenceIds };
  });
}

function actionsFrom(access: DelegationAccess): DelegationActionView[] {
  return access.delegations.flatMap((delegation) => delegation.actions.map((action) => ({
    id: action.id,
    delegationId: delegation.id,
    brandId: delegation.brandId,
    status: action.status,
  })));
}

export async function listDelegationWorkspace(db: QueryConnection, userId: string, now = clock()): Promise<DelegationWorkspace> {
  const dao = new DelegationDao(db);
  const access = await dao.accessForUser(userId);
  const managed = await dao.managedForOwner(userId);
  const brands = await dao.ownedBrands(userId);
  return {
    memberships: access.memberships,
    portfolio: portfolioFrom(access, now),
    actions: actionsFrom(access),
    managed: managed.map((row): ManagedDelegationView => ({
      id: row.delegationId,
      brandId: row.brandId,
      organizationId: row.organizationId,
      active: row.delegationActive,
      expiresAt: row.expiresAt,
    })),
    brands: brands.map((brand) => ({ id: brand.brandId, name: brand.name ?? brand.brandId })),
  };
}

export async function portfolioForUser(db: QueryConnection, userId: string, now = clock()) {
  const access = await new DelegationDao(db).accessForUser(userId);
  return { rows: portfolioFrom(access, now) };
}

export async function readDelegatedBrand(db: QueryConnection, userId: string, brandId: string, now = clock()): Promise<
  | { error: "NOT_FOUND" }
  | { error: "FORBIDDEN"; reason: "grant" | "membership" }
  | { brandId: string; summary: "blocked" | "visible"; evidenceIds: string[]; reason: "ok" }
> {
  const access = await new DelegationDao(db).accessForUser(userId);
  const matches = access.delegations.filter((delegation) => delegation.brandId === brandId);
  if (!matches.length) return { error: "NOT_FOUND" as const };
  const open = matches.find((delegation) => grantOpen(delegation, now));
  const selected = open ?? matches[0];
  if (!selected) return { error: "NOT_FOUND" as const };
  const { decision, row } = projectDelegation(selected, now, false);
  if (!decision.allowed) {
    return { error: "FORBIDDEN" as const, reason: decision.reason === "membership" ? "membership" : "grant" };
  }
  return { brandId: row.brandId, summary: row.summary, evidenceIds: row.evidenceIds, reason: "ok" as const };
}

export async function registerAgencyMember(
  db: DatabaseConnection,
  actorId: string,
  input: RegisterMembershipInput,
  now = clock(),
): Promise<
  | { error: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" }
  | { membership: { id: string; organizationId: string; userId: string; active: 1 } }
> {
  try {
    return await db.transaction(async (tx) => {
      const dao = new DelegationDao(tx);
      if (!await dao.userExists(input.userId)) return { error: "NOT_FOUND" as const };
      if (input.userId !== actorId && !await dao.activeMember(input.organizationId, actorId)) {
        return { error: "FORBIDDEN" as const };
      }
      const id = randomUUID();
      await dao.insertMembership({ id, organizationId: input.organizationId, userId: input.userId, createdAt: now });
      return { membership: { id, organizationId: input.organizationId, userId: input.userId, active: 1 as const } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "CONFLICT" as const };
    throw error;
  }
}

export async function registerBrandDelegation(
  db: DatabaseConnection,
  actorId: string,
  input: RegisterDelegationInput,
  now = clock(),
): Promise<
  | { error: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" }
  | {
    delegation: { id: string; brandId: string; organizationId: string; active: 1; expiresAt: string };
    action: { id: string; status: "queued" };
  }
> {
  if (input.expiresAt <= now) return { error: "INVALID_INPUT" as const };
  try {
    return await db.transaction(async (tx) => {
      const dao = new DelegationDao(tx);
      const brand = await dao.brandGate(input.brandId);
      if (!brand || brand.ownerId !== actorId || brand.status !== "active" || brand.frozenAt) {
        return { error: "NOT_FOUND" as const };
      }
      if (!await dao.organizationHasMember(input.organizationId)) return { error: "NOT_FOUND" as const };
      const id = randomUUID();
      const actionId = randomUUID();
      await dao.insertDelegation({
        id,
        brandId: input.brandId,
        organizationId: input.organizationId,
        expiresAt: input.expiresAt,
        scope: input.scope,
        createdAt: now,
      });
      await dao.insertAction({ id: actionId, delegationId: id, createdAt: now });
      return {
        delegation: {
          id,
          brandId: input.brandId,
          organizationId: input.organizationId,
          active: 1 as const,
          expiresAt: input.expiresAt,
        },
        action: { id: actionId, status: "queued" as const },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "CONFLICT" as const };
    throw error;
  }
}

export async function expireBrandDelegation(db: DatabaseConnection, actorId: string, delegationId: string, now = clock()): Promise<
  | { error: "NOT_FOUND" }
  | { delegation: { id: string; brandId: string; organizationId: string; active: 0; expiresAt: string } }
> {
  return db.transaction(async (tx) => {
    const dao = new DelegationDao(tx);
    const current = await dao.delegationForOwner(delegationId);
    if (!current || current.ownerId !== actorId) return { error: "NOT_FOUND" as const };
    await dao.expire(current.id, now);
    await dao.stopQueued(current.id);
    return {
      delegation: {
        id: current.id,
        brandId: current.brandId,
        organizationId: current.organizationId,
        active: 0 as const,
        expiresAt: current.expiresAt,
      },
    };
  });
}

export async function executeDelegationAction(db: DatabaseConnection, actorId: string, actionId: string, now = clock()): Promise<
  | { error: "NOT_FOUND" }
  | { action: DelegationActionView; reason: "grant" | "membership" | "ok" }
  | { action: DelegationActionView; reason: "ok"; evidenceIds: string[] }
> {
  return db.transaction(async (tx) => {
    const dao = new DelegationDao(tx);
    const access = await dao.accessForUser(actorId);
    const delegation = access.delegations.find((item) => item.actions.some((action) => action.id === actionId));
    const action = delegation?.actions.find((item) => item.id === actionId);
    if (!delegation || !action) return { error: "NOT_FOUND" as const };
    const { decision, row } = projectDelegation(delegation, now, action.status === "queued");
    if (!decision.allowed || !decision.runQueued) {
      if (action.status === "queued") await dao.stopAction(action.id);
      return {
        action: { id: action.id, delegationId: delegation.id, brandId: delegation.brandId, status: "stopped" as const },
        reason: decision.reason,
      };
    }
    return {
      action: { id: action.id, delegationId: delegation.id, brandId: delegation.brandId, status: "queued" as const },
      reason: "ok" as const,
      evidenceIds: row.evidenceIds,
    };
  });
}
