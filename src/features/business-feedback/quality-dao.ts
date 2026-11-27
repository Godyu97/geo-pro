import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const count = z.number().int().min(0).max(1_000_000_000);
export const leadQualityListLimit = 100;

const ruleRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  version: z.number().int().min(1).max(10_000),
  frozen: flag,
  requiresRealNeed: flag,
  requiresIndustry: flag,
  requiresFollowUp: flag,
  createdAt: z.iso.datetime({ precision: 3 }),
});

const qualificationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  ruleId: brandIdSchema,
  ruleVersion: z.number().int().min(1).max(10_000),
  status: z.enum(["unfrozen", "qualified", "disqualified"]),
  realNeed: flag,
  targetIndustry: flag,
  followUp: flag,
  createdAt: z.iso.datetime({ precision: 3 }),
});

const observationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  identifiedReferrals: count,
  sessionDenominator: count.nullable(),
  selfReported: count,
  crawlerVisits: count,
  answerCitations: count,
  calledIncluded: z.literal(0),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const wholeCount = z.union([z.number(), z.string(), z.bigint()]).transform((value) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid-lead-count");
  return count;
});

const observationRollupRow = z.object({
  identified: wholeCount,
  denominator: wholeCount,
  crawlerVisits: wholeCount,
  answerCitations: wholeCount,
});

const qualifiedCountRow = z.object({
  qualified: z.union([z.number(), z.string(), z.bigint()]),
}).transform((row) => {
  const qualified = Number(row.qualified);
  if (!Number.isSafeInteger(qualified) || qualified < 0) throw new Error("invalid-qualified-count");
  return qualified;
});

export type LeadValidityRuleRecord = z.infer<typeof ruleRow>;
export type LeadQualificationRecord = z.infer<typeof qualificationRow>;
export type LeadObservationRecord = z.infer<typeof observationRow>;

const ruleColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", version, frozen,
  requires_real_need AS "requiresRealNeed", requires_industry AS "requiresIndustry",
  requires_follow_up AS "requiresFollowUp", created_at AS "createdAt"`;

const qualificationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", rule_id AS "ruleId",
  rule_version AS "ruleVersion", status, real_need AS "realNeed", target_industry AS "targetIndustry",
  follow_up AS "followUp", created_at AS "createdAt"`;

const observationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  identified_referrals AS "identifiedReferrals", session_denominator AS "sessionDenominator",
  self_reported AS "selfReported", crawler_visits AS "crawlerVisits",
  answer_citations AS "answerCitations", called_included AS "calledIncluded", created_at AS "createdAt"`;

export function leadValidityRuleListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${ruleColumns} FROM lead_validity_rule
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY version ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, leadQualityListLimit] as QueryValue[],
  };
}

export function leadQualificationListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${qualificationColumns} FROM lead_qualification
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, leadQualityListLimit] as QueryValue[],
  };
}

export function leadQualifiedCountQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT count(*) AS "qualified" FROM lead_qualification
      WHERE owner_id = ? AND brand_id = ? AND status = 'qualified'`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function leadObservationRollupQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT
        COALESCE(SUM(CASE WHEN session_denominator > 0 THEN identified_referrals ELSE 0 END), 0) AS "identified",
        COALESCE(SUM(CASE WHEN session_denominator > 0 THEN session_denominator ELSE 0 END), 0) AS "denominator",
        COALESCE(SUM(crawler_visits), 0) AS "crawlerVisits",
        COALESCE(SUM(answer_citations), 0) AS "answerCitations"
      FROM lead_observation
      WHERE owner_id = ? AND brand_id = ?`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function leadObservationListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${observationColumns} FROM lead_observation
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, brandId, leadQualityListLimit] as QueryValue[],
  };
}

export class LeadQualityDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertRule(row: LeadValidityRuleRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO lead_validity_rule (
        id, brand_id, owner_id, version, frozen, requires_real_need, requires_industry, requires_follow_up, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.version, row.frozen,
        row.requiresRealNeed, row.requiresIndustry, row.requiresFollowUp, row.createdAt,
      ],
    );
  }

  async insertQualification(row: LeadQualificationRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO lead_qualification (
        id, brand_id, owner_id, rule_id, rule_version, status, real_need, target_industry, follow_up, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.ruleId, row.ruleVersion, row.status,
        row.realNeed, row.targetIndustry, row.followUp, row.createdAt,
      ],
    );
  }

  async insertObservation(row: LeadObservationRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO lead_observation (
        id, brand_id, owner_id, identified_referrals, session_denominator, self_reported,
        crawler_visits, answer_citations, called_included, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.identifiedReferrals, row.sessionDenominator, row.selfReported,
        row.crawlerVisits, row.answerCitations, row.calledIncluded, row.createdAt,
      ],
    );
  }

  async latestRule(ownerId: string, brandId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${ruleColumns} FROM lead_validity_rule
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY version DESC, id DESC
       LIMIT 1${lock}`,
      [ownerId, brandId],
    );
    return row ? ruleRow.parse(row) : null;
  }

  async ruleBrandId(id: string) {
    const [row] = await queryWithParameters(this.db,
      `SELECT brand_id FROM lead_validity_rule WHERE id = ?`, [id]);
    return typeof row?.brand_id === "string" ? row.brand_id : null;
  }

  async ruleForOwner(ownerId: string, ruleId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${ruleColumns} FROM lead_validity_rule WHERE id = ? AND owner_id = ? LIMIT 1`,
      [ruleId, ownerId],
    );
    return row ? ruleRow.parse(row) : null;
  }

  async freeze(ownerId: string, ruleId: string) {
    await queryWithParameters(
      this.db,
      `UPDATE lead_validity_rule SET frozen = 1 WHERE id = ? AND owner_id = ?`,
      [ruleId, ownerId],
    );
    return this.ruleForOwner(ownerId, ruleId);
  }

  async frozenRulesForBrand(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(this.db,
      `SELECT ${ruleColumns} FROM lead_validity_rule
       WHERE owner_id = ? AND brand_id = ? AND frozen = 1 ORDER BY version DESC`,
      [ownerId, brandId],
    );
    return z.array(ruleRow).parse(rows);
  }

  async rulesForBrand(ownerId: string, brandId: string) {
    const query = leadValidityRuleListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(ruleRow).parse(rows);
  }

  async qualificationsForBrand(ownerId: string, brandId: string) {
    const query = leadQualificationListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(qualificationRow).parse(rows);
  }

  async qualifiedCount(ownerId: string, brandId: string) {
    const query = leadQualifiedCountQuery(ownerId, brandId);
    const [row] = await queryWithParameters(this.db, query.sql, query.values);
    return qualifiedCountRow.parse(row);
  }

  async observationRollup(ownerId: string, brandId: string) {
    const query = leadObservationRollupQuery(ownerId, brandId);
    const [row] = await queryWithParameters(this.db, query.sql, query.values);
    return observationRollupRow.parse(row);
  }

  async observationsForBrand(ownerId: string, brandId: string) {
    const query = leadObservationListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(observationRow).parse(rows);
  }
}
