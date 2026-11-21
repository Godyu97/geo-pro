import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Bytes stay in the bucket. This row records ownership, class and the digest.
// Owner and brand are not foreign keys so a tombstone can outlive brand removal.
export const storedObject = sqliteTable("stored_object", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  brandId: text("brand_id"),
  class: text("class").notNull(),
  visibility: text("visibility").notNull(),
  status: text("status").notNull(),
  bucket: text("bucket").notNull(),
  objectKey: text("object_key"),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  fileName: text("file_name"),
  immutable: integer("immutable").notNull(),
  createdAt: text("created_at").notNull(),
  readyAt: text("ready_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("stored_object_key_uidx").on(table.objectKey).where(sql`${table.objectKey} is not null`),
  index("stored_object_owner_idx").on(table.ownerId, table.brandId, table.class, table.createdAt, table.id),
  index("stored_object_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("stored_object_check", sql`${table.class} in ('internal-material', 'authorized-media', 'delivery-package', 'report-snapshot', 'owned-export', 'publication-evidence', 'source-original')
    and ${table.visibility} in ('internal', 'public')
    and (${table.visibility} = 'internal' or ${table.class} = 'authorized-media')
    and ${table.status} in ('pending', 'ready', 'failed', 'tombstoned')
    and ${table.immutable} in (0, 1)
    and (
      (${table.class} in ('delivery-package', 'report-snapshot', 'owned-export', 'publication-evidence') and ${table.immutable} = 1)
      or (${table.class} in ('internal-material', 'authorized-media', 'source-original') and ${table.immutable} = 0)
    )
    and (
      (${table.class} = 'owned-export' and ${table.brandId} is null and ${table.byteSize} between 1 and 8388608)
      or (${table.class} <> 'owned-export' and ${table.brandId} is not null and ${table.byteSize} between 1 and 10485760)
    )
    and length(${table.sha256}) = 64
    and ${table.sha256} = lower(${table.sha256})
    and length(${table.bucket}) between 3 and 63
    and length(${table.contentType}) between 3 and 255
    and length(${table.createdAt}) between 20 and 40
    and (
      (${table.class} = 'authorized-media' and ${table.contentType} in ('image/jpeg', 'image/png', 'image/webp'))
      or (${table.class} = 'publication-evidence' and ${table.contentType} in ('image/jpeg', 'image/png', 'image/webp'))
      or (${table.class} = 'internal-material' and ${table.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown', 'application/pdf', 'application/json'))
      or (${table.class} = 'delivery-package' and ${table.contentType} in ('text/markdown', 'text/html', 'application/json'))
      or (${table.class} = 'report-snapshot' and ${table.contentType} in ('text/html', 'application/json'))
      or (${table.class} = 'owned-export' and ${table.contentType} = 'application/json')
      or (${table.class} = 'source-original' and ${table.contentType} in ('text/plain', 'text/markdown', 'application/pdf', 'application/json'))
    )
    and (
      (${table.status} = 'tombstoned' and ${table.deletedAt} is not null and ${table.fileName} is null and ${table.objectKey} is null)
      or (${table.status} in ('pending', 'failed') and ${table.deletedAt} is null and ${table.readyAt} is null and ${table.fileName} is not null and ${table.objectKey} is not null)
      or (${table.status} = 'ready' and ${table.deletedAt} is null and ${table.readyAt} is not null and ${table.fileName} is not null and ${table.objectKey} is not null)
    )
    and (
      ${table.objectKey} is null
      or (
        length(${table.objectKey}) between 8 and 1024
        and ${table.objectKey} like 'v1/%'
        and ${table.objectKey} not like '%..%'
        and ${table.fileName} is not null
        and length(${table.fileName}) between 1 and 120
        and ${table.fileName} not like '%/%'
        and ${table.fileName} not like '%..%'
      )
    )
    and (${table.readyAt} is null or length(${table.readyAt}) between 20 and 40)
    and (${table.deletedAt} is null or length(${table.deletedAt}) between 20 and 40)`),
]);
