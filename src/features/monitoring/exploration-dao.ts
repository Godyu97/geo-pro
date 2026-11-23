import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { explorationExclusionReason, explorationListLimit } from "./exploration-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const explorationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  questionText: z.string().min(1).max(4000),
  answerText: z.string().min(1).max(8000),
  exclusionReason: z.literal(explorationExclusionReason),
  excludedFromNatural: z.literal(1),
  operationId: brandIdSchema,
  createdAt: timestampSchema,
});

const joinedRow = z.object({
  brandId: brandIdSchema,
  id: brandIdSchema.nullable(),
  questionText: z.string().nullable(),
  answerText: z.string().nullable(),
  exclusionReason: z.literal(explorationExclusionReason).nullable(),
  excludedFromNatural: z.literal(1).nullable(),
  createdAt: timestampSchema.nullable(),
});

export type ExplorationRecord = z.infer<typeof explorationRow>;

export type ExplorationInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  questionText: string;
  answerText: string;
  exclusionReason: typeof explorationExclusionReason;
  excludedFromNatural: 1;
  operationId: string;
  createdAt: string;
};

const explorationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  question_text AS "questionText", answer_text AS "answerText",
  exclusion_reason AS "exclusionReason", excluded_from_natural AS "excludedFromNatural",
  operation_id AS "operationId", created_at AS "createdAt"`;

export function explorationsForOwnerQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT b.id AS "brandId",
        e.id AS "id",
        e.question_text AS "questionText",
        e.answer_text AS "answerText",
        e.exclusion_reason AS "exclusionReason",
        e.excluded_from_natural AS "excludedFromNatural",
        e.created_at AS "createdAt"
      FROM brand b
      LEFT JOIN exploration_observation e
        ON e.brand_id = b.id AND e.owner_id = b.owner_id
      WHERE b.id = ? AND b.owner_id = ? AND b.frozen_at IS NULL
      ORDER BY e.created_at ASC, e.id ASC
      LIMIT ?`,
    values: [brandId, ownerId, explorationListLimit] as QueryValue[],
  };
}

export class ExplorationDao {
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

  async listForOwner(ownerId: string, brandId: string) {
    const query = explorationsForOwnerQuery(ownerId, brandId);
    return z.array(joinedRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async byOperation(ownerId: string, operationId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${explorationColumns} FROM exploration_observation
        WHERE owner_id = ? AND operation_id = ?
        LIMIT 1`,
      [ownerId, operationId],
    );
    return z.array(explorationRow).parse(rows)[0] ?? null;
  }

  async rowForOwner(ownerId: string, id: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${explorationColumns} FROM exploration_observation
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      [ownerId, id],
    );
    return z.array(explorationRow).parse(rows)[0] ?? null;
  }

  async insert(row: ExplorationInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO exploration_observation (
        id, brand_id, owner_id, question_text, answer_text, exclusion_reason,
        excluded_from_natural, operation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.questionText, row.answerText, row.exclusionReason,
        row.excludedFromNatural, row.operationId, row.createdAt],
    );
  }
}
