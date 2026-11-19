import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, primaryKey, text, unique } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const capabilityChannel = sqliteTable("capability_channel", {
  id: text("id").primaryKey(),
  vendorId: text("vendor_id").notNull(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("capability_channel_kind_check", sql`${table.kind} in ('consumer_ui', 'model_api', 'custom_pipeline')`),
  index("capability_channel_vendor_kind_idx").on(table.vendorId, table.kind, table.id),
]);

export const capabilityVersion = sqliteTable("capability_version", {
  channelId: text("channel_id").notNull().references(() => capabilityChannel.id),
  version: integer("version").notNull(),
  operationId: text("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  displayName: text("display_name").notNull(),
  productEntry: text("product_entry").notNull(),
  mode: text("mode").notNull(),
  modelVersion: text("model_version").notNull(),
  availability: text("availability").notNull(),
  searchRequired: integer("search_required").notNull(),
  citationCapability: text("citation_capability").notNull(),
  regionTarget: text("region_target").notNull(),
  regionActual: text("region_actual").notNull(),
  limitsSummary: text("limits_summary").notNull(),
  sopSummary: text("sop_summary").notNull(),
  verifiedAt: text("verified_at"),
  expiresAt: text("expires_at"),
  publicVisible: integer("public_visible").notNull(),
  changedAt: text("changed_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.version] }),
  unique("capability_version_operation_unique").on(table.operationId),
  check("capability_version_values_check", sql`${table.version} > 0
    and ${table.status} in ('candidate', 'verified', 'degraded', 'disabled')
    and ${table.reason} in ('initial-record', 'verification', 'significant-change', 'disable', 'restore', 'expiry-review')
    and ${table.citationCapability} in ('complete', 'partial', 'unsupported')
    and ${table.searchRequired} in (0, 1) and ${table.publicVisible} in (0, 1)
    and (
      (${table.status} = 'verified' and ${table.verifiedAt} is not null and ${table.expiresAt} is not null)
      or (${table.status} <> 'verified' and ${table.publicVisible} = 0)
    )`),
]);

export const samplingAnswerNetwork = sqliteTable("sampling_answer_network", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  channelVersion: integer("channel_version").notNull(),
  requestedNetworkMode: text("requested_network_mode").notNull(),
  actualNetwork: text("actual_network").notNull(),
  triggerEvidence: text("trigger_evidence").notNull(),
  qualifiesRequiredSearch: integer("qualifies_required_search").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  foreignKey({
    name: "sampling_answer_network_version_fk",
    columns: [table.channelId, table.channelVersion],
    foreignColumns: [capabilityVersion.channelId, capabilityVersion.version],
  }),
  check("sampling_answer_network_values_check", sql`${table.requestedNetworkMode} in ('on', 'off', 'unknown')
    and ${table.actualNetwork} in ('true', 'false', 'unknown')
    and ${table.triggerEvidence} in ('none', 'observed')
    and ${table.qualifiesRequiredSearch} in (0, 1)`),
  index("sampling_answer_network_brand_created_idx").on(table.brandId, table.createdAt, table.id),
  index("sampling_answer_network_channel_version_idx").on(table.channelId, table.channelVersion),
]);
