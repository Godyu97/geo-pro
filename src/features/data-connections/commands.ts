import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { previewSync } from "./sync.ts";
import type { DataConnectionList, DataConnectionView, RegisterDataConnectionInput } from "./contracts.ts";
import { DataConnectionDao, type DataConnectionRecord } from "./dao.ts";

type Clock = () => string;
type CommandResult = { connection: DataConnectionView } | { error: "NOT_FOUND" | "PULL_BLOCKED" | "CONFLICT" };
type RegisterResult = { connection: DataConnectionView } | { error: "NOT_FOUND" };

const systemClock: Clock = () => new Date().toISOString();

function sameFields(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function toView(row: DataConnectionRecord): DataConnectionView {
  const preview = previewSync({ approved: row.status === "approved", fieldNames: row.fieldNames });
  return {
    id: row.id,
    brandId: row.brandId,
    displayName: row.displayName,
    status: row.status,
    fieldCount: row.fieldCount,
    fieldNames: preview.fields,
    pullAttemptedAt: row.pullAttemptedAt,
    preview,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedActive(brands: BrandDao, ownerId: string, brandId: string) {
  const brand = await brands.owned(ownerId, brandId);
  return brand?.status === "active" ? brand : null;
}

async function lockedConnection(dao: DataConnectionDao, brands: BrandDao, ownerId: string, connectionId: string) {
  const connection = await dao.connectionForOwner(ownerId, connectionId, true);
  if (!connection || !await ownedActive(brands, ownerId, connection.brandId)) return null;
  const fields = await dao.fieldsForConnection(ownerId, connection.id);
  const fieldNames = fields.map((field) => field.fieldName);
  if (fieldNames.length !== connection.fieldCount || fields.some((field, index) => field.position !== index)) {
    throw new Error("data-connection-field-count");
  }
  return { ...connection, fieldNames };
}

export async function listDataConnections(db: DatabaseConnection, ownerId: string): Promise<DataConnectionList> {
  return db.transaction(async (tx) => {
    const dao = new DataConnectionDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const connections = await dao.connectionsForOwner(ownerId);
    return { brands, connections: connections.map(toView) };
  });
}

export async function registerDataConnection(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterDataConnectionInput,
  clock: Clock = systemClock,
): Promise<RegisterResult> {
  const preview = previewSync({ approved: false, fieldNames: input.fieldNames });
  if (preview.pull || !sameFields(preview.fields, input.fieldNames)) return { error: "NOT_FOUND" };
  return db.transaction(async (tx) => {
    const owned = await ownedActive(new BrandDao(tx), ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const id = randomUUID();
    const row: DataConnectionRecord = {
      id,
      brandId: input.brandId,
      ownerId,
      displayName: input.displayName,
      status: "preview",
      fieldCount: input.fieldNames.length,
      fieldNames: [...input.fieldNames],
      pullAttemptedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const dao = new DataConnectionDao(tx);
    await dao.insertConnection(row);
    await dao.insertFields(input.fieldNames.map((fieldName, position) => ({
      id: randomUUID(),
      connectionId: id,
      brandId: input.brandId,
      ownerId,
      position,
      fieldName,
    })));
    return { connection: toView(row) };
  });
}

export async function approveDataConnection(
  db: DatabaseConnection,
  ownerId: string,
  connectionId: string,
  clock: Clock = systemClock,
): Promise<CommandResult> {
  return db.transaction(async (tx) => {
    const dao = new DataConnectionDao(tx);
    const current = await lockedConnection(dao, new BrandDao(tx), ownerId, connectionId);
    if (!current) return { error: "NOT_FOUND" as const };
    const preview = previewSync({ approved: true, fieldNames: current.fieldNames });
    if (!preview.pull || !sameFields(preview.fields, current.fieldNames)) return { error: "CONFLICT" as const };
    if (current.status === "approved") return { connection: toView(current) };
    const now = clock();
    const saved = await dao.markApproved(ownerId, current.id, now);
    if (!saved) return { error: "CONFLICT" as const };
    return { connection: toView({ ...current, status: "approved", updatedAt: now }) };
  });
}

export async function pullDataConnection(
  db: DatabaseConnection,
  ownerId: string,
  connectionId: string,
  clock: Clock = systemClock,
): Promise<CommandResult> {
  return db.transaction(async (tx) => {
    const dao = new DataConnectionDao(tx);
    const current = await lockedConnection(dao, new BrandDao(tx), ownerId, connectionId);
    if (!current) return { error: "NOT_FOUND" as const };
    const preview = previewSync({ approved: current.status === "approved", fieldNames: current.fieldNames });
    if (!preview.pull || current.status !== "approved" || !sameFields(preview.fields, current.fieldNames)) {
      return { error: "PULL_BLOCKED" as const };
    }
    if (current.pullAttemptedAt) return { connection: toView(current) };
    const now = clock();
    const saved = await dao.recordPull(ownerId, current.id, now);
    if (!saved) return { error: "CONFLICT" as const };
    return { connection: toView({ ...current, pullAttemptedAt: now, updatedAt: now }) };
  });
}
