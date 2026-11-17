import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";

export const maintenanceGrant = sqliteTable("maintenance_grant", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  grantedAt: text("granted_at").notNull(),
  revokedAt: text("revoked_at"),
  operatorId: text("operator_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.permission] }),
  check("maintenance_grant_permission_check", sql`${table.permission} in ('capabilities.manage', 'quotas.manage', 'support.read')`),
]);

export const maintenanceAudit = sqliteTable("maintenance_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  subjectId: text("subject_id"),
  permission: text("permission"),
  action: text("action").notNull(),
  result: text("result").notNull(),
  reason: text("reason").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("maintenance_audit_actor_time_idx").on(table.actorId, table.occurredAt, table.id),
  check("maintenance_audit_result_check", sql`${table.result} in ('allowed', 'denied', 'failed')`),
]);
