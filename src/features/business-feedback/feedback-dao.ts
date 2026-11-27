import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { leadEvidenceSchema } from "./contracts.ts";
import { followUpOutcomes, qualificationStatuses } from "./feedback-contracts.ts";

const nullableFlag = z.union([z.literal(0), z.literal(1), z.null()]);
const feedbackRow = z.object({
  id: brandIdSchema,
  leadId: brandIdSchema,
  ruleId: brandIdSchema,
  ruleVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(qualificationStatuses),
  realNeed: nullableFlag,
  targetIndustry: nullableFlag,
  canFollowUp: nullableFlag,
  outcome: z.enum(followUpOutcomes),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type LeadFeedback = z.infer<typeof feedbackRow>;

const columns = `f.id, f.lead_id AS "leadId", f.rule_id AS "ruleId", r.version AS "ruleVersion",
  f.revision, f.status, f.real_need AS "realNeed", f.target_industry AS "targetIndustry",
  f.can_follow_up AS "canFollowUp", f.outcome, f.created_at AS "createdAt"`;

const reportRow = z.object({
  leadId: brandIdSchema,
  primary: leadEvidenceSchema,
  feedbackId: brandIdSchema.nullable(),
  status: z.enum(qualificationStatuses).nullable(),
  outcome: z.enum(followUpOutcomes).nullable(),
});

export function currentLeadFeedbackQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT l.id AS "leadId", l.primary_class AS "primary", f.id AS "feedbackId", f.status, f.outcome
      FROM business_lead l
      LEFT JOIN lead_feedback f ON f.lead_id = l.id AND f.revision = (
        SELECT MAX(latest.revision) FROM lead_feedback latest WHERE latest.lead_id = l.id
      )
      WHERE l.owner_id = ? AND l.brand_id = ?
      ORDER BY l.created_at, l.id`,
    values: [ownerId, brandId],
  };
}

export class LeadFeedbackDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async lockLead(ownerId: string, brandId: string, leadId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [lead] = await queryWithParameters(this.db,
      `SELECT id FROM business_lead WHERE id = ? AND owner_id = ? AND brand_id = ?${lock}`,
      [leadId, ownerId, brandId],
    );
    return Boolean(lead);
  }

  async read(leadId: string, feedbackId?: string) {
    const [row] = await queryWithParameters(this.db,
      `SELECT ${columns} FROM lead_feedback f JOIN lead_validity_rule r ON r.id = f.rule_id
       WHERE f.lead_id = ? ${feedbackId ? "AND f.id = ?" : ""}
       ORDER BY f.revision DESC LIMIT 1`,
      feedbackId ? [leadId, feedbackId] : [leadId],
    );
    return row ? feedbackRow.parse(row) : null;
  }

  async currentForBrand(ownerId: string, brandId: string) {
    const query = currentLeadFeedbackQuery(ownerId, brandId);
    return z.array(reportRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async insert(row: LeadFeedback, actorId: string) {
    await queryWithParameters(this.db,
      `INSERT INTO lead_feedback (
        id, lead_id, rule_id, revision, status, real_need, target_industry, can_follow_up, outcome, recorded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.leadId, row.ruleId, row.revision, row.status, row.realNeed, row.targetIndustry,
        row.canFollowUp, row.outcome, actorId, row.createdAt],
    );
  }
}
