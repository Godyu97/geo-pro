import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand, brandVersion } from "./brand-schema";

export const promptDraft = pgTable("prompt_draft", {
  brandId: text("brand_id").primaryKey().references(() => brand.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  baseSetId: text("base_set_id"),
  content: text("content").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("prompt_draft_revision_check", sql`${table.revision} > 0`),
  check("prompt_draft_content_check", sql`length(${table.content}) > 1`),
]);

export const promptSet = pgTable("prompt_set", {
  brandId: text("brand_id").notNull(),
  id: text("id").notNull(),
  setId: text("set_id").notNull(),
  version: integer("version").notNull(),
  entityVersion: integer("entity_version").notNull(),
  region: text("region").notNull(),
  language: text("language").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.id] }),
  foreignKey({ name: "prompt_set_entity_fk", columns: [table.brandId, table.entityVersion],
    foreignColumns: [brandVersion.brandId, brandVersion.version] }).onDelete("cascade"),
  uniqueIndex("prompt_set_version_uidx").on(table.brandId, table.setId, table.version),
  index("prompt_set_recent_idx").on(table.brandId, table.createdAt, table.id),
  check("prompt_set_version_check", sql`${table.version} > 0`),
  check("prompt_set_region_check", sql`length(${table.region}) = 2`),
  check("prompt_set_language_check", sql`length(${table.language}) BETWEEN 2 AND 40`),
  check("prompt_set_content_check", sql`length(${table.content}) > 1`),
]);

export const promptReference = pgTable("prompt_reference", {
  brandId: text("brand_id").notNull(),
  setVersionId: text("set_version_id").notNull(),
  questionId: text("question_id").notNull(),
  consumerId: text("consumer_id").notNull(),
}, (table) => [
  primaryKey({ name: "prompt_reference_pk", columns: [table.brandId, table.setVersionId, table.questionId, table.consumerId] }),
  foreignKey({ name: "prompt_reference_set_fk", columns: [table.brandId, table.setVersionId],
    foreignColumns: [promptSet.brandId, promptSet.id] }).onDelete("cascade"),
  index("prompt_reference_question_idx").on(table.brandId, table.questionId),
]);
