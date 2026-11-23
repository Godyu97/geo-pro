import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { notificationDeliveryListLimit, notificationEndpointListLimit } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });
const bit = z.union([z.literal(0), z.literal(1)]);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const endpointRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  status: z.enum(["verified", "revoked"]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const deliveryRow = z.object({
  id: brandIdSchema,
  endpointId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  sent: bit,
  bodyHasCustomerText: bit,
  bodyHash: hashSchema,
  createdAt: timestampSchema,
});

export type NotificationEndpointRecord = z.infer<typeof endpointRow>;
export type NotificationDeliveryRecord = z.infer<typeof deliveryRow>;

const endpointColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", label, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const deliveryColumns = `id, endpoint_id AS "endpointId", brand_id AS "brandId", owner_id AS "ownerId",
  sent, body_has_customer_text AS "bodyHasCustomerText", body_hash AS "bodyHash", created_at AS "createdAt"`;

export function ownedBrandQuery(ownerId: string) {
  return {
    sql: `SELECT id FROM brand
      WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, 20] as QueryValue[],
  };
}

export function notificationEndpointListQuery(ownerId: string) {
  return {
    sql: `SELECT ${endpointColumns} FROM notification_endpoint
      WHERE owner_id = ?
      ORDER BY brand_id ASC, created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, notificationEndpointListLimit] as QueryValue[],
  };
}

export function notificationDeliveryListQuery(ownerId: string, endpointId: string) {
  return {
    sql: `SELECT ${deliveryColumns} FROM notification_delivery
      WHERE owner_id = ? AND endpoint_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, endpointId, notificationDeliveryListLimit] as QueryValue[],
  };
}

export function notificationDeliveriesQuery(ownerId: string, endpointIds: readonly string[]) {
  if (endpointIds.length === 0) return null;
  return {
    sql: `SELECT ${deliveryColumns} FROM notification_delivery
      WHERE owner_id = ? AND endpoint_id IN (${endpointIds.map(() => "?").join(", ")})
      ORDER BY endpoint_id ASC, created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, ...endpointIds, notificationDeliveryListLimit] as QueryValue[],
  };
}

export class NotificationEndpointDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const query = ownedBrandQuery(ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async insertEndpoint(row: NotificationEndpointRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO notification_endpoint (
        id, brand_id, owner_id, label, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.label, row.status, row.createdAt, row.updatedAt],
    );
  }

  async insertDelivery(row: NotificationDeliveryRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO notification_delivery (
        id, endpoint_id, brand_id, owner_id, sent, body_has_customer_text, body_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.endpointId, row.brandId, row.ownerId, row.sent, row.bodyHasCustomerText, row.bodyHash, row.createdAt,
      ],
    );
  }

  async endpointForOwner(ownerId: string, endpointId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${endpointColumns} FROM notification_endpoint WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [endpointId, ownerId],
    );
    return row ? endpointRow.parse(row) : null;
  }

  async endpointsForOwner(ownerId: string) {
    const query = notificationEndpointListQuery(ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(endpointRow).parse(rows);
  }

  async deliveriesForEndpoint(ownerId: string, endpointId: string) {
    const query = notificationDeliveryListQuery(ownerId, endpointId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(deliveryRow).parse(rows);
  }

  async deliveriesForEndpoints(ownerId: string, endpointIds: readonly string[]) {
    const query = notificationDeliveriesQuery(ownerId, endpointIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(deliveryRow).parse(rows);
  }

  async markRevoked(ownerId: string, endpointId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE notification_endpoint SET status = 'revoked', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'verified'
       RETURNING id`,
      [updatedAt, endpointId, ownerId],
    );
    return rows.length === 1;
  }
}
