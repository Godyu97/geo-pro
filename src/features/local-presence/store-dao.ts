import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { brandStoreListLimit, serviceAreaSchema, storeFactUseListLimit, storeNameSchema } from "./store-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const storeRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  name: storeNameSchema,
  serviceArea: serviceAreaSchema,
  createdAt: timestampSchema,
});

const useRow = z.object({
  id: brandIdSchema,
  storeId: brandIdSchema,
  serviceArea: serviceAreaSchema,
  usedOtherStore: z.literal(0),
  recordedAt: timestampSchema,
});

export type BrandStoreRecord = z.infer<typeof storeRow>;
export type StoreFactUseRecord = z.infer<typeof useRow>;

export type BrandStoreInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  name: string;
  serviceArea: string;
  createdAt: string;
};

export type StoreFactUseInsert = {
  id: string;
  storeId: string;
  ownerId: string;
  serviceArea: string;
  usedOtherStore: 0;
  recordedAt: string;
};

const storeColumns = `id, brand_id AS "brandId", name, service_area AS "serviceArea", created_at AS "createdAt"`;
const useColumns = `id, store_id AS "storeId", service_area AS "serviceArea",
  used_other_store AS "usedOtherStore", recorded_at AS "recordedAt"`;

export function brandStoresForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${storeColumns} FROM brand_store
      WHERE owner_id = ?
      ORDER BY brand_id ASC, created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandStoreListLimit] as QueryValue[],
  };
}

export function brandStoresForBrandQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${storeColumns} FROM brand_store
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, brandStoreListLimit] as QueryValue[],
  };
}

export function brandStoresForStoreQuery(ownerId: string, storeId: string) {
  return {
    sql: `SELECT ${storeColumns} FROM brand_store
      WHERE owner_id = ? AND brand_id = (
        SELECT brand_id FROM brand_store WHERE owner_id = ? AND id = ?
      )
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, ownerId, storeId, brandStoreListLimit] as QueryValue[],
  };
}

export function storeFactUsesForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${useColumns} FROM store_fact_use
      WHERE owner_id = ?
      ORDER BY recorded_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, storeFactUseListLimit] as QueryValue[],
  };
}

export class BrandStoreDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id FROM brand
        WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [ownerId, 20],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async storesForOwner(ownerId: string) {
    const query = brandStoresForOwnerQuery(ownerId);
    return z.array(storeRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async storesForBrand(ownerId: string, brandId: string) {
    const query = brandStoresForBrandQuery(ownerId, brandId);
    return z.array(storeRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async storesForStoreBrand(ownerId: string, storeId: string) {
    const query = brandStoresForStoreQuery(ownerId, storeId);
    return z.array(storeRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async storesByIds(ownerId: string, storeIds: readonly string[]) {
    if (storeIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${storeColumns} FROM brand_store
        WHERE owner_id = ? AND id IN (${storeIds.map(() => "?").join(", ")})
        LIMIT ?`,
      [ownerId, ...storeIds, storeIds.length],
    );
    const parsed = z.array(storeRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return storeIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async insertStores(rows: readonly BrandStoreInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO brand_store (
        id, brand_id, owner_id, name, service_area, created_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [row.id, row.brandId, row.ownerId, row.name, row.serviceArea, row.createdAt]),
    );
  }

  async usesForOwner(ownerId: string) {
    const query = storeFactUsesForOwnerQuery(ownerId);
    return z.array(useRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async usesForStores(ownerId: string, storeIds: readonly string[]) {
    if (storeIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${useColumns} FROM store_fact_use
        WHERE owner_id = ? AND store_id IN (${storeIds.map(() => "?").join(", ")})
        ORDER BY recorded_at DESC, id ASC
        LIMIT ?`,
      [ownerId, ...storeIds, storeFactUseListLimit],
    );
    return z.array(useRow).parse(rows);
  }

  async usesByIds(ownerId: string, useIds: readonly string[]) {
    if (useIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${useColumns} FROM store_fact_use
        WHERE owner_id = ? AND id IN (${useIds.map(() => "?").join(", ")})
        LIMIT ?`,
      [ownerId, ...useIds, useIds.length],
    );
    const parsed = z.array(useRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return useIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async insertUses(rows: readonly StoreFactUseInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO store_fact_use (
        id, store_id, owner_id, service_area, used_other_store, recorded_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [row.id, row.storeId, row.ownerId, row.serviceArea, row.usedOtherStore, row.recordedAt]),
    );
  }
}
