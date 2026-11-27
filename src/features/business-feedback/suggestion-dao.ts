import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { leadSuggestionStatuses, type LeadSuggestionStatus } from "./suggestion-contracts.ts";

export const leadSuggestionListLimit = 100;

const questionRow = z.strictObject({
  text: z.string().min(1).max(200),
  frozen: z.literal(false),
});

const suggestionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  summaryHash: z.string().length(64),
  status: z.enum(leadSuggestionStatuses),
  modelName: z.string().min(1).max(128),
  suggestionJson: z.string().min(20).max(2000),
  injectionIgnored: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.iso.datetime({ precision: 3 }),
});

function parseSuggestion(row: unknown) {
  const base = suggestionRow.parse(row);
  let questions: z.infer<typeof questionRow>[];
  try {
    questions = z.array(questionRow).min(1).max(3).parse(JSON.parse(base.suggestionJson));
  } catch {
    throw new Error("invalid-lead-suggestion-json");
  }
  return { ...base, questions };
}

export type LeadSuggestionRecord = ReturnType<typeof parseSuggestion>;

const columns = `id, brand_id AS "brandId", owner_id AS "ownerId", summary_hash AS "summaryHash",
  status, model_name AS "modelName", suggestion_json AS "suggestionJson",
  injection_ignored AS "injectionIgnored", created_at AS "createdAt"`;

export type LeadSuggestionInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  summaryHash: string;
  modelName: string;
  suggestionJson: string;
  injectionIgnored: 0 | 1;
  createdAt: string;
};

export function leadSuggestionListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${columns} FROM lead_question_suggestion
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    values: [ownerId, brandId, leadSuggestionListLimit] as QueryValue[],
  };
}

export class LeadSuggestionDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insert(row: LeadSuggestionInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO lead_question_suggestion (
        id, brand_id, owner_id, summary_hash, status, model_name, suggestion_json, injection_ignored, created_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.summaryHash, row.modelName,
        row.suggestionJson, row.injectionIgnored, row.createdAt,
      ],
    );
  }

  async suggestionBrandId(id: string) {
    const [row] = await queryWithParameters(this.db,
      `SELECT brand_id FROM lead_question_suggestion WHERE id = ?`, [id]);
    return typeof row?.brand_id === "string" ? row.brand_id : null;
  }

  async forOwner(ownerId: string, id: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${columns} FROM lead_question_suggestion WHERE id = ? AND owner_id = ? LIMIT 1`,
      [id, ownerId],
    );
    return row ? parseSuggestion(row) : null;
  }

  async forBrand(ownerId: string, brandId: string) {
    const query = leadSuggestionListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return rows.map((row) => parseSuggestion(row));
  }

  async mark(ownerId: string, id: string, status: Exclude<LeadSuggestionStatus, "draft">) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE lead_question_suggestion SET status = ?
       WHERE id = ? AND owner_id = ? AND status = 'draft'
       RETURNING id`,
      [status, id, ownerId],
    );
    return rows.length === 1;
  }
}
