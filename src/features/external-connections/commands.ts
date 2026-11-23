import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type {
  ExternalActionView,
  ExternalConnectionList,
  ExternalConnectionView,
  RegisterConnectionInput,
  RetryActionInput,
  SubmitActionInput,
  UpdateConnectionInput,
} from "./contracts.ts";
import {
  ExternalConnectionDao,
  type ExternalActionInsert,
  type ExternalActionRecord,
  type ExternalConnectionRecord,
} from "./dao.ts";
import { receiptEffect, requestPublish, retryAction, type ConnectionScope } from "./rules.ts";

type Clock = () => string;
type ActionResult = { connection: ExternalConnectionView } | { error: "NOT_FOUND" | "INVALID_INPUT" | "REVOKED" | "CONFLICT" };
type RegisterResult = { connection: ExternalConnectionView } | { error: "NOT_FOUND" };
type BrandListResult = { connections: ExternalConnectionView[] } | { error: "NOT_FOUND" };
type StoredOutcome = Pick<ExternalActionInsert, "status" | "receiptKind" | "effectiveAt">;

const systemClock: Clock = () => new Date().toISOString();

function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function scopesOf(row: Pick<ExternalConnectionRecord, "canRead" | "canDraft" | "canPublish">): ConnectionScope[] {
  const scopes: ConnectionScope[] = [];
  if (row.canRead === 1) scopes.push("read");
  if (row.canDraft === 1) scopes.push("draft");
  if (row.canPublish === 1) scopes.push("publish");
  return scopes;
}

function toAction(connection: ExternalConnectionRecord, row: ExternalActionRecord): ExternalActionView {
  const decision = requestPublish({ scopes: scopesOf(connection), confirmed: row.confirmed === 1 });
  const effect = row.receiptKind ? receiptEffect(row.receiptKind) : { interventionEffective: false };
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    confirmed: row.confirmed === 1,
    status: row.status,
    receiptKind: row.receiptKind,
    effectiveAt: row.effectiveAt,
    reason: decision.accepted ? "ok" : decision.reason,
    countsAsPublic: decision.countsAsPublic,
    interventionEffective: decision.accepted && effect.interventionEffective && row.effectiveAt !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toConnection(row: ExternalConnectionRecord, actions: readonly ExternalActionRecord[]): ExternalConnectionView {
  return {
    id: row.id,
    brandId: row.brandId,
    label: row.label,
    canRead: row.canRead === 1,
    canDraft: row.canDraft === 1,
    canPublish: row.canPublish === 1,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: actions.filter((action) => action.connectionId === row.id).map((action) => toAction(row, action)),
  };
}

function acceptedOutcome(input: Pick<SubmitActionInput, "remoteState" | "receiptKind" | "effectiveAt">): StoredOutcome | { error: "INVALID_INPUT" } {
  if (input.remoteState === null || input.remoteState === "unknown" || input.remoteState === "failed") {
    if (input.receiptKind !== null || input.effectiveAt !== null) return { error: "INVALID_INPUT" };
    return { status: input.remoteState ?? "confirmed", receiptKind: null, effectiveAt: null };
  }
  if (input.receiptKind === "draft_created" && input.effectiveAt === null) {
    return { status: "acknowledged", receiptKind: "draft_created", effectiveAt: null };
  }
  if (input.receiptKind === "public_url" && input.effectiveAt !== null) {
    return { status: "acknowledged", receiptKind: "public_url", effectiveAt: input.effectiveAt };
  }
  if (input.receiptKind === null && input.effectiveAt === null) {
    return { status: "acknowledged", receiptKind: null, effectiveAt: null };
  }
  return { error: "INVALID_INPUT" };
}

async function ownedConnection(dao: ExternalConnectionDao, brands: BrandDao, ownerId: string, connectionId: string, lock: boolean) {
  const connection = await dao.connectionForOwner(ownerId, connectionId, lock);
  if (!connection) return null;
  const owned = await brands.owned(ownerId, connection.brandId);
  return owned ? connection : null;
}

export async function listExternalConnections(db: DatabaseConnection, ownerId: string): Promise<ExternalConnectionList> {
  return db.transaction(async (tx) => {
    const dao = new ExternalConnectionDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const connections = await dao.connectionsForOwner(ownerId);
    const actions = await dao.actionsForConnections(ownerId, connections.map((row) => row.id));
    return { brands, connections: connections.map((row) => toConnection(row, actions)) };
  });
}

export async function listBrandConnections(db: DatabaseConnection, ownerId: string, brandId: string): Promise<BrandListResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new ExternalConnectionDao(tx);
    const connections = await dao.connectionsForBrand(ownerId, brandId);
    const actions = await dao.actionsForConnections(ownerId, connections.map((row) => row.id));
    return { connections: connections.map((row) => toConnection(row, actions)) };
  });
}

export async function getExternalConnection(db: DatabaseConnection, ownerId: string, connectionId: string): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const dao = new ExternalConnectionDao(tx);
    const connection = await ownedConnection(dao, new BrandDao(tx), ownerId, connectionId, false);
    if (!connection) return { error: "NOT_FOUND" as const };
    const actions = await dao.actionsForConnection(ownerId, connection.id);
    return { connection: toConnection(connection, actions) };
  });
}

export async function registerExternalConnection(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterConnectionInput,
  clock: Clock = systemClock,
): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const now = clock();
    const row: ExternalConnectionRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      label: input.label,
      canRead: bit(input.canRead),
      canDraft: bit(input.canDraft),
      canPublish: bit(input.canPublish),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await new ExternalConnectionDao(tx).insertConnection(row);
    return { connection: toConnection(row, []) };
  });
}

