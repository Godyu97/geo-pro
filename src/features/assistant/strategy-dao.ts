import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { evidenceStrengthSchema, explanationSchema, strategyTemplateListLimit } from "./strategy-contracts.ts";

const stamp = z.iso.datetime({ precision: 3 });
const bounded = (max: number) => z.string().min(1).max(max);

const templateRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  industry: bounded(120),
  samplingCondition: bounded(500),
  evidenceStrength: evidenceStrengthSchema,
  failureCase: bounded(2000),
  explanation: explanationSchema,
  strategyLabel: z.literal("observation"),
  guaranteed: z.coerce.number().int().min(0).max(0),
  successes: z.coerce.number().int().min(0).max(1_000_000),
  createdAt: stamp,
  updatedAt: stamp,
});

export type StrategyTemplateRecord = z.infer<typeof templateRow>;

export type StrategyTemplateInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  industry: string;
  samplingCondition: string;
  evidenceStrength: StrategyTemplateRecord["evidenceStrength"];
  failureCase: string;
  explanation: string;
  successes: number;
  createdAt: string;
  updatedAt: string;
};

const templateColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", industry,
  sampling_condition AS "samplingCondition", evidence_strength AS "evidenceStrength",
  failure_case AS "failureCase", explanation, strategy_label AS "strategyLabel",
  guaranteed, successes, created_at AS "createdAt", updated_at AS "updatedAt"`;

export function strategyTemplatesForBrandQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${templateColumns} FROM strategy_template
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, strategyTemplateListLimit] as QueryValue[],
  };
}

export class StrategyTemplateDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async templatesForBrand(ownerId: string, brandId: string) {
    const query = strategyTemplatesForBrandQuery(ownerId, brandId);
    return z.array(templateRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async templateForOwner(ownerId: string, templateId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${templateColumns} FROM strategy_template
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      [ownerId, templateId],
    );
    const parsed = z.array(templateRow).parse(rows);
    return parsed[0] ?? null;
  }

  async insertTemplate(row: StrategyTemplateInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO strategy_template (
        id, brand_id, owner_id, industry, sampling_condition, evidence_strength,
        failure_case, explanation, strategy_label, guaranteed, successes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'observation', 0, ?, ?, ?)`,
      [
        row.id,
        row.brandId,
        row.ownerId,
        row.industry,
        row.samplingCondition,
        row.evidenceStrength,
        row.failureCase,
        row.explanation,
        row.successes,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}
