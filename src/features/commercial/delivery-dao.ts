import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { deliveryListLimit, type DeliveryView } from "./delivery-contracts.ts";
import { deliveryStatuses, type DeliveryState } from "./delivery.ts";

function boundedText(max: number) {
  return z.string().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

const deliveryRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  title: boundedText(120),
  status: z.enum(deliveryStatuses),
  disputeReason: boundedText(500).nullable(),
  createdAt: z.string().min(20).max(40),
}).strict();

const brandOptionRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1).nullable(),
});

const deliveryColumns = `id, brand_id AS "brandId", title, status, dispute_reason AS "disputeReason", created_at AS "createdAt"`;

export function brandDeliveriesQuery(ownerId: string) {
  return {
    sql: `SELECT ${deliveryColumns}
      FROM brand_delivery
      WHERE owner_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [ownerId, deliveryListLimit] as QueryValue[],
  };
}

export function brandDeliveryQuery(deliveryId: string, ownerId: string) {
  return {
    sql: `SELECT ${deliveryColumns}
      FROM brand_delivery
      WHERE id = ? AND owner_id = ?`,
    values: [deliveryId, ownerId] as QueryValue[],
  };
}

function deliveryFrom(row: z.infer<typeof deliveryRow>): DeliveryView {
  return {
    id: row.id,
    brandId: row.brandId,
    title: row.title,
    status: row.status,
    disputeReason: row.disputeReason,
    createdAt: row.createdAt,
  };
}

export class DeliveryDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async deliveriesForOwner(ownerId: string) {
    const query = brandDeliveriesQuery(ownerId);
    const rows = await this.query(query.sql, query.values);
    return rows.map((row) => deliveryFrom(deliveryRow.parse(row)));
  }

  async deliveryForOwner(deliveryId: string, ownerId: string) {
    const query = brandDeliveryQuery(deliveryId, ownerId);
    const [row] = await this.query(query.sql, query.values);
    return row ? deliveryFrom(deliveryRow.parse(row)) : null;
  }

  async ownedBrands(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, deliveryListLimit],
    );
    return rows.map((row) => {
      const parsed = brandOptionRow.parse(row);
      return { id: parsed.brandId, name: parsed.name ?? parsed.brandId };
    });
  }

  async insertPending(row: {
    id: string;
    brandId: string;
    ownerId: string;
    title: string;
    state: DeliveryState;
    createdAt: string;
  }) {
    if (row.state.status !== "pending" || row.state.disputeReason !== null) return false;
    const rows = await this.query(
      `INSERT INTO brand_delivery
        (id, brand_id, owner_id, title, status, dispute_reason, created_at)
       SELECT ?, b.id, b.owner_id, ?, ?, ?, ?
       FROM brand b
       WHERE b.id = ? AND b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       RETURNING id`,
      [row.id, row.title, row.state.status, row.state.disputeReason, row.createdAt, row.brandId, row.ownerId],
    );
    return rows.length === 1;
  }

  async applyAllowedTransition(deliveryId: string, ownerId: string, state: DeliveryState) {
    if (state.status === "pending") return null;
    const rows = await this.query(
      `UPDATE brand_delivery
       SET status = ?, dispute_reason = ?
       WHERE id = ? AND owner_id = ? AND status = 'pending' AND dispute_reason IS NULL
       RETURNING ${deliveryColumns}`,
      [state.status, state.disputeReason, deliveryId, ownerId],
    );
    const [row] = rows;
    return row ? deliveryFrom(deliveryRow.parse(row)) : null;
  }
}
