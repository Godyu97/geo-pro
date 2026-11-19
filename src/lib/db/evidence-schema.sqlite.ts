import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";
import { monitoringSlot, monitoringAttempt } from "./monitoring-schema.sqlite";

export const answerObservation = sqliteTable("answer_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  slotId: text("slot_id"),
  attemptId: text("attempt_id"),
  sourceMode: text("source_mode").notNull(),
  captureMethod: text("capture_method").notNull(),
  questionText: text("question_text").notNull(),
  answerText: text("answer_text").notNull(),
  fingerprint: text("fingerprint").notNull(),
  capturedAt: text("captured_at").notNull(),
  region: text("region").notNull(),
  language: text("language").notNull(),
  requestedNetworkMode: text("requested_network_mode").notNull(),
  entityVersion: integer("entity_version").notNull(),
  citationSetState: text("citation_set_state").notNull(),
  evidenceState: text("evidence_state").notNull(),
  locatorRef: text("locator_ref"),
  collectorId: text("collector_id"),
  missingReason: text("missing_reason"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "answer_observation_slot_fk", columns: [table.slotId], foreignColumns: [monitoringSlot.id] }).onDelete("set null"),
  foreignKey({ name: "answer_observation_attempt_fk", columns: [table.attemptId], foreignColumns: [monitoringAttempt.id] }).onDelete("set null"),
  uniqueIndex("answer_observation_slot_uidx").on(table.slotId).where(sql`${table.slotId} is not null and ${table.evidenceState} in ('complete', 'incomplete', 'contested')`),
  index("answer_observation_brand_idx").on(table.brandId, table.createdAt, table.id),
  index("answer_observation_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("answer_observation_state_check", sql`${table.sourceMode} in ('model_api', 'consumer_ui')
    and ${table.captureMethod} in ('official_api', 'manual', 'assisted', 'isolated')
    and ${table.citationSetState} in ('complete', 'partial', 'unsupported', 'missing')
    and ${table.evidenceState} in ('draft_evidence', 'complete', 'incomplete', 'contested')
    and ${table.entityVersion} > 0 and length(${table.fingerprint}) = 64
    and length(${table.region}) = 2 and length(${table.language}) between 2 and 40
    and ${table.requestedNetworkMode} in ('on', 'off', 'unknown')
    and (
      (${table.evidenceState} = 'draft_evidence')
      or (${table.evidenceState} in ('complete', 'incomplete', 'contested') and length(${table.answerText}) > 0)
    )
    and (
      (${table.sourceMode} = 'consumer_ui' and ${table.captureMethod} in ('manual', 'assisted'))
      or (${table.sourceMode} = 'model_api' and ${table.captureMethod} in ('official_api', 'isolated', 'assisted'))
    )`),
]);

export const answerCitation = sqliteTable("answer_citation", {
  id: text("id").primaryKey(),
  observationId: text("observation_id").notNull(),
  brandId: text("brand_id").notNull(),
  rawUrl: text("raw_url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  citationOrigin: text("citation_origin").notNull(),
  positionLabel: text("position_label"),
  ownership: text("ownership").notNull(),
  pageStatus: text("page_status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "answer_citation_observation_fk", columns: [table.observationId], foreignColumns: [answerObservation.id] }).onDelete("cascade"),
  index("answer_citation_observation_idx").on(table.observationId, table.id),
  index("answer_citation_brand_idx").on(table.brandId, table.observationId),
  check("answer_citation_state_check", sql`${table.citationOrigin} in ('provider_native', 'consumer_visible', 'search_candidate', 'analyst_found', 'custom_pipeline')
    and ${table.ownership} in ('owned_domain', 'owned_account', 'competitor', 'third_party', 'unknown')
    and ${table.pageStatus} in ('unknown', 'reachable', 'restricted', 'not_applicable')`),
]);

export const answerAnalysisVersion = sqliteTable("answer_analysis_version", {
  id: text("id").primaryKey(),
  observationId: text("observation_id").notNull(),
  brandId: text("brand_id").notNull(),
  version: integer("version").notNull(),
  entityVersion: integer("entity_version").notNull(),
  ruleVersion: text("rule_version").notNull(),
  mentioned: text("mentioned").notNull(),
  recommended: text("recommended").notNull(),
  officialSiteCited: text("official_site_cited").notNull(),
  evidenceSpan: text("evidence_span"),
  status: text("status").notNull(),
  revisedFrom: text("revised_from"),
  reason: text("reason"),
  reviewerId: text("reviewer_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({ name: "answer_analysis_observation_fk", columns: [table.observationId], foreignColumns: [answerObservation.id] }).onDelete("cascade"),
  uniqueIndex("answer_analysis_version_uidx").on(table.observationId, table.version),
  index("answer_analysis_brand_idx").on(table.brandId, table.observationId, table.version),
  check("answer_analysis_state_check", sql`${table.version} > 0 and ${table.entityVersion} > 0
    and ${table.mentioned} in ('true', 'false', 'unknown')
    and ${table.recommended} in ('true', 'false', 'unknown')
    and ${table.officialSiteCited} in ('true', 'false', 'unknown')
    and ${table.status} in ('pending', 'classified', 'needs_review', 'revised')
    and (${table.revisedFrom} is null or ${table.revisedFrom} <> ${table.id})`),
]);
