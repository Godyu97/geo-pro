import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import type { BrandCommand, BrandErrorCode, BrandMutation } from "./contracts.ts";
import { BrandDao, type BrandRecord } from "./dao.ts";

type CommandResult = { mutation: BrandMutation } | { error: BrandErrorCode };

function brandResult(brand: Pick<BrandRecord, "id" | "status" | "revision" | "entityVersion">): CommandResult {
  const { id, status, revision, entityVersion } = brand;
  return { mutation: { kind: "brand", id, status, revision, entityVersion } };
}

async function applyCommand(
  dao: BrandDao, ownerId: string, id: string | null, current: BrandRecord | null,
  command: BrandCommand, time: string,
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

export async function executeBrandCommand(connection: DatabaseConnection, ownerId: string, command: BrandCommand): Promise<CommandResult> {
  if (command.actorId !== ownerId) return { error: "SESSION_CHANGED" };
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const brandId = "target" in command ? command.target?.brandId ?? null : command.brandId;

  // The owner lock serializes their writes in PostgreSQL. SQLite uses the
  // connection's BEGIN IMMEDIATE transaction, with the same consistency rules.
  return connection.transaction(async (transaction) => {
    const dao = new BrandDao(transaction);
    if (!await dao.lockOwner(ownerId)) return { error: "SESSION_REQUIRED" };
    const current = brandId ? await dao.owned(ownerId, brandId) : null;
    if (brandId && !current) return { error: "NOT_FOUND" };
    const previous = await dao.operation(ownerId, command.operationId);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? { mutation: previous.mutation }
        : { error: "OPERATION_CONFLICT" };
    }
    const time = new Date().toISOString();
    const result = await applyCommand(dao, ownerId, brandId, current, command, time);
    if ("mutation" in result) await dao.recordOperation(ownerId, command.operationId, fingerprint, result.mutation, time);
    return result;
  });
}
