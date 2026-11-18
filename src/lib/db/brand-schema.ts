import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const brand = pgTable("brand", {
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
  index("brand_owner_frozen_idx").on(table.ownerId, table.frozenAt, table.id).where(sql`${table.frozenAt} is not null`),
  index("brand_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt, table.id),
]);

export const brandVersion = pgTable("brand_version", {
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.version] }),
  check("brand_version_number_check", sql`${table.version} > 0`),
]);

export const brandDraft = pgTable("brand_draft", {
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

export const brandOperation = pgTable("brand_operation", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  operationId: text("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.operationId] }),
]);
