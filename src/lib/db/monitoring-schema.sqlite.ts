import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const monitoringRun = sqliteTable("monitoring_run", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  operationId: text("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  track: text("track").notNull(),
  promptSetId: text("prompt_set_id").notNull(),
  promptSetVersion: integer("prompt_set_version").notNull(),
  repeatCount: integer("repeat_count").notNull(),
  questionCount: integer("question_count").notNull(),
  naturalCount: integer("natural_count").notNull(),
  channelCount: integer("channel_count").notNull(),
  slotCount: integer("slot_count").notNull(),
  region: text("region").notNull(),
  language: text("language").notNull(),
  requestedNetworkMode: text("requested_network_mode").notNull(),
  currency: text("currency"),
  upperMinor: integer("upper_minor"),
  estimateHighMinor: integer("estimate_high_minor"),
  customerPayableMinor: integer("customer_payable_minor").notNull(),
  status: text("status").notNull(),
  samplingComplete: integer("sampling_complete").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("monitoring_run_operation_uidx").on(table.brandId, table.operationId),
  index("monitoring_run_brand_recent_idx").on(table.brandId, table.createdAt, table.id),
  check("monitoring_run_scope_check", sql`${table.track} in ('model_api', 'consumer_ui')
    and ${table.repeatCount} between 1 and 3
    and ${table.questionCount} > 0 and ${table.naturalCount} between 0 and ${table.questionCount}
    and ${table.channelCount} > 0 and ${table.slotCount} = ${table.questionCount} * ${table.channelCount} * ${table.repeatCount}
    and length(${table.region}) = 2 and length(${table.language}) between 2 and 40
    and ${table.requestedNetworkMode} in ('on', 'off', 'unknown')
    and ${table.status} = 'queued' and ${table.samplingComplete} = 0 and ${table.customerPayableMinor} = 0
    and (
      (${table.track} = 'consumer_ui' and ${table.currency} is null and ${table.upperMinor} is null and ${table.estimateHighMinor} is null)
      or (${table.track} = 'model_api' and ${table.currency} is not null and length(${table.currency}) = 3
        and ${table.upperMinor} >= 0 and ${table.estimateHighMinor} = ${table.upperMinor} * ${table.slotCount})
    )`),
]);

export const monitoringSlot = sqliteTable("monitoring_slot", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  brandId: text("brand_id").notNull(),
  questionId: text("question_id").notNull(),
  naturalQuestion: integer("natural_question").notNull(),
  channelId: text("channel_id").notNull(),
  channelVersion: integer("channel_version").notNull(),
  repeatIndex: integer("repeat_index").notNull(),
  reservationId: text("reservation_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "monitoring_slot_run_fk", columns: [table.runId], foreignColumns: [monitoringRun.id] }).onDelete("cascade"),
  uniqueIndex("monitoring_slot_position_uidx").on(table.runId, table.questionId, table.channelId, table.repeatIndex),
  index("monitoring_slot_brand_idx").on(table.brandId, table.runId),
  check("monitoring_slot_state_check", sql`${table.naturalQuestion} in (0, 1) and ${table.repeatIndex} between 1 and 3
    and ${table.channelVersion} > 0 and ${table.status} = 'queued'`),
]);
