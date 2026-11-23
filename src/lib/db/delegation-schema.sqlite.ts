import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const agencyMembership = sqliteTable("agency_membership", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  active: integer("active").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("agency_membership_pair_uidx").on(table.organizationId, table.userId),
  index("agency_membership_user_idx").on(table.userId, table.organizationId).where(sql`${table.active} = 1`),
  check("agency_membership_state_check", sql`${table.active} in (0, 1)
    and length(${table.id}) = 36
    and length(${table.organizationId}) = 36
    and length(${table.userId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const brandDelegation = sqliteTable("brand_delegation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  active: integer("active").notNull(),
  expiresAt: text("expires_at").notNull(),
  scope: text("scope").notNull(),
  createdAt: text("created_at").notNull(),
  expiredAt: text("expired_at"),
}, (table) => [
  uniqueIndex("brand_delegation_pair_uidx").on(table.organizationId, table.brandId),
  index("brand_delegation_org_idx").on(table.organizationId, table.brandId),
  check("brand_delegation_state_check", sql`${table.active} in (0, 1)
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.organizationId}) = 36
    and length(${table.expiresAt}) between 20 and 40
    and length(${table.createdAt}) between 20 and 40
    and length(${table.scope}) between 8 and 600
    and ${table.scope} = lower(${table.scope})
    and ${table.scope} not glob '*[^-a-z0-9,]*'
    and ${table.scope} not like '%,,%'
    and ${table.scope} not like ',%'
    and ${table.scope} not like '%,'
    and ((${table.active} = 1 and ${table.expiredAt} is null)
      or (${table.active} = 0 and length(${table.expiredAt}) between 20 and 40))`),
]);

export const delegationAction = sqliteTable("delegation_action", {
  id: text("id").primaryKey(),
  delegationId: text("delegation_id").notNull().references(() => brandDelegation.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("delegation_action_delegation_idx").on(table.delegationId, table.status),
  check("delegation_action_state_check", sql`${table.status} in ('queued', 'stopped')
    and length(${table.id}) = 36
    and length(${table.delegationId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
