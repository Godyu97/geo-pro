import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { citySchema, localObservationListLimit } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const observationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  targetCity: citySchema,
  sampledCity: citySchema.nullable(),
  ranked: z.literal(0),
  claimedLocalUsers: z.literal(0),
  recordedAt: timestampSchema,
});

export type LocalObservationRecord = z.infer<typeof observationRow>;

export type LocalObservationInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  targetCity: string;
  sampledCity: string | null;
  ranked: 0;
  claimedLocalUsers: 0;
  recordedAt: string;
};

const observationColumns = `id, brand_id AS "brandId", target_city AS "targetCity",
  sampled_city AS "sampledCity", ranked, claimed_local_users AS "claimedLocalUsers",
  recorded_at AS "recordedAt"`;

export function localObservationsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${observationColumns} FROM local_observation
      WHERE owner_id = ?
      ORDER BY recorded_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, localObservationListLimit] as QueryValue[],
  };
}

export class LocalObservationDao {
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

  async observationsForOwner(ownerId: string) {
    const query = localObservationsForOwnerQuery(ownerId);
    return z.array(observationRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async observationsByIds(ownerId: string, observationIds: readonly string[]) {
    if (observationIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${observationColumns} FROM local_observation
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

  async insertObservations(rows: readonly LocalObservationInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO local_observation (
        id, brand_id, owner_id, target_city, sampled_city, ranked, claimed_local_users, recorded_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [
        row.id, row.brandId, row.ownerId, row.targetCity, row.sampledCity, row.ranked, row.claimedLocalUsers, row.recordedAt,
      ]),
    );
  }
}
