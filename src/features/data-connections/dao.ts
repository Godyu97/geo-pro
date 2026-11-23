import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { dataConnectionListLimit } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const connectionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(80),
  status: z.enum(["preview", "approved"]),
  fieldCount: z.number().int().min(1).max(40),
  pullAttemptedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const fieldRow = z.object({
  connectionId: brandIdSchema,
  position: z.number().int().min(0).max(39),
  fieldName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
});

export type DataConnectionRecord = z.infer<typeof connectionRow> & {
  fieldNames: string[];
};

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
}
