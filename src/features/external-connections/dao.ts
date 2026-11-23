import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { externalActionListLimit, externalConnectionListLimit } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });
const bit = z.union([z.literal(0), z.literal(1)]);

const connectionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  canRead: bit,
  canDraft: bit,
  canPublish: bit,
  status: z.enum(["pending", "verified", "revoked"]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const actionRow = z.object({
  id: brandIdSchema,
  connectionId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(8).max(80),
  confirmed: bit,
  status: z.enum(["confirmed", "acknowledged", "unknown", "failed", "reconciled"]),
  receiptKind: z.enum(["draft_created", "public_url"]).nullable(),
  effectiveAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type ExternalConnectionRecord = z.infer<typeof connectionRow>;
export type ExternalActionRecord = z.infer<typeof actionRow>;

export type ExternalActionInsert = {
  id: string;
  connectionId: string;
  brandId: string;
  ownerId: string;
  idempotencyKey: string;
  confirmed: 0 | 1;
  status: "confirmed" | "acknowledged" | "unknown" | "failed";
  receiptKind: "draft_created" | "public_url" | null;
  effectiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const connectionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", label,
  can_read AS "canRead", can_draft AS "canDraft", can_publish AS "canPublish", status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const actionColumns = `id, connection_id AS "connectionId", brand_id AS "brandId", owner_id AS "ownerId",
  idempotency_key AS "idempotencyKey", confirmed, status, receipt_kind AS "receiptKind",
  effective_at AS "effectiveAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export function ownedBrandQuery(ownerId: string) {
  return {
    sql: `SELECT id FROM brand
      WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, 20] as QueryValue[],
  };
}

export function externalConnectionListQuery(ownerId: string) {
  return {
    sql: `SELECT ${connectionColumns} FROM external_connection
      WHERE owner_id = ?
      ORDER BY brand_id ASC, created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, externalConnectionListLimit] as QueryValue[],
  };
}

export function externalConnectionBrandQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${connectionColumns} FROM external_connection
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, externalConnectionListLimit] as QueryValue[],
  };
}

export function externalActionListQuery(ownerId: string, connectionId: string) {
  return {
    sql: `SELECT ${actionColumns} FROM external_action
      WHERE owner_id = ? AND connection_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, connectionId, externalActionListLimit] as QueryValue[],
  };
}

export function externalActionsQuery(ownerId: string, connectionIds: readonly string[]) {
  if (connectionIds.length === 0) return null;
  return {
    sql: `SELECT ${actionColumns} FROM external_action
      WHERE owner_id = ? AND connection_id IN (${connectionIds.map(() => "?").join(", ")})
      ORDER BY connection_id ASC, created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, ...connectionIds, externalActionListLimit] as QueryValue[],
  };
}

export class ExternalConnectionDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const query = ownedBrandQuery(ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async insertConnection(row: ExternalConnectionRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO external_connection (
        id, brand_id, owner_id, label, can_read, can_draft, can_publish, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.label, row.canRead, row.canDraft, row.canPublish, row.status,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async insertAction(row: ExternalActionInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO external_action (
        id, connection_id, brand_id, owner_id, idempotency_key, confirmed, status, receipt_kind, effective_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.connectionId, row.brandId, row.ownerId, row.idempotencyKey, row.confirmed, row.status,
        row.receiptKind, row.effectiveAt, row.createdAt, row.updatedAt,
      ],
    );
  }

  async connectionForOwner(ownerId: string, connectionId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${connectionColumns} FROM external_connection WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [connectionId, ownerId],
    );
    return row ? connectionRow.parse(row) : null;
  }

  async connectionsForOwner(ownerId: string) {
    const query = externalConnectionListQuery(ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(connectionRow).parse(rows);
  }

  async connectionsForBrand(ownerId: string, brandId: string) {
    const query = externalConnectionBrandQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(connectionRow).parse(rows);
  }

  async actionForOwner(ownerId: string, actionId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${actionColumns} FROM external_action WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [actionId, ownerId],
    );
    return row ? actionRow.parse(row) : null;
  }

  async actionByKey(ownerId: string, connectionId: string, idempotencyKey: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${actionColumns} FROM external_action
       WHERE owner_id = ? AND connection_id = ? AND idempotency_key = ?
       LIMIT 1${clause}`,
      [ownerId, connectionId, idempotencyKey],
    );
    return row ? actionRow.parse(row) : null;
  }

  async actionsForConnection(ownerId: string, connectionId: string) {
    const query = externalActionListQuery(ownerId, connectionId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(actionRow).parse(rows);
  }

  async actionsForConnections(ownerId: string, connectionIds: readonly string[]) {
    const query = externalActionsQuery(ownerId, connectionIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(actionRow).parse(rows);
  }

  async markVerified(ownerId: string, connectionId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE external_connection SET status = 'verified', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'pending'
       RETURNING id`,
      [updatedAt, connectionId, ownerId],
    );
    return rows.length === 1;
  }

  async markRevoked(ownerId: string, connectionId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE external_connection SET status = 'revoked', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('pending', 'verified')
       RETURNING id`,
      [updatedAt, connectionId, ownerId],
    );
    return rows.length === 1;
  }

  async writeRefusal(ownerId: string, actionId: string, confirmed: 0 | 1, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE external_action
       SET confirmed = ?, status = 'failed', receipt_kind = NULL, effective_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('failed', 'confirmed')
       RETURNING id`,
      [confirmed, updatedAt, actionId, ownerId],
    );
    return rows.length === 1;
  }

  async writeOutcome(
    ownerId: string,
    actionId: string,
    outcome: Pick<ExternalActionInsert, "status" | "receiptKind" | "effectiveAt">,
    updatedAt: string,
  ) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE external_action
       SET confirmed = 1, status = ?, receipt_kind = ?, effective_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('failed', 'confirmed')
       RETURNING id`,
      [outcome.status, outcome.receiptKind, outcome.effectiveAt, updatedAt, actionId, ownerId],
    );
    return rows.length === 1;
  }

  async reconcile(ownerId: string, actionId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE external_action SET status = 'reconciled', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('acknowledged', 'unknown')
       RETURNING id`,
      [updatedAt, actionId, ownerId],
    );
    return rows.length === 1;
  }
}
