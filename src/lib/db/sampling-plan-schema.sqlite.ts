import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";
import { monitoringRun } from "./monitoring-schema.sqlite";

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
  trendThresholdPp: real("trend_threshold_pp").notNull().default(10),
}, (table) => [
  primaryKey({ columns: [table.id, table.version] }),
  index("sampling_plan_owner_idx").on(table.brandId, table.ownerId, table.id),
  check("sampling_plan_state_check", sql`${table.version} > 0
    and ${table.phase} in ('draft', 'active', 'paused', 'ended')
    and length(${table.currency}) = 3
    and ${table.budgetMinor} >= 0 and ${table.spentMinor} >= 0 and ${table.pendingMinor} >= 0
    and ${table.trendThresholdPp} > 0
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

export const samplingDueRun = sqliteTable("sampling_due_run", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  planVersion: integer("plan_version").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  channelId: text("channel_id").notNull(),
  windowId: text("window_id").notNull(),
  slotId: text("slot_id").notNull().references(() => samplingSlot.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  monitoringRunId: text("monitoring_run_id").references(() => monitoringRun.id, { onDelete: "cascade" }),
  chargedMinor: integer("charged_minor").notNull(),
  promptIdsJson: text("prompt_ids_json"),
  createdAt: text("created_at").notNull(),
  promptSetId: text("prompt_set_id"),
  promptSetVersion: integer("prompt_set_version"),
}, (table) => [
  uniqueIndex("sampling_due_run_slot_uidx").on(table.planId, table.channelId, table.windowId, table.slotId),
  index("sampling_due_run_owner_idx").on(table.ownerId, table.planId, table.windowId, table.id),
  check("sampling_due_run_state_check", sql`${table.planVersion} > 0
    and ${table.kind} in ('official', 'manual')
    and ${table.status} in ('reserved', 'accepted', 'sheet')
    and ${table.chargedMinor} >= 0
    and length(${table.windowId}) = 10
    and length(${table.timezone}) between 1 and 64
    and length(${table.channelId}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and (
      (${table.kind} = 'manual' and ${table.status} = 'sheet'
        and ${table.monitoringRunId} is null and ${table.chargedMinor} = 0
        and ${table.promptIdsJson} is not null and length(${table.promptIdsJson}) between 38 and 2000
        and (
          (${table.promptSetId} is null and ${table.promptSetVersion} is null)
          or (length(${table.promptSetId}) = 36 and ${table.promptSetVersion} > 0)
        ))
      or (${table.kind} = 'official' and ${table.status} = 'reserved'
        and ${table.monitoringRunId} is null and ${table.chargedMinor} = 0
        and ${table.promptIdsJson} is null and ${table.promptSetId} is null and ${table.promptSetVersion} is null)
      or (${table.kind} = 'official' and ${table.status} = 'accepted'
        and ${table.monitoringRunId} is not null
        and ${table.promptIdsJson} is null and ${table.promptSetId} is null and ${table.promptSetVersion} is null)
    )`),
]);

export const samplingWindowReading = sqliteTable("sampling_window_reading", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  windowId: text("window_id").notNull(),
  timezone: text("timezone").notNull(),
  plannedCount: integer("planned_count").notNull(),
  eligibleCount: integer("eligible_count").notNull(),
  recommendedCount: integer("recommended_count").notNull(),
  judgedCount: integer("judged_count").notNull(),
  coverageSufficient: integer("coverage_sufficient").notNull(),
  comparableWindows: integer("comparable_windows").notNull(),
  waitingForTrend: integer("waiting_for_trend").notNull(),
  alertId: text("alert_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("sampling_window_reading_window_uidx").on(table.planId, table.windowId),
  index("sampling_window_reading_owner_idx").on(table.ownerId, table.brandId, table.windowId),
  check("sampling_window_reading_state_check", sql`${table.plannedCount} >= 0
    and ${table.eligibleCount} >= 0 and ${table.recommendedCount} >= 0 and ${table.judgedCount} >= 0
    and ${table.recommendedCount} <= ${table.judgedCount}
    and ${table.coverageSufficient} in (0, 1) and ${table.waitingForTrend} in (0, 1)
    and ${table.comparableWindows} >= 0
    and length(${table.windowId}) = 10
    and length(${table.timezone}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40
    and (${table.alertId} is null or length(${table.alertId}) = 36)`),
]);
