import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";
import { brandFactVersion } from "./brand-fact-schema.sqlite";

// Import outcome for one original. Bytes live in stored_object; this row keeps the
// batch result and rights state after the object itself is revoked or expired.
// No foreign key to stored_object: a tombstone can outlive the file name.
export const sourceOriginal = sqliteTable("source_original", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  batchId: text("batch_id").notNull(),
  fileName: text("file_name").notNull(),
  byteSize: integer("byte_size").notNull(),
  storedObjectId: text("stored_object_id"),
  status: text("status").notNull(),
  reason: text("reason"),
  rightsStatus: text("rights_status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("source_original_object_uidx").on(table.storedObjectId).where(sql`${table.storedObjectId} is not null`),
  index("source_original_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  index("source_original_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("source_original_state_check", sql`${table.status} in ('ready', 'partial', 'failed')
    and ${table.rightsStatus} in ('active', 'revoked', 'expired')
    and (${table.reason} is null or ${table.reason} in ('encrypted', 'oversized', 'unrecognized', 'batch_limit', 'unavailable', 'capacity'))
    and length(${table.fileName}) between 1 and 120
    and ${table.fileName} not like '%/%'
    and ${table.fileName} not like '%..%'
    and length(${table.batchId}) between 1 and 64
    and length(${table.createdAt}) between 20 and 40
    and (
      (${table.status} in ('ready', 'partial')
        and ${table.storedObjectId} is not null
        and ${table.reason} is null
        and ${table.byteSize} between 1 and 10485760)
      or (${table.status} = 'failed'
        and ${table.storedObjectId} is null
        and ${table.reason} is not null
        and ${table.rightsStatus} = 'active'
        and ${table.byteSize} between 0 and 2147483647)
    )`),
]);

export const sourceOriginalFragment = sqliteTable("source_original_fragment", {
  id: text("id").primaryKey(),
  sourceOriginalId: text("source_original_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  page: integer("page"),
  excerpt: text("excerpt"),
  candidateState: text("candidate_state").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "source_original_fragment_source_fk",
    columns: [table.sourceOriginalId],
    foreignColumns: [sourceOriginal.id],
  }).onDelete("cascade"),
  uniqueIndex("source_original_fragment_ordinal_uidx").on(table.sourceOriginalId, table.ordinal),
  index("source_original_fragment_brand_idx").on(table.brandId, table.sourceOriginalId, table.ordinal),
  check("source_original_fragment_state_check", sql`${table.candidateState} = 'unapproved'
    and ${table.ordinal} between 0 and 199
    and (${table.page} is null or ${table.page} between 1 and 100000)
    and (${table.excerpt} is null or length(${table.excerpt}) between 1 and 50000)
    and length(${table.id}) = 36
    and length(${table.sourceOriginalId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const sourceOriginalFragmentConflict = sqliteTable("source_original_fragment_conflict", {
  fragmentId: text("fragment_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  factVersionId: text("fact_version_id").notNull(),
  factVersion: integer("fact_version").notNull(),
}, (table) => [
  foreignKey({
    name: "source_original_fragment_conflict_fragment_fk",
    columns: [table.fragmentId],
    foreignColumns: [sourceOriginalFragment.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "source_original_fragment_conflict_fact_fk",
    columns: [table.brandId, table.factVersionId],
    foreignColumns: [brandFactVersion.brandId, brandFactVersion.id],
  }).onDelete("cascade"),
  uniqueIndex("source_original_fragment_conflict_uidx").on(table.fragmentId, table.factVersionId),
  index("source_original_fragment_conflict_brand_idx").on(table.brandId, table.fragmentId, table.factVersion, table.factVersionId),
  check("source_original_fragment_conflict_state_check", sql`${table.factVersion} > 0
    and length(${table.fragmentId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.factVersionId}) = 36`),
]);
