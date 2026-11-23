import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
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
  index("monitoring_run_operation_idx").on(table.operationId),
  index("monitoring_run_brand_recent_idx").on(table.brandId, table.createdAt, table.id),
  check("monitoring_run_scope_check", sql`${table.track} in ('model_api', 'consumer_ui')
    and ${table.repeatCount} between 1 and 3
    and ${table.questionCount} > 0 and ${table.naturalCount} between 0 and ${table.questionCount}
    and ${table.channelCount} > 0 and ${table.slotCount} = ${table.questionCount} * ${table.channelCount} * ${table.repeatCount}
    and length(${table.region}) = 2 and length(${table.language}) between 2 and 40
    and ${table.requestedNetworkMode} in ('on', 'off', 'unknown')
    and ${table.status} in ('queued', 'running', 'paused', 'succeeded', 'partial', 'failed', 'cancelled')
    and ${table.samplingComplete} in (0, 1) and ${table.customerPayableMinor} = 0
    and ((${table.status} in ('queued', 'running', 'paused') and ${table.samplingComplete} = 0)
      or ${table.status} in ('succeeded', 'partial', 'failed', 'cancelled'))
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
  adoptedAttemptId: text("adopted_attempt_id"),
  late: integer("late").notNull().default(0),
}, (table) => [
  foreignKey({ name: "monitoring_slot_run_fk", columns: [table.runId], foreignColumns: [monitoringRun.id] }).onDelete("cascade"),
  uniqueIndex("monitoring_slot_position_uidx").on(table.runId, table.questionId, table.channelId, table.repeatIndex),
  index("monitoring_slot_brand_idx").on(table.brandId, table.runId),
  index("monitoring_slot_reservation_idx").on(table.brandId, table.reservationId),
  check("monitoring_slot_state_check", sql`${table.naturalQuestion} in (0, 1) and ${table.repeatIndex} between 1 and 3
    and ${table.channelVersion} > 0 and ${table.late} in (0, 1)
    and ${table.status} in ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')
    and ((${table.status} = 'succeeded' and ${table.adoptedAttemptId} is not null)
      or (${table.status} <> 'succeeded' and ${table.adoptedAttemptId} is null))`),
]);

export const monitoringAttempt = sqliteTable("monitoring_attempt", {
  id: text("id").primaryKey(),
  slotId: text("slot_id").notNull(),
  runId: text("run_id").notNull(),
  brandId: text("brand_id").notNull(),
  kind: text("kind").notNull(),
  ordinal: integer("ordinal").notNull(),
  transport: text("transport").notNull(),
  synthetic: integer("synthetic").notNull(),
  disposition: text("disposition").notNull(),
  rawText: text("raw_text"),
  currency: text("currency"),
  upperMinor: integer("upper_minor"),
  actualMinor: integer("actual_minor"),
  costState: text("cost_state").notNull(),
  quotaAttemptId: text("quota_attempt_id"),
  late: integer("late").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "monitoring_attempt_slot_fk", columns: [table.slotId], foreignColumns: [monitoringSlot.id] }).onDelete("cascade"),
  uniqueIndex("monitoring_attempt_ordinal_uidx").on(table.slotId, table.kind, table.ordinal),
  uniqueIndex("monitoring_attempt_adopted_uidx").on(table.slotId).where(sql`${table.disposition} = 'adopted'`),
  index("monitoring_attempt_run_idx").on(table.runId, table.slotId, table.ordinal),
  index("monitoring_attempt_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("monitoring_attempt_state_check", sql`${table.ordinal} between 1 and 20 and ${table.synthetic} in (0, 1) and ${table.late} in (0, 1)
    and ${table.transport} in ('isolated', 'official_api')
    and ((${table.transport} = 'isolated' and ${table.synthetic} = 1) or (${table.transport} = 'official_api' and ${table.synthetic} = 0))
    and (${table.currency} is null or length(${table.currency}) = 3)
    and (${table.upperMinor} is null or ${table.upperMinor} >= 0)
    and (
      (${table.costState} in ('none', 'pending', 'unknown') and ${table.actualMinor} is null)
      or (${table.costState} = 'known' and ${table.actualMinor} is not null and ${table.actualMinor} >= 0)
    )
    and (
      (${table.kind} = 'sampling' and ${table.ordinal} <= 3 and ${table.disposition} in ('pending', 'adopted', 'safe_failure', 'unknown', 'late'))
      or (${table.kind} = 'analysis' and ${table.disposition} = 'analysis_reuse' and ${table.costState} = 'none')
    )`),
]);

// One row per protocol version. Field changes insert a new version; frozen rows stay put.
// search_required is the frozen requirement. It is not search_triggered and does not rewrite a run.
export const samplingProtocol = sqliteTable("sampling_protocol", {
  id: text("id").primaryKey(),
  protocolId: text("protocol_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  newSessionRequired: integer("new_session_required").notNull(),
  searchRequired: integer("search_required").notNull(),
  targetRegion: text("target_region").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull(),
  fingerprint: text("fingerprint").notNull(),
  operationId: text("operation_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  unique("sampling_protocol_version_key").on(table.protocolId, table.version),
  uniqueIndex("sampling_protocol_fingerprint_uidx").on(table.protocolId, table.fingerprint),
  uniqueIndex("sampling_protocol_operation_uidx").on(table.brandId, table.operationId),
  index("sampling_protocol_owner_idx").on(table.ownerId, table.createdAt, table.id),
  index("sampling_protocol_family_idx").on(table.ownerId, table.protocolId, table.version),
  check("sampling_protocol_state_check", sql`${table.version} > 0
    and ${table.newSessionRequired} in (0, 1) and ${table.searchRequired} in (0, 1)
    and ${table.status} in ('draft', 'frozen')
    and length(${table.id}) = 36 and length(${table.protocolId}) = 36
    and length(${table.brandId}) = 36 and length(${table.ownerId}) between 1 and 128
    and length(${table.targetRegion}) = 2 and length(${table.timezone}) between 1 and 64
    and length(${table.fingerprint}) = 64 and length(${table.operationId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);

// A run can cite one frozen protocol version. Runs created earlier can have no pin.
export const runProtocolPin = sqliteTable("run_protocol_pin", {
  runId: text("run_id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  protocolId: text("protocol_id").notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "run_protocol_pin_run_fk", columns: [table.runId], foreignColumns: [monitoringRun.id] }).onDelete("cascade"),
  foreignKey({
    name: "run_protocol_pin_protocol_fk",
    columns: [table.protocolId, table.version],
    foreignColumns: [samplingProtocol.protocolId, samplingProtocol.version],
  }).onDelete("cascade"),
  index("run_protocol_pin_protocol_idx").on(table.protocolId, table.version),
  index("run_protocol_pin_owner_idx").on(table.ownerId, table.createdAt, table.runId),
  check("run_protocol_pin_state_check", sql`${table.version} > 0
    and length(${table.runId}) = 36 and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128 and length(${table.protocolId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);

// Diagnostic experiments stay here. excluded_from_natural is fixed at 1 so the row cannot enter natural rates.
export const explorationObservation = sqliteTable("exploration_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  answerText: text("answer_text").notNull(),
  exclusionReason: text("exclusion_reason").notNull(),
  excludedFromNatural: integer("excluded_from_natural").notNull().default(1),
  operationId: text("operation_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("exploration_observation_operation_uidx").on(table.brandId, table.operationId),
  index("exploration_observation_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("exploration_observation_state_check", sql`${table.excludedFromNatural} = 1
    and ${table.exclusionReason} = 'custom_pipeline'
    and length(${table.id}) = 36 and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.questionText}) between 1 and 4000
    and length(${table.answerText}) between 1 and 8000
    and length(${table.operationId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
