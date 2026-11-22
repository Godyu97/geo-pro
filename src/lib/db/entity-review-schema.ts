import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// Append-only human reviews. A correction inserts a new row; the board keeps the
// newest row for each observation and analysis version. created_at is part of
// the unique key so history can stay without rewriting the previous row.
// population_count is the sample frame copied onto each append. The board reads
// it from the newest row and never stores a population error rate.
export const entityReview = pgTable("entity_review", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  observationId: text("observation_id").notNull(),
  analysisVersionId: text("analysis_version_id").notNull(),
  confirmedError: integer("confirmed_error").notNull(),
  reviewed: integer("reviewed").notNull(),
  populationCount: integer("population_count").notNull(),
  method: text("method").notNull(),
  fact: text("fact").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("entity_review_sample_uidx").on(table.observationId, table.analysisVersionId, table.createdAt),
  index("entity_review_owner_idx").on(
    table.ownerId,
    table.brandId,
    table.observationId,
    table.analysisVersionId,
    table.createdAt,
    table.id,
  ),
  check("entity_review_state_check", sql`${table.confirmedError} in (0, 1)
    and ${table.reviewed} in (0, 1)
    and ${table.fact} in ('active', 'expired', 'conflict')
    and (${table.confirmedError} = 0 or (${table.reviewed} = 1 and ${table.fact} = 'active'))
    and ${table.populationCount} between 1 and 100000
    and length(${table.method}) between 1 and 200
    and length(${table.ownerId}) between 1 and 128
    and length(${table.observationId}) = 36
    and length(${table.analysisVersionId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
