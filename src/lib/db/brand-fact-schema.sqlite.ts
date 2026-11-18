import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, primaryKey, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand, brandVersion } from "./brand-schema.sqlite";

export const brandFactPaste = sqliteTable("brand_fact_paste", {
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  previousId: text("previous_id"),
  original: text("original").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.id] }),
  foreignKey({ name: "fact_paste_previous_fk", columns: [table.brandId, table.previousId],
    foreignColumns: [table.brandId, table.id] }),
  check("fact_paste_parent_check", sql`${table.previousId} IS NULL OR ${table.previousId} <> ${table.id}`),
  uniqueIndex("fact_paste_previous_uidx").on(table.brandId, table.previousId),
  index("fact_paste_recent_idx").on(table.brandId, table.createdAt, table.id),
]);

export const brandFactVersion = sqliteTable("brand_fact_version", {
  brandId: text("brand_id").notNull(),
  id: text("id").notNull(),
  factId: text("fact_id").notNull(),
  version: integer("version").notNull(),
  entityVersion: integer("entity_version").notNull(),
  pasteId: text("paste_id"),
  revision: integer("revision").notNull(),
  state: text("state").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: text("confirmed_at"),
  revokedAt: text("revoked_at"),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.id] }),
  foreignKey({ name: "fact_entity_version_fk", columns: [table.brandId, table.entityVersion],
    foreignColumns: [brandVersion.brandId, brandVersion.version] }).onDelete("cascade"),
  foreignKey({ name: "fact_version_paste_fk", columns: [table.brandId, table.pasteId],
    foreignColumns: [brandFactPaste.brandId, brandFactPaste.id] }).onDelete("cascade"),
  uniqueIndex("fact_version_number_uidx").on(table.brandId, table.factId, table.version),
  index("fact_entity_version_idx").on(table.brandId, table.entityVersion),
  index("fact_version_paste_idx").on(table.brandId, table.pasteId).where(sql`${table.pasteId} IS NOT NULL`),
  index("fact_version_recent_idx").on(table.brandId, table.createdAt, table.id),
  check("fact_version_numbers_check", sql`${table.version} > 0 AND ${table.revision} > 0`),
  check("fact_version_state_check", sql`
    (${table.state} IN ('draft', 'pending_confirmation') AND ${table.confirmedBy} IS NULL AND ${table.confirmedAt} IS NULL AND ${table.revokedAt} IS NULL)
    OR (${table.confirmedBy} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL AND
      ((${table.state} = 'approved' AND ${table.revokedAt} IS NULL) OR (${table.state} = 'revoked' AND ${table.revokedAt} IS NOT NULL)))`),
]);

export const brandFactUse = sqliteTable("brand_fact_use", {
  brandId: text("brand_id").notNull(),
  factVersionId: text("fact_version_id").notNull(),
  contentVersionId: text("content_version_id").notNull(),
  stage: text("stage").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.factVersionId, table.contentVersionId] }),
  foreignKey({ name: "fact_use_version_fk", columns: [table.brandId, table.factVersionId],
    foreignColumns: [brandFactVersion.brandId, brandFactVersion.id] }).onDelete("cascade"),
  index("fact_use_content_idx").on(table.brandId, table.contentVersionId, table.factVersionId),
  check("fact_use_stage_check", sql`${table.stage} IN ('review', 'delivery', 'published', 'history')`),
]);
