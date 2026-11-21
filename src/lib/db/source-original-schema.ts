import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// Import outcome for one original. Bytes live in stored_object; this row keeps the
// batch result and rights state after the object itself is revoked or expired.
// No foreign key to stored_object: a tombstone can outlive the file name.
export const sourceOriginal = pgTable("source_original", {
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
    and (${table.reason} is null or ${table.reason} in ('encrypted', 'oversized', 'unrecognized', 'batch_limit', 'unavailable'))
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
