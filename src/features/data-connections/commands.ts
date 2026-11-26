import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { prepareLeadRow } from "../business-feedback/contracts.ts";
import { writeBusinessLeads } from "../business-feedback/commands.ts";
import { ConnectorEventDao } from "./event-dao.ts";
import { writeConnectorEvents } from "./event-commands.ts";
import { SyncAuthorizationDao } from "./revocation-dao.ts";
import { previewSync, syncBatchPayloadDigest } from "./sync.ts";
import {
  syncDataConnectionSchema,
  type DataConnectionList,
  type DataConnectionSourceName,
  type DataConnectionView,
  type RegisterDataConnectionInput,
} from "./contracts.ts";
import { DataConnectionDao, isMissingHistoricalReceipts, type DataConnectionRecord } from "./dao.ts";

type Clock = () => string;
type CommandResult = { connection: DataConnectionView } | { error: "NOT_FOUND" | "PULL_BLOCKED" | "CONFLICT" };
type SyncError = "NOT_FOUND" | "INVALID_INPUT" | "PULL_BLOCKED" | "SYNC_BLOCKED" | "SYNC_STOPPED" | "CONFLICT";
type RegisterResult = { connection: DataConnectionView } | { error: "NOT_FOUND" };

const systemClock: Clock = () => new Date().toISOString();

function sameFields(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function toView(
  row: DataConnectionRecord,
  sources: readonly { source: DataConnectionSourceName }[] = [],
  missingHistoricalReceipts = false,
): DataConnectionView {
  const preview = previewSync({ approved: row.status === "approved", fieldNames: row.fieldNames });
  return {
    id: row.id,
    brandId: row.brandId,
    displayName: row.displayName,
    status: row.status,
    fieldCount: row.fieldCount,
    fieldNames: preview.fields,
    pullAttemptedAt: row.pullAttemptedAt,
    syncCursor: row.syncCursor,
    coverageComplete: row.coverageComplete === null ? null : row.coverageComplete === 1,
    syncStopped: row.syncStopped === 1,
    missingHistoricalReceipts,
    sources: sources.map((source) => ({ source: source.source })),
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
    const receiptStates = await dao.receiptStatesForConnections(ownerId, connections);
    const sourceRows = await new ConnectorEventDao(tx).sourcesByBrand(ownerId, [...new Set(connections.map((row) => row.brandId))]);
    const sourcesByBrand = new Map<string, { source: DataConnectionSourceName }[]>();
    for (const row of sourceRows) {
      const list = sourcesByBrand.get(row.brandId) ?? [];
      list.push({ source: row.source });
      sourcesByBrand.set(row.brandId, list);
    }
    return {
      brands,
      connections: connections.map((row) => toView(
        row,
        sourcesByBrand.get(row.brandId) ?? [],
        isMissingHistoricalReceipts(row.syncCursor, receiptStates.get(row.id)),
      )),
    };
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
      syncCursor: null,
      coverageComplete: null,
      syncStopped: 0,
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
    if (current.pullAttemptedAt) {
      const receiptStates = await dao.receiptStatesForConnections(ownerId, [current]);
      return {
        connection: toView(
          current,
          await sourceLabels(tx, ownerId, current.brandId),
          isMissingHistoricalReceipts(current.syncCursor, receiptStates.get(current.id)),
        ),
      };
    }
    const now = clock();
    const saved = await dao.recordPull(ownerId, current.id, now);
    if (!saved) return { error: "CONFLICT" as const };
    const receiptStates = await dao.receiptStatesForConnections(ownerId, [current]);
    return {
      connection: toView(
        { ...current, pullAttemptedAt: now, updatedAt: now },
        await sourceLabels(tx, ownerId, current.brandId),
        isMissingHistoricalReceipts(current.syncCursor, receiptStates.get(current.id)),
      ),
    };
  });
}

async function sourceLabels(tx: ConstructorParameters<typeof ConnectorEventDao>[0], ownerId: string, brandId: string) {
  const rows = await new ConnectorEventDao(tx).sourcesByBrand(ownerId, [brandId]);
  return rows.map((row) => ({ source: row.source }));
}

export async function readBrandSyncSurface(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  eventIds: readonly string[],
) {
  return db.transaction(async (tx) => {
    const dao = new DataConnectionDao(tx);
    const rows = await dao.syncRowsForBrand(ownerId, brandId);
    const receiptStates = await dao.receiptStatesForConnections(ownerId, rows);
    const sources = await new ConnectorEventDao(tx).sourcesForEvents(ownerId, brandId, eventIds);
    return {
      connections: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        syncCursor: row.syncCursor,
        coverageComplete: row.coverageComplete === null ? null : row.coverageComplete === 1,
        syncStopped: row.syncStopped === 1,
        missingHistoricalReceipts: isMissingHistoricalReceipts(row.syncCursor, receiptStates.get(row.id)),
      })),
      sources,
    };
  });
}

