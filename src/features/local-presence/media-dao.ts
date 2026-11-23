import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  approvedFactListLimit,
  mediaKindSchema,
  mediaReasonSchema,
  mediaReviewListLimit,
  mediaValueSchema,
} from "./media-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const reviewRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  kind: mediaKindSchema,
  shownValue: mediaValueSchema,
  approvedValue: mediaValueSchema,
  factVersionId: brandIdSchema,
  reason: mediaReasonSchema,
  deliver: z.union([z.literal(0), z.literal(1)]),
  recordedAt: timestampSchema,
});

const factRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  version: z.number().int().positive(),
  content: z.string(),
});

const ownedFactRow = z.object({
  id: brandIdSchema,
  version: z.number().int().positive(),
  content: z.string(),
});

export type MediaReviewRecord = z.infer<typeof reviewRow>;
export type ApprovedFactRecord = z.infer<typeof factRow>;

export type MediaReviewInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  kind: "image" | "script";
  shownValue: string;
  approvedValue: string;
  factVersionId: string;
  reason: "ok" | "fact_mismatch" | "not_proof";
  deliver: 0 | 1;
  recordedAt: string;
};

const reviewColumns = `id, brand_id AS "brandId", kind, shown_value AS "shownValue",
  approved_value AS "approvedValue", fact_version_id AS "factVersionId", reason,
  deliver, recorded_at AS "recordedAt"`;

export function mediaReviewsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${reviewColumns} FROM media_review
      WHERE owner_id = ?
      ORDER BY recorded_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, mediaReviewListLimit] as QueryValue[],
  };
}

export function mediaReviewsForBrandQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${reviewColumns} FROM media_review
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY recorded_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, mediaReviewListLimit] as QueryValue[],
  };
}

export class MediaReviewDao {
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

  async reviewsForOwner(ownerId: string) {
    const query = mediaReviewsForOwnerQuery(ownerId);
    return z.array(reviewRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async reviewsForBrand(ownerId: string, brandId: string) {
    const query = mediaReviewsForBrandQuery(ownerId, brandId);
    return z.array(reviewRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async reviewsByIds(ownerId: string, reviewIds: readonly string[]) {
    if (reviewIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${reviewColumns} FROM media_review
        WHERE owner_id = ? AND id IN (${reviewIds.map(() => "?").join(", ")})
        LIMIT ?`,
      [ownerId, ...reviewIds, reviewIds.length],
    );
    const parsed = z.array(reviewRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return reviewIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async approvedFactsForOwner(ownerId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT v.id, v.brand_id AS "brandId", v.version, v.content
        FROM brand_fact_version v
        INNER JOIN brand b ON b.id = v.brand_id
        WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL AND v.state = 'approved'
        ORDER BY v.created_at DESC, v.id ASC
        LIMIT ?`,
      [ownerId, approvedFactListLimit],
    );
    return z.array(factRow).parse(rows);
  }

  async approvedFactsForBrand(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT v.id, v.brand_id AS "brandId", v.version, v.content
        FROM brand_fact_version v
        INNER JOIN brand b ON b.id = v.brand_id
        WHERE b.owner_id = ? AND b.id = ? AND b.status = 'active' AND b.frozen_at IS NULL
          AND v.state = 'approved'
        ORDER BY v.created_at DESC, v.id ASC
        LIMIT ?`,
      [ownerId, brandId, approvedFactListLimit],
    );
    return z.array(factRow).parse(rows);
  }

  async approvedFactForBrand(ownerId: string, brandId: string, factVersionId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT v.id, v.version, v.content
        FROM brand_fact_version v
        INNER JOIN brand b ON b.id = v.brand_id
        WHERE b.owner_id = ? AND b.id = ? AND b.status = 'active' AND b.frozen_at IS NULL
          AND v.id = ? AND v.state = 'approved'
        LIMIT 1`,
      [ownerId, brandId, factVersionId],
    );
    const parsed = z.array(ownedFactRow).parse(rows);
    return parsed[0] ?? null;
  }

  async insertReview(row: MediaReviewInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO media_review (
        id, brand_id, owner_id, kind, shown_value, approved_value, fact_version_id, reason, deliver, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.brandId,
        row.ownerId,
        row.kind,
        row.shownValue,
        row.approvedValue,
        row.factVersionId,
        row.reason,
        row.deliver,
        row.recordedAt,
      ],
    );
  }
}
