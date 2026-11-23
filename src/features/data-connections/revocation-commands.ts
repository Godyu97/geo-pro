import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { revokeSync } from "./crawler-identity.ts";
import type {
  RegisterSyncAuthorizationInput,
  SyncAuthorizationList,
  SyncAuthorizationView,
  SyncAttemptView,
} from "./revocation-contracts.ts";
import {
  SyncAuthorizationDao,
  type SyncAttemptRecord,
  type SyncAuthorizationRecord,
} from "./revocation-dao.ts";

type Clock = () => string;
type CommandResult = { authorization: SyncAuthorizationView } | { error: "NOT_FOUND" | "CONFLICT" };
type RegisterResult = { authorization: SyncAuthorizationView } | { error: "NOT_FOUND" };

const systemClock: Clock = () => new Date().toISOString();

function decisionFor(revoked: boolean, retainedRows: number) {
  const decision = revokeSync({ revoked, retainedRows });
  if (decision.historyDeleted || decision.retainedRows !== retainedRows || decision.pull !== !revoked) {
    throw new Error("sync-authorization-decision");
  }
  return decision;
}

function toAttempt(row: SyncAttemptRecord): SyncAttemptView {
  return { id: row.id, result: row.result, attemptedAt: row.attemptedAt };
}

function toView(row: SyncAuthorizationRecord, attempts: readonly SyncAttemptRecord[]): SyncAuthorizationView {
  if (row.historyDeleted !== 0) throw new Error("sync-authorization-history-deleted");
  const decision = decisionFor(row.revoked === 1, row.retainedRows);
  const ordered = [...attempts].sort((left, right) => {
    if (left.attemptedAt === right.attemptedAt) return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    return left.attemptedAt < right.attemptedAt ? 1 : -1;
  });
  return {
    id: row.id,
    brandId: row.brandId,
    sourceName: row.sourceName,
    revoked: row.revoked === 1,
    retainedRows: decision.retainedRows,
    historyDeleted: false,
    pull: decision.pull,
    attempts: ordered.map(toAttempt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedActive(brands: BrandDao, ownerId: string, brandId: string) {
  const brand = await brands.owned(ownerId, brandId);
  return brand?.status === "active" ? brand : null;
}

async function lockedAuthorization(dao: SyncAuthorizationDao, brands: BrandDao, ownerId: string, authorizationId: string) {
  const row = await dao.authorizationForOwner(ownerId, authorizationId, true);
  if (!row || !await ownedActive(brands, ownerId, row.brandId)) return null;
  return row;
}

export async function listSyncAuthorizations(db: DatabaseConnection, ownerId: string): Promise<SyncAuthorizationList> {
  return db.transaction(async (tx) => {
    const dao = new SyncAuthorizationDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const authorizations = await dao.authorizationsForOwner(ownerId);
    const attempts = await dao.attemptsForOwner(ownerId, authorizations.map((row) => row.id));
    const grouped = new Map<string, SyncAttemptRecord[]>();
    for (const attempt of attempts) {
      const list = grouped.get(attempt.authorizationId) ?? [];
      list.push(attempt);
      grouped.set(attempt.authorizationId, list);
    }
    return {
      brands,
      authorizations: authorizations.map((row) => toView(row, grouped.get(row.id) ?? [])),
    };
  });
}

export async function registerSyncAuthorization(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterSyncAuthorizationInput,
  clock: Clock = systemClock,
): Promise<RegisterResult> {
  decisionFor(false, input.retainedRows);
  return db.transaction(async (tx) => {
    const owned = await ownedActive(new BrandDao(tx), ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const row: SyncAuthorizationRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      sourceName: input.sourceName,
      revoked: 0,
      retainedRows: input.retainedRows,
      historyDeleted: 0,
      createdAt: now,
      updatedAt: now,
    };
    await new SyncAuthorizationDao(tx).insertAuthorization(row);
    return { authorization: toView(row, []) };
  });
}

export async function revokeSyncAuthorization(
  db: DatabaseConnection,
  ownerId: string,
  authorizationId: string,
  clock: Clock = systemClock,
): Promise<CommandResult> {
  return db.transaction(async (tx) => {
    const dao = new SyncAuthorizationDao(tx);
    const current = await lockedAuthorization(dao, new BrandDao(tx), ownerId, authorizationId);
    if (!current) return { error: "NOT_FOUND" as const };
    const decision = decisionFor(true, current.retainedRows);
    const attempts = await dao.attemptsForOwner(ownerId, [current.id]);
    if (current.revoked === 1) return { authorization: toView(current, attempts) };
    const now = clock();
    const saved = await dao.markRevoked(ownerId, current.id, decision.retainedRows, now);
    if (!saved) return { error: "CONFLICT" as const };
    return { authorization: toView({ ...current, revoked: 1, updatedAt: now }, attempts) };
  });
}

export async function pullSyncAuthorization(
  db: DatabaseConnection,
  ownerId: string,
  authorizationId: string,
  clock: Clock = systemClock,
): Promise<CommandResult> {
  return db.transaction(async (tx) => {
    const dao = new SyncAuthorizationDao(tx);
    const current = await lockedAuthorization(dao, new BrandDao(tx), ownerId, authorizationId);
    if (!current) return { error: "NOT_FOUND" as const };
    const decision = decisionFor(current.revoked === 1, current.retainedRows);
    const now = clock();
    const attempt: SyncAttemptRecord = {
      id: randomUUID(),
      authorizationId: current.id,
      result: decision.pull ? "allowed" : "stopped",
      attemptedAt: now,
    };
    await dao.insertAttempts([{
      ...attempt,
      brandId: current.brandId,
      ownerId,
    }]);
    const attempts = await dao.attemptsForOwner(ownerId, [current.id]);
    const stored = attempts.find((row) => row.id === attempt.id);
    if (!stored || stored.result !== attempt.result) throw new Error("sync-attempt-missing");
    return { authorization: toView(current, attempts) };
  });
}
