import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  actionDraftStatusSchema,
  assumptionLevelSchema,
  gapTypeSchema,
  pagePublicStatusSchema,
  priorityBucketSchema,
  taskStatusSchema,
} from "./contracts.ts";

const findingRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  gapType: gapTypeSchema,
  questionCluster: z.string().min(1),
  targetPage: z.string().min(1),
  observationId: brandIdSchema.nullable(),
  analysisVersionId: brandIdSchema.nullable(),
  evidenceSummary: z.string(),
  problemStatement: z.string(),
  hypothesis: z.string(),
  assumptionLevel: assumptionLevelSchema,
  stepsJson: z.string(),
  completionCriteria: z.string(),
  retestMethod: z.string(),
  businessImportance: z.int().min(1).max(3),
  estimatedEffort: z.int().min(1).max(5),
  verifiedEvidence: z.union([z.literal(0), z.literal(1)]),
  privacyRisk: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const taskRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  primaryFindingId: brandIdSchema,
  gapType: gapTypeSchema,
  questionCluster: z.string().min(1),
  targetPage: z.string().min(1),
  title: z.string(),
  status: taskStatusSchema,
  priorityBucket: priorityBucketSchema,
  manualRank: z.int().positive().nullable(),
  reorderReason: z.string().nullable(),
  completionNote: z.string().nullable(),
  dismissReason: z.string().nullable(),
  retestConclusion: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const pageCheckRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  taskId: brandIdSchema.nullable(),
  url: z.string(),
  normalizedUrl: z.string(),
  checkedAt: z.iso.datetime({ precision: 3 }),
  accessCondition: z.string(),
  publicStatus: pagePublicStatusSchema,
  title: z.string().nullable(),
  bodyExcerpt: z.string().nullable(),
  keyFactsJson: z.string(),
  discoverabilityNotes: z.string(),
  containsExecutableInstructions: z.union([z.literal(0), z.literal(1)]),
  manualEvidenceRef: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const actionDraftRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  evidenceIds: z.string().min(38).max(400),
  gapType: gapTypeSchema,
  observedGap: z.string().min(1).max(500),
  hypothesis: z.string().min(1).max(500),
  assumptionLevel: assumptionLevelSchema,
  questionCluster: z.string().min(1),
  targetPage: z.string().min(1),
  status: actionDraftStatusSchema,
  modelName: z.string().min(1).max(128),
  taskId: brandIdSchema.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const evidenceIdList = z.array(brandIdSchema).min(1).max(5);

export type FindingRow = z.infer<typeof findingRow>;
export type TaskRow = z.infer<typeof taskRow>;
export type PageCheckRow = z.infer<typeof pageCheckRow>;
export type ActionDraftRow = Omit<z.infer<typeof actionDraftRow>, "evidenceIds"> & { evidenceIds: string[] };

function presentActionDraft(row: z.infer<typeof actionDraftRow>): ActionDraftRow {
  return { ...row, evidenceIds: evidenceIdList.parse(JSON.parse(row.evidenceIds)) };
}

const findingColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", gap_type AS "gapType",
  question_cluster AS "questionCluster", target_page AS "targetPage",
  observation_id AS "observationId", analysis_version_id AS "analysisVersionId",
  evidence_summary AS "evidenceSummary", problem_statement AS "problemStatement",
  hypothesis, assumption_level AS "assumptionLevel", steps_json AS "stepsJson",
  completion_criteria AS "completionCriteria", retest_method AS "retestMethod",
  business_importance AS "businessImportance", estimated_effort AS "estimatedEffort",
  verified_evidence AS "verifiedEvidence", privacy_risk AS "privacyRisk",
  created_at AS "createdAt"`;

const taskColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  primary_finding_id AS "primaryFindingId", gap_type AS "gapType",
  question_cluster AS "questionCluster", target_page AS "targetPage", title, status,
  priority_bucket AS "priorityBucket", manual_rank AS "manualRank",
  reorder_reason AS "reorderReason", completion_note AS "completionNote",
  dismiss_reason AS "dismissReason", retest_conclusion AS "retestConclusion",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const actionDraftColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", evidence_ids AS "evidenceIds",
  gap_type AS "gapType", observed_gap AS "observedGap", hypothesis,
  assumption_level AS "assumptionLevel", question_cluster AS "questionCluster",
  target_page AS "targetPage", status, model_name AS "modelName", task_id AS "taskId",
  created_at AS "createdAt"`;

const pageColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", task_id AS "taskId",
  url, normalized_url AS "normalizedUrl", checked_at AS "checkedAt",
  access_condition AS "accessCondition", public_status AS "publicStatus",
  title, body_excerpt AS "bodyExcerpt", key_facts_json AS "keyFactsJson",
  discoverability_notes AS "discoverabilityNotes",
  contains_executable_instructions AS "containsExecutableInstructions",
  manual_evidence_ref AS "manualEvidenceRef", created_at AS "createdAt"`;

export class OptimizationDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertFinding(row: FindingRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO optimization_finding (
        id, brand_id, owner_id, gap_type, question_cluster, target_page,
        observation_id, analysis_version_id, evidence_summary, problem_statement,
        hypothesis, assumption_level, steps_json, completion_criteria, retest_method,
        business_importance, estimated_effort, verified_evidence, privacy_risk, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.gapType, row.questionCluster, row.targetPage,
        row.observationId, row.analysisVersionId, row.evidenceSummary, row.problemStatement,
        row.hypothesis, row.assumptionLevel, row.stepsJson, row.completionCriteria, row.retestMethod,
        row.businessImportance, row.estimatedEffort, row.verifiedEvidence, row.privacyRisk, row.createdAt,
      ],
    );
  }

  async deleteTaskGraph(ownerId: string, brandId: string, taskId: string, findingId: string) {
    await queryWithParameters(
      this.db,
      `DELETE FROM optimization_task_evidence WHERE task_id = ? AND brand_id = ?`,
      [taskId, brandId],
    );
    await queryWithParameters(
      this.db,
      `DELETE FROM optimization_task WHERE id = ? AND owner_id = ? AND brand_id = ?`,
      [taskId, ownerId, brandId],
    );
    await queryWithParameters(
      this.db,
      `DELETE FROM optimization_finding WHERE id = ? AND owner_id = ? AND brand_id = ?`,
      [findingId, ownerId, brandId],
    );
  }

  async insertTask(row: TaskRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO optimization_task (
        id, brand_id, owner_id, primary_finding_id, gap_type, question_cluster, target_page,
        title, status, priority_bucket, manual_rank, reorder_reason, completion_note,
        dismiss_reason, retest_conclusion, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.primaryFindingId, row.gapType, row.questionCluster,
        row.targetPage, row.title, row.status, row.priorityBucket, row.manualRank, row.reorderReason,
        row.completionNote, row.dismissReason, row.retestConclusion, row.createdAt, row.updatedAt,
      ],
    );
  }

  async linkEvidence(taskId: string, findingId: string, brandId: string, createdAt: string) {
    await queryWithParameters(
      this.db,
      `INSERT INTO optimization_task_evidence (task_id, finding_id, brand_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (task_id, finding_id) DO NOTHING`,
      [taskId, findingId, brandId, createdAt],
    );
  }

  async findOpenTask(params: {
    ownerId: string;
    brandId: string;
    questionCluster: string;
    targetPage: string;
    gapType: string;
  }) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${taskColumns}
       FROM optimization_task
       WHERE owner_id = ? AND brand_id = ? AND question_cluster = ? AND target_page = ? AND gap_type = ?
         AND status NOT IN ('closed', 'dismissed')
       LIMIT 1`,
      [params.ownerId, params.brandId, params.questionCluster, params.targetPage, params.gapType],
    );
    return row ? taskRow.parse(row) : null;
  }

  async listTasks(params: {
    ownerId: string;
    brandId: string;
    status?: string;
    limit: number;
  }) {
    const values: QueryValue[] = [params.ownerId, params.brandId];
    let sql = `SELECT ${taskColumns}
      FROM optimization_task
      WHERE owner_id = ? AND brand_id = ?`;
    if (params.status) {
      sql += " AND status = ?";
      values.push(params.status);
    }
    sql += " ORDER BY updated_at DESC, id DESC LIMIT ?";
    values.push(params.limit);
    const rows = await queryWithParameters(this.db, sql, values);
    return rows.map((row) => taskRow.parse(row));
  }

  async getTask(ownerId: string, brandId: string, taskId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${taskColumns} FROM optimization_task WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, taskId],
    );
    return row ? taskRow.parse(row) : null;
  }

  async getTaskByIdForOwner(ownerId: string, taskId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${taskColumns} FROM optimization_task WHERE owner_id = ? AND id = ?`,
      [ownerId, taskId],
    );
    return row ? taskRow.parse(row) : null;
  }

  async listFindingsForTask(taskId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT f.id, f.brand_id AS "brandId", f.owner_id AS "ownerId", f.gap_type AS "gapType",
              f.question_cluster AS "questionCluster", f.target_page AS "targetPage",
              f.observation_id AS "observationId", f.analysis_version_id AS "analysisVersionId",
              f.evidence_summary AS "evidenceSummary", f.problem_statement AS "problemStatement",
              f.hypothesis, f.assumption_level AS "assumptionLevel", f.steps_json AS "stepsJson",
              f.completion_criteria AS "completionCriteria", f.retest_method AS "retestMethod",
              f.business_importance AS "businessImportance", f.estimated_effort AS "estimatedEffort",
              f.verified_evidence AS "verifiedEvidence", f.privacy_risk AS "privacyRisk",
              f.created_at AS "createdAt"
       FROM optimization_task_evidence e
       JOIN optimization_finding f ON f.id = e.finding_id
       WHERE e.task_id = ?
       ORDER BY e.created_at ASC, f.id ASC`,
      [taskId],
    );
    return rows.map((row) => findingRow.parse(row));
  }

  async updateTask(row: TaskRow) {
    await queryWithParameters(
      this.db,
      `UPDATE optimization_task SET
        status = ?, priority_bucket = ?, manual_rank = ?, reorder_reason = ?,
        completion_note = ?, dismiss_reason = ?, retest_conclusion = ?, updated_at = ?
       WHERE id = ? AND brand_id = ? AND owner_id = ?`,
      [
        row.status, row.priorityBucket, row.manualRank, row.reorderReason,
        row.completionNote, row.dismissReason, row.retestConclusion, row.updatedAt,
        row.id, row.brandId, row.ownerId,
      ],
    );
  }

  async insertPageCheck(row: PageCheckRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO page_check_record (
        id, brand_id, owner_id, task_id, url, normalized_url, checked_at, access_condition,
        public_status, title, body_excerpt, key_facts_json, discoverability_notes,
        contains_executable_instructions, manual_evidence_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.taskId, row.url, row.normalizedUrl, row.checkedAt,
        row.accessCondition, row.publicStatus, row.title, row.bodyExcerpt, row.keyFactsJson,
        row.discoverabilityNotes, row.containsExecutableInstructions, row.manualEvidenceRef, row.createdAt,
      ],
    );
  }

  async listPageChecks(ownerId: string, brandId: string, taskId?: string) {
    const values: QueryValue[] = [ownerId, brandId];
    let sql = `SELECT ${pageColumns} FROM page_check_record WHERE owner_id = ? AND brand_id = ?`;
    if (taskId) {
      sql += " AND task_id = ?";
      values.push(taskId);
    }
    sql += " ORDER BY checked_at DESC, id DESC LIMIT 50";
    const rows = await queryWithParameters(this.db, sql, values);
    return rows.map((row) => pageCheckRow.parse(row));
  }

  async listOpenTasksWithFindings(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT t.id, t.brand_id AS "brandId", t.owner_id AS "ownerId",
              t.primary_finding_id AS "primaryFindingId", t.gap_type AS "gapType",
              t.question_cluster AS "questionCluster", t.target_page AS "targetPage",
              t.title, t.status, t.priority_bucket AS "priorityBucket",
              t.manual_rank AS "manualRank", t.reorder_reason AS "reorderReason",
              t.completion_note AS "completionNote", t.dismiss_reason AS "dismissReason",
              t.retest_conclusion AS "retestConclusion",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt",
              f.business_importance AS "businessImportance",
              f.verified_evidence AS "verifiedEvidence",
              f.estimated_effort AS "estimatedEffort"
       FROM optimization_task t
       JOIN optimization_finding f ON f.id = t.primary_finding_id
       WHERE t.owner_id = ? AND t.brand_id = ? AND t.status NOT IN ('closed', 'dismissed')`,
      [ownerId, brandId],
    );
    return rows.map((row) => ({
      task: taskRow.parse(row),
      businessImportance: z.int().min(1).max(3).parse(row.businessImportance),
      verifiedEvidence: z.union([z.literal(0), z.literal(1)]).parse(row.verifiedEvidence),
      estimatedEffort: z.int().min(1).max(5).parse(row.estimatedEffort),
    }));
  }

  async getFinding(id: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${findingColumns} FROM optimization_finding WHERE id = ?`,
      [id],
    );
    return row ? findingRow.parse(row) : null;
  }

  async insertActionDraft(row: ActionDraftRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO optimization_action_draft (
        id, brand_id, owner_id, evidence_ids, gap_type, observed_gap, hypothesis,
        assumption_level, question_cluster, target_page, status, model_name, task_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, JSON.stringify(row.evidenceIds), row.gapType,
        row.observedGap, row.hypothesis, row.assumptionLevel, row.questionCluster, row.targetPage,
        row.status, row.modelName, row.taskId, row.createdAt,
      ],
    );
  }

  async listOpenActionDrafts(ownerId: string, brandId: string, limit: number, evidenceId?: string) {
    const values: QueryValue[] = [ownerId, brandId];
    let sql = `SELECT ${actionDraftColumns}
      FROM optimization_action_draft
      WHERE owner_id = ? AND brand_id = ? AND status = 'draft'`;
    if (evidenceId) {
      sql += " AND evidence_ids LIKE ?";
      values.push(`%"${evidenceId}"%`);
    }
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
    values.push(limit);
    const rows = await queryWithParameters(this.db, sql, values);
    return rows.map((row) => presentActionDraft(actionDraftRow.parse(row)));
  }

  async actionDraftForOwner(ownerId: string, brandId: string, draftId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${actionDraftColumns}
       FROM optimization_action_draft
       WHERE id = ? AND owner_id = ? AND brand_id = ?`,
      [draftId, ownerId, brandId],
    );
    return row ? presentActionDraft(actionDraftRow.parse(row)) : null;
  }

  async confirmActionDraft(row: ActionDraftRow) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE optimization_action_draft
       SET status = 'confirmed', task_id = ?, observed_gap = ?, hypothesis = ?
       WHERE id = ? AND owner_id = ? AND brand_id = ? AND status = 'draft'
       RETURNING id`,
      [row.taskId, row.observedGap, row.hypothesis, row.id, row.ownerId, row.brandId],
    );
    return rows.length === 1;
  }

  async dismissActionDraft(id: string, ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE optimization_action_draft SET status = 'dismissed'
       WHERE id = ? AND owner_id = ? AND brand_id = ? AND status = 'draft'
       RETURNING id`,
      [id, ownerId, brandId],
    );
    return rows.length === 1;
  }
}
