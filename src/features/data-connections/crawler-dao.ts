import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  citationCountSchema,
  crawlerIdentities,
  crawlerObservationListLimit,
  type CrawlerIdentity,
} from "./crawler-contracts.ts";

const identitySchema = z.enum(crawlerIdentities);
const timestampSchema = z.iso.datetime({ precision: 3 });

const wholeCount = z.union([z.number(), z.string(), z.bigint()]).transform((value) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid-crawler-count");
  return count;
});

const crawlerRollupRow = z.object({
  visits: wholeCount,
  citations: wholeCount,
});

const observationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  identity: identitySchema,
  citations: citationCountSchema,
  calledIncluded: z.literal(0),
  observedAt: timestampSchema,
});

export type CrawlerObservationRecord = z.infer<typeof observationRow>;

export type CrawlerObservationInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  identity: CrawlerIdentity;
  citations: number;
  calledIncluded: 0;
  observedAt: string;
};

const observationColumns = `id, brand_id AS "brandId", identity, citations,
  called_included AS "calledIncluded", observed_at AS "observedAt"`;

export function crawlerBrandRollupQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT count(*) AS "visits", COALESCE(SUM(citations), 0) AS "citations"
      FROM crawler_observation
      WHERE owner_id = ? AND brand_id = ?`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function crawlerObservationsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${observationColumns} FROM crawler_observation
      WHERE owner_id = ?
      ORDER BY observed_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, crawlerObservationListLimit] as QueryValue[],
  };
}

export class CrawlerObservationDao {
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

  async brandRollup(ownerId: string, brandId: string) {
    const query = crawlerBrandRollupQuery(ownerId, brandId);
    const [row] = await queryWithParameters(this.db, query.sql, query.values);
    return crawlerRollupRow.parse(row);
  }

  async observationsForOwner(ownerId: string) {
    const query = crawlerObservationsForOwnerQuery(ownerId);
    return z.array(observationRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async observationsByIds(ownerId: string, observationIds: readonly string[]) {
    if (observationIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${observationColumns} FROM crawler_observation
        WHERE owner_id = ? AND id IN (${observationIds.map(() => "?").join(", ")})
        LIMIT ?`,
      [ownerId, ...observationIds, observationIds.length],
    );
    const parsed = z.array(observationRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return observationIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async insertObservations(rows: readonly CrawlerObservationInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO crawler_observation (
        id, brand_id, owner_id, identity, citations, called_included, observed_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [
        row.id, row.brandId, row.ownerId, row.identity, row.citations, row.calledIncluded, row.observedAt,
      ]),
    );
  }
}
