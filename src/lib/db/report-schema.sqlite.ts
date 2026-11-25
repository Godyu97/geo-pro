import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const reportRetest = sqliteTable("report_retest", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  intent: text("intent").notNull(),
  track: text("track").notNull(),
  timezone: text("timezone").notNull(),
  entityVersion: integer("entity_version").notNull(),
  beforeRunId: text("before_run_id"),
  afterRunId: text("after_run_id"),
  publicationId: text("publication_id"),
  effectiveAt: text("effective_at"),
  operationId: text("operation_id").notNull(),
  comparisonJson: text("comparison_json"),
  blockReason: text("block_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("report_retest_operation_uidx").on(table.brandId, table.operationId),
  index("report_retest_brand_idx").on(table.brandId, table.updatedAt, table.id),
  index("report_retest_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("report_retest_state_check", sql`${table.kind} in ('exploratory', 'd7_reminder', 'diagnostic')
    and ${table.status} in ('scheduled', 'due', 'running', 'completed', 'inconclusive', 'blocked')
    and ${table.intent} in ('business_loop', 'diagnostic')
    and ${table.track} in ('model_api', 'consumer_ui')
    and ${table.entityVersion} > 0
    and length(${table.timezone}) > 0
    and length(${table.operationId}) > 0`),
]);

export const reportTodo = sqliteTable("report_todo", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  retestId: text("retest_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  dueAt: text("due_at").notNull(),
  progressJson: text("progress_json").notNull(),
  autoCharge: integer("auto_charge").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "report_todo_retest_fk",
    columns: [table.retestId],
    foreignColumns: [reportRetest.id],
  }).onDelete("cascade"),
  index("report_todo_brand_idx").on(table.brandId, table.dueAt, table.id),
  index("report_todo_owner_idx").on(table.ownerId, table.dueAt, table.id),
  check("report_todo_state_check", sql`${table.kind} in ('d7_reminder')
    and ${table.status} in ('scheduled', 'due', 'done', 'cancelled')
    and ${table.autoCharge} = 0
    and length(${table.progressJson}) > 1`),
]);

export const reportSnapshot = sqliteTable("report_snapshot", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  retestId: text("retest_id").notNull(),
  status: text("status").notNull(),
  grade: text("grade").notNull(),
  intent: text("intent").notNull(),
  loopCompleted: integer("loop_completed").notNull(),
  predecessorId: text("predecessor_id"),
  entityVersion: integer("entity_version").notNull(),
  timezone: text("timezone").notNull(),
  locale: text("locale").notNull(),
  sourceMissing: integer("source_missing").notNull(),
  jsonBytes: text("json_bytes").notNull(),
  htmlBytes: text("html_bytes").notNull(),
  jsonSha256: text("json_sha256").notNull(),
  htmlSha256: text("html_sha256").notNull(),
  operationId: text("operation_id").notNull(),
  createdAt: text("created_at").notNull(),
  // Null keeps historical inline html_bytes / json_bytes readable. New rows point at two immutable objects.
  htmlObjectId: text("html_object_id"),
  jsonObjectId: text("json_object_id"),
}, (table) => [
  foreignKey({
    name: "report_snapshot_retest_fk",
    columns: [table.retestId],
    foreignColumns: [reportRetest.id],
  }).onDelete("cascade"),
  uniqueIndex("report_snapshot_operation_uidx").on(table.brandId, table.operationId),
  index("report_snapshot_brand_idx").on(table.brandId, table.createdAt, table.id),
  index("report_snapshot_owner_idx").on(table.ownerId, table.createdAt, table.id),
  index("report_snapshot_predecessor_idx").on(table.predecessorId),
  uniqueIndex("report_snapshot_html_object_uidx").on(table.htmlObjectId).where(sql`${table.htmlObjectId} is not null`),
  uniqueIndex("report_snapshot_json_object_uidx").on(table.jsonObjectId).where(sql`${table.jsonObjectId} is not null`),
  check("report_snapshot_state_check", sql`${table.status} in ('created', 'superseded')
    and ${table.grade} in ('exploratory', 'incomparable')
    and ${table.intent} in ('business_loop', 'diagnostic')
    and ${table.loopCompleted} in (0, 1)
    and ${table.sourceMissing} in (0, 1)
    and ${table.entityVersion} > 0
    and length(${table.jsonSha256}) = 64
    and length(${table.htmlSha256}) = 64
    and (
      (${table.htmlObjectId} is null and ${table.jsonObjectId} is null
        and length(${table.htmlBytes}) > 1 and length(${table.jsonBytes}) > 1)
      or (${table.htmlObjectId} is not null and ${table.jsonObjectId} is not null
        and ${table.htmlObjectId} <> ${table.jsonObjectId}
        and length(${table.htmlBytes}) = 0 and length(${table.jsonBytes}) = 0)
    )`),
]);

export const reportDecision = sqliteTable("report_decision", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  action: text("action").notNull(),
  decidedBy: text("decided_by").notNull(),
  decidedAt: text("decided_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "report_decision_snapshot_fk",
    columns: [table.snapshotId],
    foreignColumns: [reportSnapshot.id],
  }).onDelete("cascade"),
  uniqueIndex("report_decision_snapshot_action_uidx").on(table.snapshotId, table.action),
  index("report_decision_brand_idx").on(table.brandId, table.ownerId, table.decidedAt, table.id),
  check("report_decision_state_check", sql`${table.action} in ('continue_content', 'supplement_evidence', 'continue_observation', 'stop')
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.snapshotId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.decidedBy}) between 1 and 128
    and length(${table.decidedAt}) between 20 and 40
    and length(${table.createdAt}) between 20 and 40
    and ${table.decidedAt} = ${table.createdAt}`),
]);
