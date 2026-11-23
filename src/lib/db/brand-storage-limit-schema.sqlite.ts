import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

// One configurable byte ceiling per brand. A missing row is not a ceiling.
// Live usage is the sum of pending and ready stored_object bytes, not a column here.
export const brandStorageLimit = sqliteTable("brand_storage_limit", {
  brandId: text("brand_id").primaryKey().references(() => brand.id, { onDelete: "cascade" }),
  byteLimit: integer("byte_limit").notNull(),
}, (table) => [
  check("brand_storage_limit_bytes_check", sql`${table.byteLimit} between 1 and 2147483647`),
]);