export async function syncDataConnection(
  db: DatabaseConnection,
  ownerId: string,
  connectionId: string,
  body: unknown,
  clock: Clock = systemClock,
): Promise<{ connection: DataConnectionView; replayed: boolean } | { error: SyncError }> {
  return db.transaction(async (tx) => {
    const dao = new DataConnectionDao(tx);
    const current = await lockedConnection(dao, new BrandDao(tx), ownerId, connectionId);
    if (!current) return { error: "NOT_FOUND" as const };
    const parsed = syncDataConnectionSchema.safeParse(body);
    if (!parsed.success) return { error: "INVALID_INPUT" as const };
    const input = parsed.data;
    const blocked = input.events.some((event) => prepareLeadRow({
      eventId: event.eventKey,
      evidence: event.evidence,
      directIdentifier: false,
    }).directIdentifier);
    if (blocked) return { error: "INVALID_INPUT" as const };
    const preview = previewSync({ approved: current.status === "approved", fieldNames: current.fieldNames });
    if (!preview.pull || current.status !== "approved" || !sameFields(preview.fields, current.fieldNames)) {
      return { error: "PULL_BLOCKED" as const };
    }
    const authorization = await new SyncAuthorizationDao(tx).authorizationForSource(
      ownerId,
      current.brandId,
      current.displayName,
      true,
    );
    if (!authorization) return { error: "SYNC_BLOCKED" as const };
    const now = clock();
    if (authorization.revoked === 1 || current.syncStopped === 1) {
      await new SyncAuthorizationDao(tx).insertAttempts([{
        id: randomUUID(),
        authorizationId: authorization.id,
        brandId: current.brandId,
        ownerId,
        result: "stopped",
        attemptedAt: now,
      }]);
      if (current.syncStopped === 0) {
        const stopped = await dao.markSyncStopped(ownerId, current.id, now);
        if (!stopped) throw new Error("data-connection-sync-stopped");
      }
      return { error: "SYNC_STOPPED" as const };
    }
    const payloadDigest = syncBatchPayloadDigest(input);
    const existingBatch = await dao.findSyncBatchByCursor(ownerId, current.id, input.cursor);
    const receiptStates = await dao.receiptStatesForConnections(ownerId, [current]);
    const missingReceipts = isMissingHistoricalReceipts(current.syncCursor, receiptStates.get(current.id));
    const sources = await sourceLabels(tx, ownerId, current.brandId);

    if (current.syncCursor === input.cursor) {
      if (
        input.expectedCursor !== undefined
        && input.expectedCursor !== current.syncCursor
        && existingBatch
        && existingBatch.payloadDigest !== payloadDigest
      ) {
        return { error: "CONFLICT" as const };
      }
      return { connection: toView(current, sources, missingReceipts), replayed: true };
    }
    if (existingBatch) {
      if (existingBatch.payloadDigest === payloadDigest) {
        return { connection: toView(current, sources, missingReceipts), replayed: true };
      }
      return { error: "CONFLICT" as const };
    }
    if (input.expectedCursor !== undefined && input.expectedCursor !== current.syncCursor) {
      return { error: "CONFLICT" as const };
    }

    if (input.events.length > 0) {
      await writeConnectorEvents(tx, ownerId, {
        brandId: current.brandId,
        rows: input.events.map((event) => ({
          eventKey: event.eventKey,
          source: "connector" as const,
          payloadDigest: event.payloadDigest,
        })),
      }, clock);
      const leads = await writeBusinessLeads(tx, ownerId, {
        brandId: current.brandId,
        rows: input.events.map((event) => ({
          eventId: event.eventKey,
          evidence: event.evidence,
          directIdentifier: false,
        })),
      }, clock);
      if (leads.rejected.length > 0) throw new Error("data-connection-lead-rejected");
    }
    const advanced = await dao.advanceCursor(
      ownerId,
      current.id,
      current.syncCursor,
      input.cursor,
      input.coverageComplete ? 1 : 0,
      now,
    );
    if (!advanced) throw new Error("data-connection-cursor");
    await dao.insertSyncBatch({
      id: randomUUID(),
      connectionId: current.id,
      brandId: current.brandId,
      ownerId,
      cursor: input.cursor,
      previousCursor: current.syncCursor,
      payloadDigest,
      coverageComplete: input.coverageComplete ? 1 : 0,
      syncedAt: now,
    });
    await new SyncAuthorizationDao(tx).insertAttempts([{
      id: randomUUID(),
      authorizationId: authorization.id,
      brandId: current.brandId,
      ownerId,
      result: "allowed",
      attemptedAt: now,
    }]);
    const saved = await dao.connectionForOwner(ownerId, current.id, false);
    if (!saved || saved.syncCursor !== input.cursor) throw new Error("data-connection-cursor");
    const nextReceiptStates = await dao.receiptStatesForConnections(ownerId, [saved]);
    return {
      connection: toView(
        { ...current, ...saved, fieldNames: current.fieldNames },
        await sourceLabels(tx, ownerId, current.brandId),
        isMissingHistoricalReceipts(saved.syncCursor, nextReceiptStates.get(current.id)),
      ),
      replayed: false,
    };
  });
}
