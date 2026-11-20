import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { invalidateEvidenceOverview } from "../evidence/overview-cache.ts";
import { hasVerifiedEmail } from "../../lib/auth/verified-email.ts";
import { MaintenanceDao } from "../maintenance/dao.ts";
import { brandDeadlineSchema, type BrandCommand, type BrandErrorCode, type BrandMutation } from "./contracts.ts";
import { BrandDao, type BrandRecord } from "./dao.ts";
import { PurgeDao } from "./purge-dao.ts";

type CommandResult = { mutation: BrandMutation } | { error: BrandErrorCode };
type DeletionState = NonNullable<Awaited<ReturnType<BrandDao["deletionState"]>>>;
export type BrandRecoverySession = { emailVerified: boolean; createdAt: Date };
const dayMs = 24 * 60 * 60 * 1000;
const recoveryLoginMs = 5 * 60 * 1000;

export function brandRecoveryError(brand: { frozenAt: string; restoreUntil: string }, session: BrandRecoverySession | undefined, now: Date) {
  if (now.getTime() >= Date.parse(brand.restoreUntil)) return "RECOVERY_EXPIRED";
  if (!hasVerifiedEmail(session)) return "IDENTITY_UNVERIFIED";
  const loginTime = session.createdAt.getTime();
  if (!(loginTime > Date.parse(brand.frozenAt) && loginTime <= now.getTime() && now.getTime() - loginTime < recoveryLoginMs)) {
    return "REAUTH_REQUIRED";
  }
  return null;
}

function deletionResult(id: string, revision: number, restoreUntil: string | null): CommandResult {
  return { mutation: { kind: "deletion", id, revision, restoreUntil } };
}

async function applyDeletion(
  dao: BrandDao, ownerId: string, current: DeletionState, command: Extract<BrandCommand, { action: "freeze" | "recover" }>,
  now: Date, session?: BrandRecoverySession,
): Promise<CommandResult> {
  if (current.revision !== command.expectedBrandRevision) return { error: "VERSION_CONFLICT" };
  if (command.action === "freeze") {
    if (current.frozenAt !== null) return { error: "NOT_FOUND" };
    const restoreUntil = new Date(now.getTime() + 30 * dayMs).toISOString();
    const revision = await dao.updateDeletion(ownerId, current, now.toISOString(), restoreUntil);
    if (!revision) return { error: "VERSION_CONFLICT" };
    await dao.rebaseDraft(ownerId, current.id, current.revision, revision);
    return deletionResult(current.id, revision, restoreUntil);
  }
  if (!current.frozenAt || !current.restoreUntil) return { error: "NOT_FOUND" };
  const error = brandRecoveryError({ frozenAt: current.frozenAt, restoreUntil: current.restoreUntil }, session, now);
  if (error) return { error };
  if (current.status === "active" && await dao.active(ownerId)) return { error: "LIMIT_REACHED" };
  const revision = await dao.updateDeletion(ownerId, current, null, null);
  if (!revision) return { error: "VERSION_CONFLICT" };
  await dao.rebaseDraft(ownerId, current.id, current.revision, revision);
  return deletionResult(current.id, revision, null);
}

function brandResult(brand: Pick<BrandRecord, "id" | "status" | "revision" | "entityVersion">): CommandResult {
  const { id, status, revision, entityVersion } = brand;
  return { mutation: { kind: "brand", id, status, revision, entityVersion } };
}

async function applyCommand(
  dao: BrandDao, ownerId: string, id: string | null, current: BrandRecord | null,
  command: Exclude<BrandCommand, { action: "freeze" | "recover" }>, time: string,
): Promise<CommandResult> {
  if (command.action === "archive" || command.action === "restore") {
    if (!current) return { error: "NOT_FOUND" };
    const status = command.action === "archive" ? "archived" : "active";
    if (current.status === status || current.revision !== command.expectedBrandRevision) return { error: "VERSION_CONFLICT" };
    if (status === "active" && await dao.active(ownerId)) return { error: "LIMIT_REACHED" };
    const updated = await dao.updateBrand(ownerId, current, status, current.entityVersion);
    return updated ? brandResult(updated) : { error: "VERSION_CONFLICT" };
  }

  if (command.action !== "discardDraft" && !current && await dao.active(ownerId)) return { error: "LIMIT_REACHED" };
  const scope = id ?? "new";
  const draft = await dao.draft(ownerId, scope);
  if ((draft?.version ?? null) !== command.expectedDraft) return { error: "VERSION_CONFLICT" };
  if (command.action === "discardDraft") {
    await dao.deleteDraft(ownerId, scope);
    return { mutation: { kind: "draft", version: null } };
  }

  if (current) {
    if (current.status !== "active" || command.target?.expectedBrandRevision !== current.revision ||
      (draft && draft.baseRevision !== current.revision)) return { error: "VERSION_CONFLICT" };
  }

  if (command.action === "saveDraft") {
    await dao.saveDraft(ownerId, scope, command.operationId, current?.revision ?? null, command.step, command.fields, time);
    return { mutation: { kind: "draft", version: command.operationId } };
  }

  if (current) {
    const updated = await dao.updateBrand(ownerId, current, "active", current.entityVersion + 1);
    if (!updated) return { error: "VERSION_CONFLICT" };
    await dao.insertVersion(updated.id, updated.entityVersion, command.fields, time);
    if (draft) await dao.deleteDraft(ownerId, scope);
    return brandResult(updated);
  }

  const brandId = randomUUID();
  await dao.insertBrand(ownerId, brandId, time);
  await dao.insertVersion(brandId, 1, command.fields, time);
  if (draft) await dao.deleteDraft(ownerId, scope);
  return brandResult({ id: brandId, status: "active", revision: 1, entityVersion: 1 });
}

