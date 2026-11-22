import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";
import { answerAnalysisVersion, answerObservation } from "./evidence-schema";

// Append-only disambiguation. Confirming a same-name different entity inserts
// this row and a new answer_analysis_version. The previous analysis row keeps
// its mention value; answer text and report snapshots are not rewritten.
// count_as_target_mention is stored only when the mention no longer counts.
export const entityDisambiguation = pgTable("entity_disambiguation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  observationId: text("observation_id").notNull(),
  priorAnalysisId: text("prior_analysis_id").notNull(),
  nextAnalysisId: text("next_analysis_id").notNull(),
  countAsTargetMention: integer("count_as_target_mention").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "entity_disambiguation_observation_fk",
    columns: [table.observationId],
    foreignColumns: [answerObservation.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "entity_disambiguation_prior_fk",
    columns: [table.priorAnalysisId],
    foreignColumns: [answerAnalysisVersion.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "entity_disambiguation_next_fk",
    columns: [table.nextAnalysisId],
    foreignColumns: [answerAnalysisVersion.id],
  }).onDelete("cascade"),
  uniqueIndex("entity_disambiguation_prior_uidx").on(table.priorAnalysisId),
  uniqueIndex("entity_disambiguation_next_uidx").on(table.nextAnalysisId),
  index("entity_disambiguation_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("entity_disambiguation_state_check", sql`${table.countAsTargetMention} = 0
    and ${table.priorAnalysisId} <> ${table.nextAnalysisId}
    and length(${table.ownerId}) between 1 and 128
    and length(${table.observationId}) = 36
    and length(${table.priorAnalysisId}) = 36
    and length(${table.nextAnalysisId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);

// Append-only correction task. Action and effect are separate columns.
// Completing the action cannot write a resolved effect; a failed retest stays unresolved.
export const entityCorrection = pgTable("entity_correction", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  observationId: text("observation_id").notNull(),
  action: text("action").notNull(),
  effect: text("effect").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "entity_correction_observation_fk",
    columns: [table.observationId],
    foreignColumns: [answerObservation.id],
  }).onDelete("cascade"),
  uniqueIndex("entity_correction_event_uidx").on(table.observationId, table.createdAt),
  index("entity_correction_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("entity_correction_state_check", sql`((${table.action} = 'open' and ${table.effect} in ('open', 'unresolved'))
      or (${table.action} = 'actioned' and ${table.effect} in ('pending_retest', 'unresolved')))
    and length(${table.ownerId}) between 1 and 128
    and length(${table.observationId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