export async function updateExternalConnection(
  db: DatabaseConnection,
  ownerId: string,
  input: UpdateConnectionInput,
  clock: Clock = systemClock,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const dao = new ExternalConnectionDao(tx);
    const current = await ownedConnection(dao, new BrandDao(tx), ownerId, input.id, true);
    if (!current) return { error: "NOT_FOUND" as const };
    if (current.status === input.status) {
      const actions = await dao.actionsForConnection(ownerId, current.id);
      return { connection: toConnection(current, actions) };
    }
    if (input.status === "verified" && current.status !== "pending") return { error: "CONFLICT" as const };
    const now = clock();
    const saved = input.status === "verified"
      ? await dao.markVerified(ownerId, current.id, now)
      : await dao.markRevoked(ownerId, current.id, now);
    if (!saved) return { error: "CONFLICT" as const };
    const actions = await dao.actionsForConnection(ownerId, current.id);
    return { connection: toConnection({ ...current, status: input.status, updatedAt: now }, actions) };
  });
}

export async function submitExternalAction(
  db: DatabaseConnection,
  ownerId: string,
  connectionId: string,
  input: SubmitActionInput,
  clock: Clock = systemClock,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const dao = new ExternalConnectionDao(tx);
    const connection = await ownedConnection(dao, new BrandDao(tx), ownerId, connectionId, true);
    if (!connection) return { error: "NOT_FOUND" as const };
    const existing = await dao.actionByKey(ownerId, connection.id, input.idempotencyKey, true);
    if (existing && (existing.status === "acknowledged" || existing.status === "unknown")) {
      const decision = retryAction({ state: existing.status, sameKey: true });
      if (!decision.reconcile || decision.submit) return { error: "CONFLICT" as const };
      const now = clock();
      const saved = await dao.reconcile(ownerId, existing.id, now);
      if (!saved) return { error: "NOT_FOUND" as const };
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    if (existing?.status === "reconciled") {
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    if (connection.status === "revoked") return { error: "REVOKED" as const };
    const publish = requestPublish({ scopes: scopesOf(connection), confirmed: input.confirmed });
    const now = clock();
    if (!publish.accepted) {
      const confirmed = bit(input.confirmed);
      if (existing) {
        const saved = await dao.writeRefusal(ownerId, existing.id, confirmed, now);
        if (!saved) return { error: "NOT_FOUND" as const };
      } else {
        await dao.insertAction({
          id: randomUUID(),
          connectionId: connection.id,
          brandId: connection.brandId,
          ownerId,
          idempotencyKey: input.idempotencyKey,
          confirmed,
          status: "failed",
          receiptKind: null,
          effectiveAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    const outcome = acceptedOutcome(input);
    if ("error" in outcome) return outcome;
    if (existing) {
      const saved = await dao.writeOutcome(ownerId, existing.id, outcome, now);
      if (!saved) return { error: "NOT_FOUND" as const };
    } else {
      await dao.insertAction({
        id: randomUUID(),
        connectionId: connection.id,
        brandId: connection.brandId,
        ownerId,
        idempotencyKey: input.idempotencyKey,
        confirmed: 1,
        status: outcome.status,
        receiptKind: outcome.receiptKind,
        effectiveAt: outcome.effectiveAt,
        createdAt: now,
        updatedAt: now,
      });
    }
    const actions = await dao.actionsForConnection(ownerId, connection.id);
    return { connection: toConnection(connection, actions) };
  });
}

export async function retryExternalAction(
  db: DatabaseConnection,
  ownerId: string,
  connectionId: string,
  actionId: string,
  input: RetryActionInput,
  clock: Clock = systemClock,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const dao = new ExternalConnectionDao(tx);
    const connection = await ownedConnection(dao, new BrandDao(tx), ownerId, connectionId, true);
    if (!connection) return { error: "NOT_FOUND" as const };
    const action = await dao.actionForOwner(ownerId, actionId, true);
    if (!action || action.connectionId !== connection.id) return { error: "NOT_FOUND" as const };
    if (action.status === "acknowledged" || action.status === "unknown") {
      const decision = retryAction({ state: action.status, sameKey: true });
      if (!decision.reconcile || decision.submit) return { error: "CONFLICT" as const };
      const now = clock();
      const saved = await dao.reconcile(ownerId, action.id, now);
      if (!saved) return { error: "NOT_FOUND" as const };
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    if (action.status === "reconciled" || (input.remoteState === null && input.receiptKind === null && input.effectiveAt === null)) {
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    if (connection.status === "revoked") return { error: "REVOKED" as const };
    const publish = requestPublish({ scopes: scopesOf(connection), confirmed: action.confirmed === 1 });
    const now = clock();
    if (!publish.accepted) {
      const saved = await dao.writeRefusal(ownerId, action.id, action.confirmed, now);
      if (!saved) return { error: "NOT_FOUND" as const };
      const actions = await dao.actionsForConnection(ownerId, connection.id);
      return { connection: toConnection(connection, actions) };
    }
    const outcome = acceptedOutcome(input);
    if ("error" in outcome) return outcome;
    const saved = await dao.writeOutcome(ownerId, action.id, outcome, now);
    if (!saved) return { error: "NOT_FOUND" as const };
    const actions = await dao.actionsForConnection(ownerId, connection.id);
    return { connection: toConnection(connection, actions) };
  });
}
