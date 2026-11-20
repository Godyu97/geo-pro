import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  batchStatusSchema,
  briefStatusSchema,
  templateKindSchema,
  unitStatusSchema,
} from "./contracts.ts";

const planRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  questionCluster: z.string().min(1),
  coverageJson: z.string().min(2),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const briefRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  planId: brandIdSchema.nullable(),
  optimizationTaskId: brandIdSchema.nullable(),
  status: briefStatusSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const briefVersionRow = z.object({
  id: brandIdSchema,
  briefId: brandIdSchema,
  brandId: brandIdSchema,
  revision: z.int().positive(),
  audience: z.string(),
  targetGap: z.string(),
  applicableBoundary: z.string(),
  primaryPage: z.string(),
  conversionAction: z.string(),
  templateKind: templateKindSchema,
  titleCandidatesJson: z.string(),
  factVersionIdsJson: z.string(),
  competitorSource: z.string().nullable(),
  confirmedAt: z.iso.datetime({ precision: 3 }).nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const batchRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  status: batchStatusSchema,
  reservationId: z.string().nullable(),
  operationId: brandIdSchema,
  costLedgerJson: z.string().min(2),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const unitRow = z.object({
  id: brandIdSchema,
  batchId: brandIdSchema,
  briefId: brandIdSchema,
  brandId: brandIdSchema,
  status: unitStatusSchema,
  attemptCount: z.int().min(0),
  contentVersionId: brandIdSchema.nullable(),
  lastError: z.string().nullable(),
  blockedReason: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const versionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  briefId: brandIdSchema,
  briefVersionId: brandIdSchema,
  batchUnitId: brandIdSchema,
  templateKind: templateKindSchema,
  title: z.string(),
  bodyMarkdown: z.string(),
  claimsJson: z.string(),
  status: z.literal("draft"),
  fingerprint: z.string(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type PlanRow = z.infer<typeof planRow>;
export type BriefRow = z.infer<typeof briefRow>;
export type BriefVersionRow = z.infer<typeof briefVersionRow>;
export type BatchRow = z.infer<typeof batchRow>;
export type UnitRow = z.infer<typeof unitRow>;
export type ContentVersionRow = z.infer<typeof versionRow>;

const planColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", question_cluster AS "questionCluster",
  coverage_json AS "coverageJson", created_at AS "createdAt", updated_at AS "updatedAt"`;

const briefColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", plan_id AS "planId",
  optimization_task_id AS "optimizationTaskId", status, created_at AS "createdAt", updated_at AS "updatedAt"`;

const briefVersionColumns = `id, brief_id AS "briefId", brand_id AS "brandId", revision,
  audience, target_gap AS "targetGap", applicable_boundary AS "applicableBoundary",
  primary_page AS "primaryPage", conversion_action AS "conversionAction",
  template_kind AS "templateKind", title_candidates_json AS "titleCandidatesJson",
  fact_version_ids_json AS "factVersionIdsJson", competitor_source AS "competitorSource",
  confirmed_at AS "confirmedAt", created_at AS "createdAt"`;

const batchColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", status,
  reservation_id AS "reservationId", operation_id AS "operationId",
  cost_ledger_json AS "costLedgerJson", created_at AS "createdAt", updated_at AS "updatedAt"`;

const unitColumns = `id, batch_id AS "batchId", brief_id AS "briefId", brand_id AS "brandId", status,
  attempt_count AS "attemptCount", content_version_id AS "contentVersionId",
  last_error AS "lastError", blocked_reason AS "blockedReason",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const versionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", brief_id AS "briefId",
  brief_version_id AS "briefVersionId", batch_unit_id AS "batchUnitId",
  template_kind AS "templateKind", title, body_markdown AS "bodyMarkdown",
  claims_json AS "claimsJson", status, fingerprint, created_at AS "createdAt"`;

export class ContentDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.db, sql, values);
  }

  async insertPlan(row: PlanRow) {
    await this.query(
      `INSERT INTO content_plan (id, brand_id, owner_id, question_cluster, coverage_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.questionCluster, row.coverageJson, row.createdAt, row.updatedAt],
    );
  }

  async updatePlanCoverage(id: string, coverageJson: string, updatedAt: string) {
    await this.query(
      `UPDATE content_plan SET coverage_json = ?, updated_at = ? WHERE id = ?`,
      [coverageJson, updatedAt, id],
    );
  }

  async getPlan(ownerId: string, brandId: string, planId: string) {
    const [row] = await this.query(
      `SELECT ${planColumns} FROM content_plan WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, planId],
    );
    return row ? planRow.parse(row) : null;
  }

  async getPlanByCluster(ownerId: string, brandId: string, questionCluster: string) {
    const [row] = await this.query(
      `SELECT ${planColumns} FROM content_plan WHERE owner_id = ? AND brand_id = ? AND question_cluster = ?`,
      [ownerId, brandId, questionCluster],
    );
    return row ? planRow.parse(row) : null;
  }

  async listPlans(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${planColumns} FROM content_plan
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => planRow.parse(row));
  }

  async insertBrief(row: BriefRow) {
    await this.query(
      `INSERT INTO content_brief
        (id, brand_id, owner_id, plan_id, optimization_task_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.planId, row.optimizationTaskId, row.status, row.createdAt, row.updatedAt],
    );
  }

  async updateBriefStatus(id: string, status: string, updatedAt: string) {
    await this.query(
      `UPDATE content_brief SET status = ?, updated_at = ? WHERE id = ?`,
      [status, updatedAt, id],
    );
  }

  async getBrief(ownerId: string, brandId: string, briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefColumns} FROM content_brief WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, briefId],
    );
    return row ? briefRow.parse(row) : null;
  }

  async getBriefByIdForOwner(ownerId: string, briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefColumns} FROM content_brief WHERE owner_id = ? AND id = ?`,
      [ownerId, briefId],
    );
    return row ? briefRow.parse(row) : null;
  }

  async listBriefs(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${briefColumns} FROM content_brief
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => briefRow.parse(row));
  }

  async insertBriefVersion(row: BriefVersionRow) {
    await this.query(
      `INSERT INTO content_brief_version (
        id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary,
        primary_page, conversion_action, template_kind, title_candidates_json,
        fact_version_ids_json, competitor_source, confirmed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.briefId, row.brandId, row.revision, row.audience, row.targetGap,
        row.applicableBoundary, row.primaryPage, row.conversionAction, row.templateKind,
        row.titleCandidatesJson, row.factVersionIdsJson, row.competitorSource,
        row.confirmedAt, row.createdAt,
      ],
    );
  }

  async latestBriefVersion(briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefVersionColumns} FROM content_brief_version
       WHERE brief_id = ? ORDER BY revision DESC LIMIT 1`,
      [briefId],
    );
    return row ? briefVersionRow.parse(row) : null;
  }

  async getBriefVersion(id: string) {
    const [row] = await this.query(
      `SELECT ${briefVersionColumns} FROM content_brief_version WHERE id = ?`,
      [id],
    );
    return row ? briefVersionRow.parse(row) : null;
  }

  async markBriefVersionConfirmed(id: string, confirmedAt: string) {
    await this.query(
      `UPDATE content_brief_version SET confirmed_at = ? WHERE id = ?`,
      [confirmedAt, id],
    );
  }

  async insertBatch(row: BatchRow) {
    await this.query(
      `INSERT INTO content_batch (
        id, brand_id, owner_id, status, reservation_id, operation_id, cost_ledger_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.status, row.reservationId, row.operationId,
        row.costLedgerJson, row.createdAt, row.updatedAt,
      ],
    );
  }

  async getBatchByOperation(brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE brand_id = ? AND operation_id = ?`,
      [brandId, operationId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async getBatch(ownerId: string, brandId: string, batchId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, batchId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async getBatchByIdForOwner(ownerId: string, batchId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE owner_id = ? AND id = ?`,
      [ownerId, batchId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async updateBatch(row: Pick<BatchRow, "id" | "status" | "reservationId" | "costLedgerJson" | "updatedAt">) {
    await this.query(
      `UPDATE content_batch SET status = ?, reservation_id = ?, cost_ledger_json = ?, updated_at = ? WHERE id = ?`,
      [row.status, row.reservationId, row.costLedgerJson, row.updatedAt, row.id],
    );
  }

  async insertUnit(row: UnitRow) {
    await this.query(
      `INSERT INTO content_batch_unit (
        id, batch_id, brief_id, brand_id, status, attempt_count, content_version_id,
        last_error, blocked_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.batchId, row.briefId, row.brandId, row.status, row.attemptCount,
        row.contentVersionId, row.lastError, row.blockedReason, row.createdAt, row.updatedAt,
      ],
    );
  }

  async listUnits(batchId: string) {
    const rows = await this.query(
      `SELECT ${unitColumns} FROM content_batch_unit WHERE batch_id = ? ORDER BY created_at ASC, id ASC`,
      [batchId],
    );
    return rows.map((row) => unitRow.parse(row));
  }

  async updateUnit(row: UnitRow) {
    await this.query(
      `UPDATE content_batch_unit SET
        status = ?, attempt_count = ?, content_version_id = ?, last_error = ?,
        blocked_reason = ?, updated_at = ?
       WHERE id = ?`,
      [
        row.status, row.attemptCount, row.contentVersionId, row.lastError,
        row.blockedReason, row.updatedAt, row.id,
      ],
    );
  }

  async insertContentVersion(row: ContentVersionRow) {
    await this.query(
      `INSERT INTO content_version (
        id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id,
        template_kind, title, body_markdown, claims_json, status, fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.briefId, row.briefVersionId, row.batchUnitId,
        row.templateKind, row.title, row.bodyMarkdown, row.claimsJson, row.status,
        row.fingerprint, row.createdAt,
      ],
    );
  }

  async getContentVersion(ownerId: string, versionId: string) {
    const [row] = await this.query(
      `SELECT ${versionColumns} FROM content_version WHERE owner_id = ? AND id = ?`,
      [ownerId, versionId],
    );
    return row ? versionRow.parse(row) : null;
  }

  async listContentVersionsForBrand(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${versionColumns} FROM content_version
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => versionRow.parse(row));
  }
}
