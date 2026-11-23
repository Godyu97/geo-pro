import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  industryPackListLimit,
  industryPackQuestionBodySchema,
  industryPackQuestionListLimit,
  industryPackScopeSchema,
  industryPackStatusSchema,
} from "./industry-pack-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });

const packRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  scope: industryPackScopeSchema,
  coversRegulated: z.union([z.literal(0), z.literal(1)]),
  status: industryPackStatusSchema,
  createdAt: timestampSchema,
});

const questionRow = z.object({
  id: brandIdSchema,
  packId: brandIdSchema,
  body: industryPackQuestionBodySchema,
  status: z.literal("draft"),
  createdAt: timestampSchema,
});

export type IndustryPackRecord = z.infer<typeof packRow>;
export type IndustryPackQuestionRecord = z.infer<typeof questionRow>;

export type IndustryPackInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  scope: string;
  coversRegulated: 0 | 1;
  status: "draft";
  createdAt: string;
};

export type IndustryPackQuestionInsert = {
  id: string;
  packId: string;
  body: string;
  status: "draft";
  createdAt: string;
};

const packColumns = `id, brand_id AS "brandId", scope, covers_regulated AS "coversRegulated",
  status, created_at AS "createdAt"`;

const questionColumns = `id, pack_id AS "packId", body, status, created_at AS "createdAt"`;

export function industryPacksForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${packColumns} FROM industry_pack
      WHERE owner_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, industryPackListLimit] as QueryValue[],
  };
}

export function industryPacksForBrandQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${packColumns} FROM industry_pack
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, industryPackListLimit] as QueryValue[],
  };
}

export function industryPackQuestionsForPackQuery(packId: string) {
  return {
    sql: `SELECT ${questionColumns} FROM industry_pack_question
      WHERE pack_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [packId, industryPackQuestionListLimit] as QueryValue[],
  };
}

export function industryPackQuestionsQuery(packIds: readonly string[]) {
  return {
    sql: `SELECT ${questionColumns} FROM industry_pack_question
      WHERE pack_id IN (${packIds.map(() => "?").join(", ")})
      ORDER BY pack_id ASC, created_at ASC, id ASC
      LIMIT ?`,
    values: [...packIds, industryPackQuestionListLimit] as QueryValue[],
  };
}

export class IndustryPackDao {
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

  async packsForOwner(ownerId: string) {
    const query = industryPacksForOwnerQuery(ownerId);
    return z.array(packRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async packsForBrand(ownerId: string, brandId: string) {
    const query = industryPacksForBrandQuery(ownerId, brandId);
    return z.array(packRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async packForOwner(ownerId: string, packId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${packColumns} FROM industry_pack
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      [ownerId, packId],
    );
    const parsed = z.array(packRow).parse(rows);
    return parsed[0] ?? null;
  }

  async questionsForPacks(packIds: readonly string[]) {
    if (packIds.length === 0) return [];
    const query = packIds.length === 1
      ? industryPackQuestionsForPackQuery(packIds[0])
      : industryPackQuestionsQuery(packIds);
    return z.array(questionRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async questionsByIds(packId: string, questionIds: readonly string[]) {
    if (questionIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${questionColumns} FROM industry_pack_question
        WHERE pack_id = ? AND id IN (${questionIds.map(() => "?").join(", ")})
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [packId, ...questionIds, questionIds.length],
    );
    const parsed = z.array(questionRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return questionIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async insertPack(row: IndustryPackInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO industry_pack (
        id, brand_id, owner_id, scope, covers_regulated, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.scope, row.coversRegulated, row.status, row.createdAt],
    );
  }

  async insertQuestions(rows: readonly IndustryPackQuestionInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO industry_pack_question (id, pack_id, body, status, created_at)
        VALUES ${rows.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [row.id, row.packId, row.body, row.status, row.createdAt]),
    );
  }
}
