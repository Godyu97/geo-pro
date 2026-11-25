import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";
import { answerCitation, answerObservation } from "./evidence-schema";

export const competitorSet = pgTable("competitor_set", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  labelsJson: text("labels_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("competitor_set_brand_version_uidx").on(table.brandId, table.version),
  index("competitor_set_owner_idx").on(table.ownerId, table.brandId, table.version),
  check("competitor_set_check", sql`${table.version} > 0 and length(${table.labelsJson}) between 2 and 2000`),
]);

export const competitorMention = pgTable("competitor_mention", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  setId: text("set_id").notNull().references(() => competitorSet.id, { onDelete: "cascade" }),
  observationId: text("observation_id").notNull().references(() => answerObservation.id, { onDelete: "cascade" }),
  competitorLabel: text("competitor_label").notNull(),
  ordered: integer("ordered").notNull(),
  position: integer("position"),
  createdAt: text("created_at").notNull(),
  mentionState: text("mention_state").notNull().default("true"),
}, (table) => [
  uniqueIndex("competitor_mention_once_uidx").on(table.setId, table.observationId, table.competitorLabel),
  index("competitor_mention_set_idx").on(table.brandId, table.setId, table.observationId),
  check("competitor_mention_check", sql`${table.ordered} in (0, 1)
    and ${table.mentionState} in ('true', 'false', 'unknown')
    and length(${table.competitorLabel}) between 1 and 80
    and (
      (${table.mentionState} = 'true' and (
        (${table.ordered} = 1 and ${table.position} > 0)
        or (${table.ordered} = 0 and ${table.position} is null)
      ))
      or (${table.mentionState} in ('false', 'unknown') and ${table.ordered} = 0 and ${table.position} is null)
    )`),
]);

export const sourceInspection = pgTable("source_inspection", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  citationId: text("citation_id").notNull().references(() => answerCitation.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  support: text("support").notNull(),
  pageLive: integer("page_live").notNull(),
  readable: integer("readable").notNull(),
  authorKnown: integer("author_known").notNull(),
  supportsBrand: integer("supports_brand").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("source_inspection_citation_uidx").on(table.citationId),
  index("source_inspection_brand_idx").on(table.brandId, table.citationId),
  check("source_inspection_check", sql`${table.state} in ('observed', 'resolved', 'limited', 'unknown')
    and ${table.support} in ('supports', 'unknown')
    and ${table.pageLive} in (0, 1)
    and ${table.readable} in (0, 1)
    and ${table.authorKnown} in (0, 1)
    and ${table.supportsBrand} in (0, 1)
    and (${table.support} = 'unknown' or (${table.pageLive} = 1 and ${table.readable} = 1 and ${table.supportsBrand} = 1))`),
]);

export const researchBrief = pgTable("research_brief", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  questionCluster: text("question_cluster").notNull(),
  gap: text("gap").notNull(),
  factsJson: text("facts_json").notNull(),
  sourceIdsJson: text("source_ids_json").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("research_brief_brand_idx").on(table.brandId, table.status, table.createdAt, table.id),
  index("research_brief_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("research_brief_check", sql`${table.status} in ('proposed', 'accepted', 'dismissed')
    and length(${table.questionCluster}) between 1 and 200
    and length(${table.gap}) between 1 and 2000
    and length(${table.factsJson}) between 2 and 8000
    and length(${table.sourceIdsJson}) between 2 and 4000`),
]);
