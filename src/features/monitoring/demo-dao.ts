import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { demoListLimit } from "./demo-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const demoRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  questionText: z.string().min(1).max(4000),
  answerText: z.string().min(1).max(8000),
  isDemo: z.literal(1),
  operationId: brandIdSchema,
  createdAt: timestampSchema,
});

const joinedRow = z.object({
  brandId: brandIdSchema,
  id: brandIdSchema.nullable(),
  questionText: z.string().nullable(),
  answerText: z.string().nullable(),
  isDemo: z.literal(1).nullable(),
  createdAt: timestampSchema.nullable(),
});

export type DemoRecord = z.infer<typeof demoRow>;

export type DemoInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  questionText: string;
  answerText: string;
  isDemo: 1;
  operationId: string;
  createdAt: string;
};

const demoColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  question_text AS "questionText", answer_text AS "answerText",
  is_demo AS "isDemo", operation_id AS "operationId", created_at AS "createdAt"`;

export function demosForOwnerQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT b.id AS "brandId",
        d.id AS "id",
        d.question_text AS "questionText",
        d.answer_text AS "answerText",
        d.is_demo AS "isDemo",
        d.created_at AS "createdAt"
      FROM brand b
      LEFT JOIN demo_observation d
        ON d.brand_id = b.id AND d.owner_id = b.owner_id
      WHERE b.id = ? AND b.owner_id = ? AND b.frozen_at IS NULL
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT ?`,
    values: [brandId, ownerId, demoListLimit] as QueryValue[],
  };
}

export class DemoObservationDao {
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
    const query = demosForOwnerQuery(ownerId, brandId);
    return z.array(joinedRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async byOperation(ownerId: string, operationId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${demoColumns} FROM demo_observation
        WHERE owner_id = ? AND operation_id = ?
        LIMIT 1`,
      [ownerId, operationId],
    );
    return z.array(demoRow).parse(rows)[0] ?? null;
  }

  async rowForOwner(ownerId: string, id: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${demoColumns} FROM demo_observation
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      [ownerId, id],
    );
    return z.array(demoRow).parse(rows)[0] ?? null;
  }

  async insert(row: DemoInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO demo_observation (
        id, brand_id, owner_id, question_text, answer_text, is_demo, operation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.questionText, row.answerText, row.isDemo, row.operationId, row.createdAt],
    );
  }
}
