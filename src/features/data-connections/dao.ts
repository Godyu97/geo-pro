import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { dataConnectionListLimit } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const flag = z.union([z.literal(0), z.literal(1)]);
const syncCursorSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const payloadDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const connectionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(80),
  status: z.enum(["preview", "approved"]),
  fieldCount: z.number().int().min(1).max(40),
  pullAttemptedAt: timestampSchema.nullable(),
  syncCursor: syncCursorSchema.nullable(),
  coverageComplete: flag.nullable(),
  syncStopped: flag,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const fieldRow = z.object({
  connectionId: brandIdSchema,
  position: z.number().int().min(0).max(39),
  fieldName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
});

const syncBatchRow = z.object({
  id: brandIdSchema,
  connectionId: brandIdSchema,
  cursor: syncCursorSchema,
  previousCursor: syncCursorSchema.nullable(),
  payloadDigest: payloadDigestSchema,
  coverageComplete: flag,
  syncedAt: timestampSchema,
});

const receiptStateRow = z.object({
  connectionId: brandIdSchema,
  hasOrigin: flag,
  hasCurrent: flag,
});

export type DataConnectionRecord = z.infer<typeof connectionRow> & {
  fieldNames: string[];
};

export type SyncBatchRecord = z.infer<typeof syncBatchRow>;
export type SyncBatchReceiptState = z.infer<typeof receiptStateRow>;

export type SyncBatchInsert = {
  id: string;
  connectionId: string;
  brandId: string;
  ownerId: string;
  cursor: string;
  previousCursor: string | null;
  payloadDigest: string;
  coverageComplete: 0 | 1;
  syncedAt: string;
};

export function isMissingHistoricalReceipts(
  syncCursor: string | null,
  state: Pick<SyncBatchReceiptState, "hasOrigin" | "hasCurrent"> | undefined,
) {
  if (syncCursor === null) return false;
  return !state || state.hasOrigin !== 1 || state.hasCurrent !== 1;
}

export type DataConnectionFieldInsert = {
  id: string;
  connectionId: string;
  brandId: string;
  ownerId: string;
  position: number;
  fieldName: string;
};

const connectionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", display_name AS "displayName",
  status, field_count AS "fieldCount", pull_attempted_at AS "pullAttemptedAt",
  sync_cursor AS "syncCursor", coverage_complete AS "coverageComplete", sync_stopped AS "syncStopped",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

function attachFields(
  connections: readonly z.infer<typeof connectionRow>[],
  fields: readonly z.infer<typeof fieldRow>[],
): DataConnectionRecord[] {
  const grouped = new Map<string, z.infer<typeof fieldRow>[]>();
  for (const field of fields) {
    const list = grouped.get(field.connectionId) ?? [];
    list.push(field);
    grouped.set(field.connectionId, list);
  }
  return connections.map((connection) => {
    const ordered = [...(grouped.get(connection.id) ?? [])].sort((left, right) => left.position - right.position);
    if (ordered.length !== connection.fieldCount || ordered.some((field, index) => field.position !== index)) {
      throw new Error("data-connection-field-count");
    }
    return { ...connection, fieldNames: ordered.map((field) => field.fieldName) };
  });
}

