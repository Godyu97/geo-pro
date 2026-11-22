import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const samplingPlan = sqliteTable("sampling_plan", {
  id: text("id").notNull(),
  version: integer("version").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  phase: text("phase").notNull(),
  currency: text("currency").notNull(),
  budgetMinor: integer("budget_minor").notNull(),
  spentMinor: integer("spent_minor").notNull(),
  pendingMinor: integer("pending_minor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.version] }),
  index("sampling_plan_owner_idx").on(table.brandId, table.ownerId, table.id),
  check("sampling_plan_state_check", sql`${table.version} > 0
    and ${table.phase} in ('draft', 'active', 'paused', 'ended')
    and length(${table.currency}) = 3
    and ${table.budgetMinor} >= 0 and ${table.spentMinor} >= 0 and ${table.pendingMinor} >= 0
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const samplingSlot = sqliteTable("sampling_slot", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  channelId: text("channel_id").notNull(),
  at: text("at").notNull(),
  status: text("status").notNull(),
  manual: integer("manual").notNull(),
  costMinor: integer("cost_minor").notNull(),
}, (table) => [
  index("sampling_slot_plan_at_idx").on(table.planId, table.at, table.id),
  check("sampling_slot_state_check", sql`${table.status} in ('scheduled', 'completed', 'failed', 'paused')
    and ${table.manual} in (0, 1)
    and ${table.costMinor} >= 0
    and length(${table.channelId}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.at}) between 20 and 40`),
]);