export async function executeBrandCommand(
  connection: DatabaseConnection, ownerId: string, command: BrandCommand,
  session?: BrandRecoverySession, clock = () => new Date(), cache?: CacheStore,
): Promise<CommandResult> {
  if (command.actorId !== ownerId) return { error: "SESSION_CHANGED" };
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const brandId = "target" in command ? command.target?.brandId ?? null : command.brandId;

  // The owner lock serializes their writes in PostgreSQL. SQLite uses the
  // connection's BEGIN IMMEDIATE transaction, with the same consistency rules.
  const committed = await connection.transaction(async (transaction): Promise<CommandResult> => {
    const dao = new BrandDao(transaction);
    if (!await dao.lockOwner(ownerId)) return { error: "SESSION_REQUIRED" };
    const deletion = command.action === "freeze" || command.action === "recover";
    const state = deletion ? await dao.deletionState(ownerId, command.brandId) : null;
    if (command.action === "recover" && state && await new PurgeDao(transaction).receipt({ ownerId, brandId: command.brandId })) {
      return { error: "RECOVERY_EXPIRED" };
    }
    const current = !deletion && brandId ? await dao.owned(ownerId, brandId) : null;
    if (brandId && !state && !current) return { error: "NOT_FOUND" };
    const previous = await dao.operation(ownerId, command.operationId);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? { mutation: previous.mutation }
        : { error: "OPERATION_CONFLICT" };
    }
    const now = clock();
    const result = command.action === "freeze" || command.action === "recover"
      ? state ? await applyDeletion(dao, ownerId, state, command, now, session) : { error: "NOT_FOUND" } as const
      : await applyCommand(dao, ownerId, brandId, current, command, now.toISOString());
    if ("mutation" in result) {
      const scope = result.mutation.kind === "draft" ? brandId ?? "new" : result.mutation.id;
      await dao.recordOperation(ownerId, command.operationId, fingerprint, result.mutation, now.toISOString(), scope);
    }
    return result;
  });
  if ("mutation" in committed && committed.mutation.kind !== "draft") {
    await invalidateEvidenceOverview(ownerId, committed.mutation.id, cache ?? openCache());
  }
  return committed;
}

// Controlled server CLI only. The operator verifies the earlier request using
// the approved private process and supplies its opaque request ID for audit.
export async function shortenBrandRecoveryDeadline(connection: DatabaseConnection, input: unknown, clock = () => new Date()): Promise<CommandResult> {
  const parsed = brandDeadlineSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const { ownerId, brandId, requestId, operatorId, expectedBrandRevision, restoreUntil } = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify(["shorten-recovery", parsed.data])).digest("hex");
  return connection.transaction(async (transaction) => {
    const dao = new BrandDao(transaction);
    const accounts = await new MaintenanceDao(transaction).lockAccounts([ownerId, operatorId]);
    if (!accounts.includes(ownerId) || !accounts.includes(operatorId)) return { error: "NOT_FOUND" };
    const current = await dao.deletionState(ownerId, brandId);
    if (!current) return { error: "NOT_FOUND" };
    if (await new PurgeDao(transaction).receipt({ ownerId, brandId })) return { error: "RECOVERY_EXPIRED" };
    const previous = await dao.operation(ownerId, requestId);
    if (previous) return previous.fingerprint === fingerprint ? { mutation: previous.mutation } : { error: "OPERATION_CONFLICT" };
    if (!current.frozenAt || !current.restoreUntil) return { error: "NOT_FOUND" };
    if (current.revision !== expectedBrandRevision) return { error: "VERSION_CONFLICT" };
    if (restoreUntil >= current.restoreUntil) return { error: "INVALID_INPUT" };
    const revision = await dao.updateDeletion(ownerId, current, current.frozenAt, restoreUntil);
    if (!revision) return { error: "VERSION_CONFLICT" };
    await dao.rebaseDraft(ownerId, brandId, current.revision, revision);
    const mutation = { kind: "deletion", id: brandId, revision, restoreUntil, operatorId } as const;
    await dao.recordOperation(ownerId, requestId, fingerprint, mutation, clock().toISOString(), brandId);
    return { mutation };
  });
}
