import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const platformAccountRole = sqliteTable("platform_account_role", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("platform_account_role_state_check", sql`${table.role} in ('admin', 'user')
    and length(${table.userId}) between 1 and 128
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const teamGroup = sqliteTable("team_group", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("team_group_personal_uidx").on(table.ownerUserId).where(sql`${table.kind} = 'personal'`),
  check("team_group_state_check", sql`${table.kind} in ('personal', 'team')
    and length(${table.ownerUserId}) between 1 and 128
    and length(${table.name}) between 1 and 120
    and length(${table.createdAt}) between 20 and 40`),
]);

export const teamGroupMember = sqliteTable("team_group_member", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => teamGroup.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  active: integer("active").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("team_group_member_pair_uidx").on(table.groupId, table.userId),
  index("team_group_member_user_idx").on(table.userId, table.groupId).where(sql`${table.active} = 1`),
  check("team_group_member_state_check", sql`${table.active} in (0, 1)
    and length(${table.userId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and ((${table.active} = 1 and ${table.revokedAt} is null)
      or (${table.active} = 0 and length(${table.revokedAt}) between 20 and 40))`),
]);

export const brandGroup = sqliteTable("brand_group", {
  brandId: text("brand_id").primaryKey().references(() => brand.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => teamGroup.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("brand_group_group_idx").on(table.groupId, table.brandId),
  check("brand_group_state_check", sql`length(${table.createdAt}) between 20 and 40`),
]);

export const platformRoleAudit = sqliteTable("platform_role_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  subjectId: text("subject_id"),
  role: text("role"),
  action: text("action").notNull(),
  result: text("result").notNull(),
  reason: text("reason").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("platform_role_audit_actor_time_idx").on(table.actorId, table.occurredAt, table.id),
  check("platform_role_audit_state_check", sql`${table.action} in ('grant', 'revoke')
    and ${table.result} in ('allowed', 'denied', 'failed')
    and (${table.role} is null or ${table.role} in ('admin', 'user'))
    and length(${table.occurredAt}) between 20 and 40`),
]);
