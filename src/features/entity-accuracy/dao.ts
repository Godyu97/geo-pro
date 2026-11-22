import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { correctionActions, correctionEffects, reviewFactSchema } from "./contracts.ts";

const reviewRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  observationId: brandIdSchema,
  analysisVersionId: brandIdSchema,
  confirmedError: z.union([z.literal(0), z.literal(1)]),
  reviewed: z.union([z.literal(0), z.literal(1)]),
  populationCount: z.number().int().min(1).max(100_000),
  method: z.string().min(1).max(200),
  fact: reviewFactSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type EntityReviewRecord = z.infer<typeof reviewRow>;

const reviewColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  observation_id AS "observationId", analysis_version_id AS "analysisVersionId",
  confirmed_error AS "confirmedError", reviewed, population_count AS "populationCount",
  method, fact, created_at AS "createdAt"`;

export function entityReviewListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${reviewColumns} FROM entity_review
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY observation_id ASC, analysis_version_id ASC, created_at DESC, id DESC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export class EntityReviewDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertReviews(rows: readonly EntityReviewRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id,
        row.brandId,
        row.ownerId,
        row.observationId,
        row.analysisVersionId,
        row.confirmedError,
        row.reviewed,
        row.populationCount,
        row.method,
        row.fact,
        row.createdAt,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO entity_review (
        id, brand_id, owner_id, observation_id, analysis_version_id, confirmed_error, reviewed,
        population_count, method, fact, created_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async reviewsForBrand(ownerId: string, brandId: string) {
    const query = entityReviewListQuery(ownerId, brandId);
    return z.array(reviewRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }
}

const disambiguationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  observationId: brandIdSchema,
  priorAnalysisId: brandIdSchema,
  nextAnalysisId: brandIdSchema,
  countAsTargetMention: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const correctionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  observationId: brandIdSchema,
  action: z.enum(correctionActions),
  effect: z.enum(correctionEffects),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type EntityDisambiguationRecord = z.infer<typeof disambiguationRow>;
export type EntityCorrectionRecord = z.infer<typeof correctionRow>;

const disambiguationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  observation_id AS "observationId", prior_analysis_id AS "priorAnalysisId",
  next_analysis_id AS "nextAnalysisId", count_as_target_mention AS "countAsTargetMention",
  created_at AS "createdAt"`;

const correctionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  observation_id AS "observationId", action, effect, created_at AS "createdAt"`;

export function entityDisambiguationListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${disambiguationColumns} FROM entity_disambiguation
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function entityCorrectionListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${correctionColumns} FROM entity_correction
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export class EntityRevisionDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertDisambiguation(row: EntityDisambiguationRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO entity_disambiguation (
        id, brand_id, owner_id, observation_id, prior_analysis_id, next_analysis_id,
        count_as_target_mention, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.brandId,
        row.ownerId,
        row.observationId,
        row.priorAnalysisId,
        row.nextAnalysisId,
        row.countAsTargetMention,
        row.createdAt,
      ],
    );
  }

  async insertCorrection(row: EntityCorrectionRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO entity_correction (
        id, brand_id, owner_id, observation_id, action, effect, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.observationId, row.action, row.effect, row.createdAt],
    );
  }

  async disambiguationsForBrand(ownerId: string, brandId: string) {
    const query = entityDisambiguationListQuery(ownerId, brandId);
    return z.array(disambiguationRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async correctionsForBrand(ownerId: string, brandId: string) {
    const query = entityCorrectionListQuery(ownerId, brandId);
    return z.array(correctionRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }
}
