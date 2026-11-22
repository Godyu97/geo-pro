import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

export const optimizationFinding = pgTable("optimization_finding", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  gapType: text("gap_type").notNull(),
  questionCluster: text("question_cluster").notNull(),
  targetPage: text("target_page").notNull(),
  observationId: text("observation_id"),
  analysisVersionId: text("analysis_version_id"),
  evidenceSummary: text("evidence_summary").notNull(),
  problemStatement: text("problem_statement").notNull(),
  hypothesis: text("hypothesis").notNull(),
  assumptionLevel: text("assumption_level").notNull(),
  stepsJson: text("steps_json").notNull(),
  completionCriteria: text("completion_criteria").notNull(),
  retestMethod: text("retest_method").notNull(),
  businessImportance: integer("business_importance").notNull(),
  estimatedEffort: integer("estimated_effort").notNull(),
  verifiedEvidence: integer("verified_evidence").notNull(),
  privacyRisk: integer("privacy_risk").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("optimization_finding_brand_idx").on(table.brandId, table.createdAt, table.id),
  index("optimization_finding_owner_idx").on(table.ownerId, table.createdAt, table.id),
  index("optimization_finding_dedupe_idx").on(table.brandId, table.questionCluster, table.targetPage, table.gapType),
  check("optimization_finding_state_check", sql`${table.gapType} in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and ${table.assumptionLevel} in ('observed_absence', 'verified', 'pending')
    and ${table.businessImportance} between 1 and 3
    and ${table.estimatedEffort} between 1 and 5
    and ${table.verifiedEvidence} in (0, 1)
    and ${table.privacyRisk} in (0, 1)
    and length(${table.questionCluster}) > 0
    and length(${table.targetPage}) > 0`),
]);

export const optimizationTask = pgTable("optimization_task", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  primaryFindingId: text("primary_finding_id").notNull(),
  gapType: text("gap_type").notNull(),
  questionCluster: text("question_cluster").notNull(),
  targetPage: text("target_page").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  priorityBucket: text("priority_bucket").notNull(),
  manualRank: integer("manual_rank"),
  reorderReason: text("reorder_reason"),
  completionNote: text("completion_note"),
  dismissReason: text("dismiss_reason"),
  retestConclusion: text("retest_conclusion"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "optimization_task_finding_fk",
    columns: [table.primaryFindingId],
    foreignColumns: [optimizationFinding.id],
  }).onDelete("restrict"),
  uniqueIndex("optimization_task_open_dedupe_uidx")
    .on(table.brandId, table.questionCluster, table.targetPage, table.gapType)
    .where(sql`${table.status} not in ('closed', 'dismissed')`),
  index("optimization_task_brand_status_idx").on(table.brandId, table.status, table.createdAt, table.id),
  index("optimization_task_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("optimization_task_state_check", sql`${table.gapType} in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and ${table.status} in ('todo', 'doing', 'blocked', 'implemented', 'retest_pending', 'closed', 'dismissed')
    and ${table.priorityBucket} in ('urgent', 'normal')
    and (${table.manualRank} is null or ${table.manualRank} > 0)
    and (
      (${table.status} = 'dismissed' and ${table.dismissReason} is not null)
      or (${table.status} <> 'dismissed')
    )
    and (
      (${table.manualRank} is not null and ${table.reorderReason} is not null)
      or (${table.manualRank} is null)
    )`),
]);

export const optimizationTaskEvidence = pgTable("optimization_task_evidence", {
  taskId: text("task_id").notNull(),
  findingId: text("finding_id").notNull(),
  brandId: text("brand_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.findingId] }),
  foreignKey({
    name: "optimization_task_evidence_task_fk",
    columns: [table.taskId],
    foreignColumns: [optimizationTask.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "optimization_task_evidence_finding_fk",
    columns: [table.findingId],
    foreignColumns: [optimizationFinding.id],
  }).onDelete("cascade"),
  index("optimization_task_evidence_brand_idx").on(table.brandId, table.taskId, table.findingId),
]);

export const pageCheckRecord = pgTable("page_check_record", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  taskId: text("task_id"),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  checkedAt: text("checked_at").notNull(),
  accessCondition: text("access_condition").notNull(),
  publicStatus: text("public_status").notNull(),
  title: text("title"),
  bodyExcerpt: text("body_excerpt"),
  keyFactsJson: text("key_facts_json").notNull(),
  discoverabilityNotes: text("discoverability_notes").notNull(),
  containsExecutableInstructions: integer("contains_executable_instructions").notNull(),
  manualEvidenceRef: text("manual_evidence_ref"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "page_check_task_fk",
    columns: [table.taskId],
    foreignColumns: [optimizationTask.id],
  }).onDelete("set null"),
  index("page_check_brand_idx").on(table.brandId, table.checkedAt, table.id),
  index("page_check_owner_idx").on(table.ownerId, table.checkedAt, table.id),
  check("page_check_state_check", sql`${table.publicStatus} in ('reachable', 'restricted', 'pending_verification', 'not_applicable')
    and ${table.containsExecutableInstructions} in (0, 1)
    and length(${table.url}) > 0
    and length(${table.normalizedUrl}) > 0`),
]);

// Editable diagnosis draft. A task row is written only after a person confirms.
export const optimizationActionDraft = pgTable("optimization_action_draft", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  evidenceIds: text("evidence_ids").notNull(),
  gapType: text("gap_type").notNull(),
  observedGap: text("observed_gap").notNull(),
  hypothesis: text("hypothesis").notNull(),
  assumptionLevel: text("assumption_level").notNull(),
  questionCluster: text("question_cluster").notNull(),
  targetPage: text("target_page").notNull(),
  status: text("status").notNull(),
  modelName: text("model_name").notNull(),
  taskId: text("task_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("optimization_action_draft_owner_idx").on(table.ownerId, table.brandId, table.status, table.createdAt, table.id),
  check("optimization_action_draft_state_check", sql`${table.gapType} in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and ${table.assumptionLevel} in ('observed_absence', 'verified', 'pending')
    and ${table.status} in ('draft', 'confirmed', 'dismissed')
    and (
      (${table.status} = 'confirmed' and ${table.taskId} is not null)
      or (${table.status} <> 'confirmed' and ${table.taskId} is null)
    )
    and length(${table.modelName}) between 1 and 128
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.evidenceIds}) between 38 and 400
    and length(${table.observedGap}) between 1 and 500
    and length(${table.hypothesis}) between 1 and 500
    and length(${table.questionCluster}) > 0
    and length(${table.targetPage}) > 0`),
]);
