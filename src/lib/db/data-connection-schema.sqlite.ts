import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

// Field preview and an opaque sync cursor. No access token, cookie, remote host, or event body is stored.
export const dataConnection = sqliteTable("data_connection", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  status: text("status").notNull(),
  fieldCount: integer("field_count").notNull(),
  pullAttemptedAt: text("pull_attempted_at"),
  syncCursor: text("sync_cursor"),
  coverageComplete: integer("coverage_complete"),
  syncStopped: integer("sync_stopped").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("data_connection_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("data_connection_state_check", sql`${table.status} in ('preview', 'approved')
    and ${table.fieldCount} between 1 and 40
    and length(${table.displayName}) between 1 and 80
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40
    and ${table.syncStopped} in (0, 1)
    and (
      (${table.syncCursor} is null and ${table.coverageComplete} is null)
      or (
        length(${table.syncCursor}) between 1 and 64
        and substr(${table.syncCursor}, 1, 1) glob '[A-Za-z0-9]'
        and ${table.syncCursor} not glob '*[^A-Za-z0-9._:-]*'
        and ${table.coverageComplete} in (0, 1)
      )
    )
    and (
      (${table.status} = 'preview' and ${table.pullAttemptedAt} is null and ${table.syncCursor} is null and ${table.syncStopped} = 0)
      or (
        ${table.status} = 'approved'
        and (${table.pullAttemptedAt} is null or length(${table.pullAttemptedAt}) between 20 and 40)
      )
    )`),
]);

export const dataConnectionField = sqliteTable("data_connection_field", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  fieldName: text("field_name").notNull(),
}, (table) => [
  foreignKey({
    name: "data_connection_field_connection_fk",
    columns: [table.connectionId],
    foreignColumns: [dataConnection.id],
  }).onDelete("cascade"),
  uniqueIndex("data_connection_field_connection_idx").on(table.connectionId, table.position),
  uniqueIndex("data_connection_field_name_uidx").on(table.connectionId, table.fieldName),
  index("data_connection_field_owner_idx").on(table.ownerId, table.connectionId, table.position),
  check("data_connection_field_state_check", sql`${table.position} between 0 and 39
    and length(${table.fieldName}) between 1 and 64
    and substr(${table.fieldName}, 1, 1) glob '[A-Za-z]'
    and ${table.fieldName} not glob '*[^A-Za-z0-9_]*'
    and length(${table.id}) = 36
    and length(${table.connectionId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128`),
]);

// Processed incremental sync batch receipts. Cursors are opaque connector tokens, not ordered strings.
export const dataConnectionSyncBatch = sqliteTable("data_connection_sync_batch", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  cursor: text("cursor").notNull(),
  previousCursor: text("previous_cursor"),
  payloadDigest: text("payload_digest").notNull(),
  coverageComplete: integer("coverage_complete").notNull(),
  syncedAt: text("synced_at").notNull(),
}, (table) => [
  foreignKey({
    name: "data_connection_sync_batch_connection_fk",
    columns: [table.connectionId],
    foreignColumns: [dataConnection.id],
  }).onDelete("cascade"),
  uniqueIndex("data_connection_sync_batch_cursor_uidx").on(table.connectionId, table.cursor),
  index("data_connection_sync_batch_owner_idx").on(table.ownerId, table.connectionId, table.syncedAt, table.id),
  check("data_connection_sync_batch_state_check", sql`length(${table.id}) = 36
    and length(${table.connectionId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.cursor}) between 1 and 64
    and substr(${table.cursor}, 1, 1) glob '[A-Za-z0-9]'
    and ${table.cursor} not glob '*[^A-Za-z0-9._:-]*'
    and (${table.previousCursor} is null or (
      length(${table.previousCursor}) between 1 and 64
      and substr(${table.previousCursor}, 1, 1) glob '[A-Za-z0-9]'
      and ${table.previousCursor} not glob '*[^A-Za-z0-9._:-]*'
      and ${table.previousCursor} <> ${table.cursor}
    ))
    and length(${table.payloadDigest}) = 64
    and ${table.payloadDigest} not glob '*[^a-f0-9]*'
    and ${table.coverageComplete} in (0, 1)
    and length(${table.syncedAt}) between 20 and 40`),
]);
