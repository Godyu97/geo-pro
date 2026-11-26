import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// A frozen question-set id is stored as given. Checkpoint rows are append-only so an
// exploratory result cannot be rewritten into a formal conclusion.
export const formalObservation = pgTable("formal_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  frozenSetId: text("frozen_set_id").notNull(),
  effectiveOn: text("effective_on").notNull(),
  frozenNonBrandCount: integer("frozen_non_brand_count").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  stopReason: text("stop_reason"),
}, (table) => [
  index("formal_observation_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("formal_observation_state_check", sql`${table.status} in ('observing', 'checkpoint_due', 'stopped')
    and (
      (${table.status} <> 'stopped' and ${table.stopReason} is null)
      or (${table.status} = 'stopped' and ${table.stopReason} is not null and length(trim(${table.stopReason})) between 1 and 400)
    )
    and ${table.frozenNonBrandCount} between 1 and 500
    and length(${table.frozenSetId}) between 1 and 64
    and length(${table.effectiveOn}) = 10
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const formalCheckpoint = pgTable("formal_checkpoint", {
  id: text("id").primaryKey(),
  observationId: text("observation_id").notNull().references(() => formalObservation.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  checkpoint: text("checkpoint").notNull(),
  mode: text("mode").notNull(),
  comparableCount: integer("comparable_count").notNull(),
  excludedJson: text("excluded_json").notNull(),
  conclusion: text("conclusion"),
  evaluatedOn: text("evaluated_on").notNull(),
  createdAt: text("created_at").notNull(),
  evaluationJson: text("evaluation_json"),
}, (table) => [
  index("formal_checkpoint_observation_idx").on(table.ownerId, table.observationId, table.createdAt, table.id),
  check("formal_checkpoint_state_check", sql`${table.checkpoint} in ('d7', 'd14', 'd28')
    and ${table.mode} in ('progress', 'formal', 'exploratory')
    and ${table.comparableCount} between 0 and 500
    and length(${table.excludedJson}) between 2 and 4000
    and length(${table.evaluatedOn}) = 10
    and (
      (${table.mode} = 'progress' and ${table.conclusion} is null)
      or (${table.mode} in ('formal', 'exploratory') and ${table.conclusion} is not null
        and length(${table.conclusion}) between 2 and 400)
    )
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

// Append-only context for model, marketing, and price changes. Checkpoint
// conclusions stay on formal_checkpoint and are not rewritten from this table.
export const formalConfounder = pgTable("formal_confounder", {
  id: text("id").primaryKey(),
  observationId: text("observation_id").notNull().references(() => formalObservation.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  factor: text("factor").notNull(),
  note: text("note").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [
  index("formal_confounder_observation_idx").on(table.ownerId, table.observationId, table.recordedAt, table.id),
  check("formal_confounder_state_check", sql`${table.factor} in ('model', 'marketing', 'price')
    and length(trim(${table.note})) between 1 and 400
    and length(${table.ownerId}) between 1 and 128
    and length(${table.recordedAt}) between 20 and 40`),
]);

// A control page is registered before any checkpoint. The label stays observation
// so a later comparison cannot be stored as a causal experiment.
export const formalControlPage = pgTable("formal_control_page", {
  id: text("id").primaryKey(),
  observationId: text("observation_id").notNull().references(() => formalObservation.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  pageKey: text("page_key").notNull(),
  label: text("label").notNull(),
  registeredAt: text("registered_at").notNull(),
}, (table) => [
  uniqueIndex("formal_control_page_page_uidx").on(table.observationId, table.pageKey),
  index("formal_control_page_observation_idx").on(table.ownerId, table.observationId, table.registeredAt, table.id),
  check("formal_control_page_state_check", sql`${table.label} = 'observation'
    and length(trim(${table.pageKey})) between 1 and 300
    and length(${table.ownerId}) between 1 and 128
    and length(${table.registeredAt}) between 20 and 40`),
]);
