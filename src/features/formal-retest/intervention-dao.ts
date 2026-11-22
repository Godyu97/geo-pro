import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  interventionStatusSchema,
  pageKeySchema,
  verifiedAtSchema,
} from "./intervention-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const batchRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  status: interventionStatusSchema,
  effectiveAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).superRefine((row, ctx) => {
  if ((row.status === "pending") !== (row.effectiveAt === null)) {
    ctx.addIssue({ code: "custom", message: "effectiveAt" });
  }
});

const pageRow = z.object({
  id: brandIdSchema,
  batchId: brandIdSchema,
  pageKey: pageKeySchema,
  verifiedAt: verifiedAtSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type InterventionBatchRecord = z.infer<typeof batchRow>;
export type InterventionPageRecord = z.infer<typeof pageRow>;

export type InterventionPageInsert = {
  id: string;
  batchId: string;
  brandId: string;
  ownerId: string;
  pageKey: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const batchColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", status,
  effective_at AS "effectiveAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

const pageColumns = `id, batch_id AS "batchId", page_key AS "pageKey", verified_at AS "verifiedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export function interventionBatchListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${batchColumns} FROM intervention_batch
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function interventionBatchPageListQuery(ownerId: string, batchId: string) {
  return {
    sql: `SELECT ${pageColumns} FROM intervention_batch_page
      WHERE batch_id = ? AND owner_id = ?
      ORDER BY page_key ASC, id ASC`,
    values: [batchId, ownerId] as QueryValue[],
  };
}

export function interventionBatchPagesQuery(ownerId: string, batchIds: readonly string[]) {
  if (batchIds.length === 0) return null;
  return {
    sql: `SELECT ${pageColumns} FROM intervention_batch_page
      WHERE owner_id = ? AND batch_id IN (${batchIds.map(() => "?").join(", ")})
      ORDER BY batch_id ASC, page_key ASC, id ASC`,
    values: [ownerId, ...batchIds] as QueryValue[],
  };
}

export class InterventionBatchDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertBatch(row: InterventionBatchRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO intervention_batch (
        id, brand_id, owner_id, status, effective_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.status, row.effectiveAt, row.createdAt, row.updatedAt],
    );
  }

  async batchForOwner(ownerId: string, batchId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${batchColumns} FROM intervention_batch WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [batchId, ownerId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async batchesForBrand(ownerId: string, brandId: string) {
    const query = interventionBatchListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(batchRow).parse(rows);
  }

  async pagesForBatch(ownerId: string, batchId: string) {
    const query = interventionBatchPageListQuery(ownerId, batchId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(pageRow).parse(rows);
  }

  async pagesForBatches(ownerId: string, batchIds: readonly string[]) {
    const query = interventionBatchPagesQuery(ownerId, batchIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(pageRow).parse(rows);
  }

  async upsertPage(row: InterventionPageInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO intervention_batch_page (
        id, batch_id, brand_id, owner_id, page_key, verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (batch_id, page_key) DO UPDATE SET
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at`,
      [row.id, row.batchId, row.brandId, row.ownerId, row.pageKey, row.verifiedAt, row.createdAt, row.updatedAt],
    );
  }

  async writeEffectivePoint(
    ownerId: string,
    batchId: string,
    point: { status: "pending"; effectiveAt: null } | { status: "effective"; effectiveAt: string },
    updatedAt: string,
  ) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE intervention_batch SET status = ?, effective_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?
       RETURNING id`,
      [point.status, point.effectiveAt, updatedAt, batchId, ownerId],
    );
    return rows.length === 1;
  }
}
