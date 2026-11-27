import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const imageAsset = sqliteTable("image_asset", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  rightsStatus: text("rights_status").notNull(),
  fileName: text("file_name").notNull(),
  byteSize: integer("byte_size"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("image_asset_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("image_asset_state_check", sql`${table.rightsStatus} in ('active', 'revoked', 'expired')
    and ${table.version} >= 1
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.fileName}) between 1 and 120
    and ${table.fileName} not like '%/%'
    and ${table.fileName} not like '%..%'
    and (${table.byteSize} is null or ${table.byteSize} between 0 and 2147483647)
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const imageAssetUse = sqliteTable("image_asset_use", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  contentVersionId: text("content_version_id").notNull(),
  assetVersion: integer("asset_version").notNull(),
  createdAt: text("created_at").notNull(),
  supersededAt: text("superseded_at"),
}, (table) => [
  foreignKey({
    name: "image_asset_use_asset_fk",
    columns: [table.assetId],
    foreignColumns: [imageAsset.id],
  }).onDelete("cascade"),
  uniqueIndex("image_asset_use_pair_uidx").on(table.assetId, table.contentVersionId),
  index("image_asset_use_asset_idx").on(table.assetId, table.createdAt, table.id),
  index("image_asset_use_content_idx").on(table.contentVersionId, table.brandId)
    .where(sql`${table.supersededAt} is null`),
  check("image_asset_use_state_check", sql`${table.assetVersion} >= 1
    and length(${table.id}) = 36
    and length(${table.assetId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.contentVersionId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);

// use_id is unique, so one citation has one todo. It is not a foreign key:
// SQLite full DDL creates tables alphabetically, and a forward key to image_asset_use fails.
export const imageAssetTodo = sqliteTable("image_asset_todo", {
  id: text("id").primaryKey(),
  useId: text("use_id").notNull(),
  assetId: text("asset_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  contentVersionId: text("content_version_id").notNull(),
  assetVersion: integer("asset_version").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "image_asset_todo_asset_fk",
    columns: [table.assetId],
    foreignColumns: [imageAsset.id],
  }).onDelete("cascade"),
  uniqueIndex("image_asset_todo_use_uidx").on(table.useId),
  index("image_asset_todo_asset_idx").on(table.assetId, table.createdAt, table.id),
  check("image_asset_todo_state_check", sql`${table.assetVersion} >= 1
    and length(${table.id}) = 36
    and length(${table.useId}) = 36
    and length(${table.assetId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.contentVersionId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
