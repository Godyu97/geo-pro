import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brandFactVersion } from "./brand-fact-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const assistantPlan = sqliteTable("assistant_plan", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  materialHash: text("material_hash").notNull(),
  status: text("status").notNull(),
  controlsUnchanged: integer("controls_unchanged").notNull(),
  ignored: integer("ignored").notNull(),
  budgetMinor: integer("budget_minor").notNull(),
  strategyLabel: text("strategy_label").notNull(),
  guaranteed: integer("guaranteed").notNull(),
  successes: integer("successes").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("assistant_plan_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("assistant_plan_state_check", sql`${table.status} in ('draft', 'settled')
    and ${table.controlsUnchanged} = 1
    and ${table.ignored} in (0, 1)
    and ${table.budgetMinor} between 0 and 1000000000
    and ${table.strategyLabel} = 'observation'
    and ${table.guaranteed} = 0
    and ${table.successes} between 0 and 1000000
    and length(${table.materialHash}) = 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const assistantPlanItem = sqliteTable("assistant_plan_item", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => assistantPlan.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  position: integer("position").notNull(),
  actionText: text("action_text").notNull(),
  factVersionId: text("fact_version_id").notNull(),
  factCurrent: integer("fact_current").notNull(),
  status: text("status").notNull(),
  blockReason: text("block_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("assistant_plan_item_position_uidx").on(table.planId, table.position),
  index("assistant_plan_item_owner_idx").on(table.ownerId, table.planId, table.position),
  foreignKey({
    name: "assistant_plan_item_fact_fk",
    columns: [table.brandId, table.factVersionId],
    foreignColumns: [brandFactVersion.brandId, brandFactVersion.id],
  }).onDelete("cascade"),
  check("assistant_plan_item_state_check", sql`${table.position} between 1 and 5
    and ${table.factCurrent} in (0, 1)
    and ${table.status} in ('draft', 'confirmed', 'executed', 'blocked')
    and (
      (${table.status} = 'blocked' and ${table.blockReason} = 'fact_stale')
      or (${table.status} <> 'blocked' and ${table.blockReason} is null)
    )
    and length(${table.actionText}) between 1 and 200
    and length(${table.factVersionId}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);
