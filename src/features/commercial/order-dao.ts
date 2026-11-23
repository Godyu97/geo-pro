import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { orderListLimit, orderStatuses, type OrderView } from "./order-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);

const orderRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  quoted: flag,
  status: z.enum(orderStatuses),
  paid: z.literal(0),
  amount: z.number().int().min(0).max(2_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  createdAt: z.string().min(20).max(40),
});

const brandOptionRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1).nullable(),
});

export function serviceOrdersQuery(ownerId: string) {
  return {
    sql: `SELECT id, brand_id AS "brandId", quoted, status, paid, amount, currency, created_at AS "createdAt"
      FROM service_order
      WHERE owner_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [ownerId, orderListLimit] as QueryValue[],
  };
}

export function serviceOrderQuery(orderId: string, ownerId: string) {
  return {
    sql: `SELECT id, brand_id AS "brandId", quoted, status, paid, amount, currency, created_at AS "createdAt"
      FROM service_order
      WHERE id = ? AND owner_id = ?`,
    values: [orderId, ownerId] as QueryValue[],
  };
}

function orderFrom(row: z.infer<typeof orderRow>): OrderView {
  return {
    id: row.id,
    brandId: row.brandId,
    quoted: row.quoted,
    status: row.status,
    paid: 0,
    amount: row.amount,
    currency: row.currency,
    createdAt: row.createdAt,
  };
}

export class OrderDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async ordersForOwner(ownerId: string) {
    const query = serviceOrdersQuery(ownerId);
    const rows = await this.query(query.sql, query.values);
    return rows.map((row) => orderFrom(orderRow.parse(row)));
  }

  async orderForOwner(orderId: string, ownerId: string) {
    const query = serviceOrderQuery(orderId, ownerId);
    const [row] = await this.query(query.sql, query.values);
    return row ? orderFrom(orderRow.parse(row)) : null;
  }

  async ownedBrands(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, orderListLimit],
    );
    return rows.map((row) => {
      const parsed = brandOptionRow.parse(row);
      return { id: parsed.brandId, name: parsed.name ?? parsed.brandId };
    });
  }

  async insertForOwner(row: {
    id: string;
    brandId: string;
    ownerId: string;
    quoted: 0 | 1;
    status: OrderView["status"];
    amount: number;
    currency: string;
    createdAt: string;
  }) {
    const rows = await this.query(
      `INSERT INTO service_order
        (id, brand_id, owner_id, quoted, status, paid, amount, currency, created_at)
       SELECT ?, b.id, b.owner_id, ?, ?, 0, ?, ?, ?
       FROM brand b
       WHERE b.id = ? AND b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       RETURNING id`,
      [row.id, row.quoted, row.status, row.amount, row.currency, row.createdAt, row.brandId, row.ownerId],
    );
    return rows.length === 1;
  }
}
