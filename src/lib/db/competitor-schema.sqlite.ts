import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";
import { answerCitation, answerObservation } from "./evidence-schema.sqlite";

export const competitorSet = sqliteTable("competitor_set", {
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

export const competitorMention = sqliteTable("competitor_mention", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  setId: text("set_id").notNull().references(() => competitorSet.id, { onDelete: "cascade" }),
  observationId: text("observation_id").notNull().references(() => answerObservation.id, { onDelete: "cascade" }),
  competitorLabel: text("competitor_label").notNull(),
  ordered: integer("ordered").notNull(),
  position: integer("position"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("competitor_mention_once_uidx").on(table.setId, table.observationId, table.competitorLabel),
  index("competitor_mention_set_idx").on(table.brandId, table.setId, table.observationId),
  check("competitor_mention_check", sql`${table.ordered} in (0, 1)
    and length(${table.competitorLabel}) between 1 and 80
    and (
      (${table.ordered} = 1 and ${table.position} > 0)
      or (${table.ordered} = 0 and ${table.position} is null)
    )`),
]);

export const sourceInspection = sqliteTable("source_inspection", {
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
