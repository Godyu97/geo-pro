import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const approvalPolicy = sqliteTable("approval_policy", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  dualControl: integer("dual_control").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
}, (table) => [
  uniqueIndex("approval_policy_brand_uidx").on(table.brandId),
  check("approval_policy_state_check", sql`${table.version} > 0
    and ${table.dualControl} in (0, 1)
    and length(${table.updatedBy}) between 1 and 128
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const brandApprovalDuty = sqliteTable("brand_approval_duty", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  factApprover: integer("fact_approver").notNull(),
  contentApprover: integer("content_approver").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("brand_approval_duty_pair_uidx").on(table.brandId, table.userId),
  index("brand_approval_duty_user_idx").on(table.userId, table.brandId),
  check("brand_approval_duty_state_check", sql`${table.factApprover} in (0, 1)
    and ${table.contentApprover} in (0, 1)
    and (${table.factApprover} = 1 or ${table.contentApprover} = 1)
    and length(${table.userId}) between 1 and 128
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const approvalAttempt = sqliteTable("approval_attempt", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  kind: text("kind").notNull(),
  reason: text("reason").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("approval_attempt_version_idx").on(table.brandId, table.versionId, table.createdAt, table.id),
  check("approval_attempt_state_check", sql`${table.kind} in ('fact', 'content')
    and ${table.reason} in ('separation', 'duty')
    and length(${table.versionId}) = 36
    and length(${table.actorId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
