import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, primaryKey, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";

export const brand = sqliteTable("brand", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  revision: integer("revision").notNull(),
  entityVersion: integer("entity_version").notNull(),
  createdAt: text("created_at").notNull(),
  frozenAt: text("frozen_at"),
  restoreUntil: text("restore_until"),
}, (table) => [
  check("brand_status_check", sql`${table.status} in ('active', 'archived')`),
  check("brand_revision_check", sql`${table.entityVersion} > 0 and ${table.revision} >= ${table.entityVersion}`),
  uniqueIndex("brand_active_owner_uidx").on(table.ownerId).where(sql`${table.status} = 'active' and ${table.frozenAt} is null`),
  index("brand_due_purge_idx").on(table.restoreUntil, table.id).where(sql`${table.restoreUntil} is not null`),
  index("brand_owner_frozen_idx").on(table.ownerId, table.frozenAt, table.id).where(sql`${table.frozenAt} is not null`),
  index("brand_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt, table.id),
]);

export const brandVersion = sqliteTable("brand_version", {
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.version] }),
  check("brand_version_number_check", sql`${table.version} > 0`),
]);

export const brandDraft = sqliteTable("brand_draft", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  version: text("version").notNull(),
  baseRevision: integer("base_revision"),
  step: integer("step").notNull(),
  content: text("content").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.scope] }),
  check("brand_draft_step_check", sql`${table.step} between 0 and 2`),
  check("brand_draft_scope_check", sql`(${table.scope} = 'new' and ${table.baseRevision} is null) or (${table.scope} <> 'new' and ${table.baseRevision} is not null and ${table.baseRevision} > 0)`),
]);

export const brandOperation = sqliteTable("brand_operation", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  operationId: text("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
  scope: text("scope"),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.operationId] }),
]);

// A purge receipt and its cost records outlive the brand and its cascades.
export const brandPurge = sqliteTable("brand_purge", {
  brandId: text("brand_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  frozenAt: text("frozen_at").notNull(),
  startedAt: text("started_at").notNull(),
  step: integer("step").notNull(),
  issue: text("issue"),
  completedAt: text("completed_at"),
}, (table) => [
  check("brand_purge_step_check", sql`${table.step} between 0 and 4
    and ((${table.step} = 4 and ${table.completedAt} is not null and ${table.issue} is null)
      or (${table.step} < 4 and ${table.completedAt} is null))`),
]);

export const brandPurgedCost = sqliteTable("brand_purged_cost", {
  brandId: text("brand_id").notNull().references(() => brandPurge.brandId, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  reservationId: text("reservation_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  currency: text("currency").notNull(),
  actualMinor: integer("actual_minor").notNull(),
  startedAt: text("started_at").notNull(),
  reconciledAt: text("reconciled_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.kind, table.reservationId, table.attemptId] }),
  check("brand_purged_cost_check", sql`${table.kind} in ('sampling', 'generation')
    and length(${table.currency}) = 3 and ${table.actualMinor} >= 0`),
]);

// Published retention text. A new version is a new row; accepted brands keep their own row.
export const retentionPolicy = sqliteTable("retention_policy", {
  version: integer("version").primaryKey(),
  summaryZh: text("summary_zh").notNull(),
  summaryEn: text("summary_en").notNull(),
  recoverableDays: integer("recoverable_days").notNull(),
  publishedAt: text("published_at").notNull(),
}, (table) => [
  check("retention_policy_version_check", sql`${table.version} > 0`),
  check("retention_policy_days_check", sql`${table.recoverableDays} between 1 and 3650`),
  check("retention_policy_summary_check", sql`length(${table.summaryZh}) between 1 and 2000
    and length(${table.summaryEn}) between 1 and 2000`),
]);

export const brandRetentionAcceptance = sqliteTable("brand_retention_acceptance", {
  brandId: text("brand_id").primaryKey().references(() => brand.id, { onDelete: "cascade" }),
  policyVersion: integer("policy_version").notNull().references(() => retentionPolicy.version),
  acceptedAt: text("accepted_at").notNull(),
});