export function ownedBrandQuery(ownerId: string) {
  return {
    sql: `SELECT id FROM brand
      WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, 20] as QueryValue[],
  };
}

export function dataConnectionOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${connectionColumns} FROM data_connection
      WHERE owner_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, dataConnectionListLimit] as QueryValue[],
  };
}

export function dataConnectionFieldsQuery(ownerId: string, connectionIds: readonly string[]) {
  if (connectionIds.length === 0) {
    return {
      sql: `SELECT connection_id AS "connectionId", position, field_name AS "fieldName"
        FROM data_connection_field
        WHERE owner_id = ? AND 1 = 0
        LIMIT ?`,
      values: [ownerId, dataConnectionListLimit * 40] as QueryValue[],
    };
  }
  return {
    sql: `SELECT connection_id AS "connectionId", position, field_name AS "fieldName"
      FROM data_connection_field
      WHERE owner_id = ? AND connection_id IN (${connectionIds.map(() => "?").join(", ")})
      ORDER BY connection_id ASC, position ASC
      LIMIT ?`,
    values: [ownerId, ...connectionIds, dataConnectionListLimit * 40] as QueryValue[],
  };
}

export function syncBatchByCursorQuery(ownerId: string, connectionId: string, cursor: string) {
  return {
    sql: `SELECT id, connection_id AS "connectionId", cursor, previous_cursor AS "previousCursor",
        payload_digest AS "payloadDigest", coverage_complete AS "coverageComplete", synced_at AS "syncedAt"
      FROM data_connection_sync_batch
      WHERE owner_id = ? AND connection_id = ? AND cursor = ?
      LIMIT 1`,
    values: [ownerId, connectionId, cursor] as QueryValue[],
  };
}

export function syncBatchReceiptStatesQuery(
  ownerId: string,
  connections: readonly { id: string; syncCursor: string | null }[],
) {
  const active = connections.filter((row): row is { id: string; syncCursor: string } => row.syncCursor !== null);
  if (active.length === 0) {
    return {
      sql: `SELECT connection_id AS "connectionId", 0 AS "hasOrigin", 0 AS "hasCurrent"
        FROM data_connection_sync_batch
        WHERE owner_id = ? AND 1 = 0
        LIMIT ?`,
      values: [ownerId, dataConnectionListLimit] as QueryValue[],
    };
  }
  const currentMatches = active.map(() => "(connection_id = ? AND cursor = ?)").join(" OR ");
  return {
    sql: `SELECT connection_id AS "connectionId",
        MAX(CASE WHEN previous_cursor IS NULL THEN 1 ELSE 0 END) AS "hasOrigin",
        MAX(CASE WHEN (${currentMatches}) THEN 1 ELSE 0 END) AS "hasCurrent"
      FROM data_connection_sync_batch
      WHERE owner_id = ? AND connection_id IN (${active.map(() => "?").join(", ")})
      GROUP BY connection_id
      LIMIT ?`,
    values: [
      ...active.flatMap((row) => [row.id, row.syncCursor]),
      ownerId,
      ...active.map((row) => row.id),
      dataConnectionListLimit,
    ] as QueryValue[],
  };
}

export class DataConnectionDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const query = ownedBrandQuery(ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async insertConnection(row: Omit<DataConnectionRecord, "fieldNames">) {
    await queryWithParameters(
      this.db,
      `INSERT INTO data_connection (
        id, brand_id, owner_id, display_name, status, field_count, pull_attempted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.displayName, row.status, row.fieldCount, row.pullAttemptedAt,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async insertFields(rows: readonly DataConnectionFieldInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO data_connection_field (
        id, connection_id, brand_id, owner_id, position, field_name
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [row.id, row.connectionId, row.brandId, row.ownerId, row.position, row.fieldName]),
    );
  }

  async connectionForOwner(ownerId: string, connectionId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${connectionColumns} FROM data_connection WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [connectionId, ownerId],
    );
    return row ? connectionRow.parse(row) : null;
  }

  async fieldsForConnection(ownerId: string, connectionId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT connection_id AS "connectionId", position, field_name AS "fieldName"
       FROM data_connection_field
       WHERE owner_id = ? AND connection_id = ?
       ORDER BY position ASC
       LIMIT ?`,
      [ownerId, connectionId, 40],
    );
    return z.array(fieldRow).parse(rows);
  }

  async connectionsForOwner(ownerId: string) {
    const query = dataConnectionOwnerQuery(ownerId);
    const connections = z.array(connectionRow).parse(await queryWithParameters(this.db, query.sql, query.values));
    if (connections.length === 0) return [];
    const fieldsQuery = dataConnectionFieldsQuery(ownerId, connections.map((row) => row.id));
    const fields = z.array(fieldRow).parse(await queryWithParameters(this.db, fieldsQuery.sql, fieldsQuery.values));
    return attachFields(connections, fields);
  }

  async markApproved(ownerId: string, connectionId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE data_connection SET status = 'approved', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'preview' AND pull_attempted_at IS NULL
       RETURNING id`,
      [updatedAt, connectionId, ownerId],
    );
    return rows.length === 1;
  }

  async recordPull(ownerId: string, connectionId: string, attemptedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE data_connection SET pull_attempted_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'approved' AND pull_attempted_at IS NULL
       RETURNING id`,
      [attemptedAt, attemptedAt, connectionId, ownerId],
    );
    return rows.length === 1;
  }

  async syncRowsForBrand(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, display_name AS "displayName", sync_cursor AS "syncCursor",
         coverage_complete AS "coverageComplete", sync_stopped AS "syncStopped"
       FROM data_connection
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id ASC
       LIMIT ?`,
      [ownerId, brandId, dataConnectionListLimit],
    );
    return z.array(connectionRow.pick({
      id: true,
      displayName: true,
      syncCursor: true,
      coverageComplete: true,
      syncStopped: true,
    })).parse(rows);
  }

  async advanceCursor(
    ownerId: string,
    connectionId: string,
    expectedCursor: string | null,
    cursor: string,
    coverageComplete: 0 | 1,
    updatedAt: string,
  ) {
    const cursorCondition = expectedCursor === null ? "sync_cursor IS NULL" : "sync_cursor = ?";
    const values: QueryValue[] = expectedCursor === null
      ? [cursor, coverageComplete, updatedAt, connectionId, ownerId, cursor]
      : [cursor, coverageComplete, updatedAt, connectionId, ownerId, expectedCursor, cursor];
    const rows = await queryWithParameters(
      this.db,
      `UPDATE data_connection
       SET sync_cursor = ?, coverage_complete = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'approved' AND sync_stopped = 0
         AND ${cursorCondition}
         AND (sync_cursor IS NULL OR sync_cursor <> ?)
       RETURNING id`,
      values,
    );
    return rows.length === 1;
  }

  async findSyncBatchByCursor(ownerId: string, connectionId: string, cursor: string) {
    const query = syncBatchByCursorQuery(ownerId, connectionId, cursor);
    const [row] = await queryWithParameters(this.db, query.sql, query.values);
    return row ? syncBatchRow.parse(row) : null;
  }

  async insertSyncBatch(row: SyncBatchInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO data_connection_sync_batch (
        id, connection_id, brand_id, owner_id, cursor, previous_cursor, payload_digest, coverage_complete, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.connectionId, row.brandId, row.ownerId, row.cursor, row.previousCursor,
        row.payloadDigest, row.coverageComplete, row.syncedAt,
      ],
    );
  }

  async receiptStatesForConnections(
    ownerId: string,
    connections: readonly { id: string; syncCursor: string | null }[],
  ) {
    if (!connections.some((row) => row.syncCursor !== null)) return new Map<string, SyncBatchReceiptState>();
    const query = syncBatchReceiptStatesQuery(ownerId, connections);
    const rows = z.array(receiptStateRow).parse(await queryWithParameters(this.db, query.sql, query.values));
    return new Map(rows.map((row) => [row.connectionId, row]));
  }

  async markSyncStopped(ownerId: string, connectionId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE data_connection SET sync_stopped = 1, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'approved'
       RETURNING id`,
      [updatedAt, connectionId, ownerId],
    );
    return rows.length === 1;
  }
}
