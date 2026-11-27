import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { correctionActions, correctionEffects, reviewFactSchema } from "./contracts.ts";

const savedEvidenceStates = `('complete', 'incomplete', 'contested')`;

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

export function entityReviewSamplesQuery(ownerId: string, brandId: string, analysisVersionIds: readonly string[]) {
  return {
    sql: `SELECT a.id AS "analysisVersionId", o.id AS "observationId"
      FROM answer_analysis_version a
      JOIN answer_observation o ON o.id = a.observation_id AND o.brand_id = a.brand_id
      WHERE o.owner_id = ? AND o.brand_id = ?
        AND o.evidence_state IN ${savedEvidenceStates}
        AND a.id IN (${analysisVersionIds.map(() => "?").join(", ")})`,
    values: [ownerId, brandId, ...analysisVersionIds] as QueryValue[],
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

  async reviewSamples(ownerId: string, brandId: string, analysisVersionIds: readonly string[]) {
    if (!analysisVersionIds.length) return [];
    const query = entityReviewSamplesQuery(ownerId, brandId, analysisVersionIds);
    const sample = z.object({ analysisVersionId: brandIdSchema, observationId: brandIdSchema });
    return z.array(sample).parse(await queryWithParameters(this.db, query.sql, query.values));
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

const promptSetIdRow = z.object({ promptSetId: brandIdSchema });
const promptContentRow = z.object({ id: brandIdSchema, content: z.string() });
const brandFactObservationRow = z.object({
  observationId: brandIdSchema,
  questionText: z.string(),
  answerText: z.string(),
  questionId: brandIdSchema,
  analysisVersionId: brandIdSchema.nullable(),
  capturedAt: z.string(),
});

export type BrandFactObservationRow = z.infer<typeof brandFactObservationRow>;

export function brandFactPromptSetIdQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT DISTINCT r.prompt_set_id AS "promptSetId"
      FROM answer_observation o
      JOIN monitoring_slot s ON s.id = o.slot_id AND s.brand_id = o.brand_id
      JOIN monitoring_run r ON r.id = s.run_id AND r.brand_id = o.brand_id AND r.owner_id = o.owner_id
      WHERE o.owner_id = ? AND o.brand_id = ?
        AND o.evidence_state IN ${savedEvidenceStates}
      ORDER BY r.prompt_set_id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function promptSetContentQuery(brandId: string, ids: readonly string[]) {
  return {
    sql: `SELECT id, content FROM prompt_set
      WHERE brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})
      ORDER BY id ASC`,
    values: [brandId, ...ids] as QueryValue[],
  };
}

export function brandFactObservationQuery(
  ownerId: string,
  brandId: string,
  questionIds: readonly string[],
  observationIds?: readonly string[],
) {
  const values: QueryValue[] = [ownerId, brandId, ...questionIds];
  let observationFilter = "";
  if (observationIds) {
    observationFilter = ` AND o.id IN (${observationIds.map(() => "?").join(", ")})`;
    values.push(...observationIds);
  }
  return {
    sql: `SELECT o.id AS "observationId", o.question_text AS "questionText", o.answer_text AS "answerText",
        s.question_id AS "questionId", a.id AS "analysisVersionId", o.captured_at AS "capturedAt"
      FROM answer_observation o
      JOIN monitoring_slot s ON s.id = o.slot_id AND s.brand_id = o.brand_id
      JOIN monitoring_run r ON r.id = s.run_id AND r.brand_id = o.brand_id AND r.owner_id = o.owner_id
      LEFT JOIN answer_analysis_version a ON a.observation_id = o.id AND a.brand_id = o.brand_id
        AND a.version = (
          SELECT MAX(a2.version) FROM answer_analysis_version a2
          WHERE a2.observation_id = o.id AND a2.brand_id = o.brand_id
        )
      WHERE o.owner_id = ? AND o.brand_id = ?
        AND o.evidence_state IN ${savedEvidenceStates}
        AND s.question_id IN (${questionIds.map(() => "?").join(", ")})
        ${observationFilter}
      ORDER BY o.captured_at DESC, o.id DESC
      LIMIT ${observationIds?.length ?? 30}`,
    values,
  };
}

export class BrandFactClaimDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async promptSetIds(ownerId: string, brandId: string) {
    const query = brandFactPromptSetIdQuery(ownerId, brandId);
    return z.array(promptSetIdRow).parse(await queryWithParameters(this.db, query.sql, query.values))
      .map((row) => row.promptSetId);
  }

  async promptContents(brandId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const query = promptSetContentQuery(brandId, ids);
    return z.array(promptContentRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async observations(ownerId: string, brandId: string, questionIds: readonly string[], observationIds?: readonly string[]) {
    if (questionIds.length === 0 || observationIds?.length === 0) return [];
    const query = brandFactObservationQuery(ownerId, brandId, questionIds, observationIds);
    return z.array(brandFactObservationRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }
}
