import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// One store under a brand. Service areas stay on the store and do not overwrite a sibling.
export const brandStore = pgTable("brand_store", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serviceArea: text("service_area").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("brand_store_owner_brand_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("brand_store_state_check", sql`length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.name}) between 1 and 80
    and length(${table.serviceArea}) between 1 and 160
    and length(${table.createdAt}) between 20 and 40`),
]);

// A check record snapshots the selected store's service area. used_other_store stays 0.
export const storeFactUse = pgTable("store_fact_use", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => brandStore.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  serviceArea: text("service_area").notNull(),
  usedOtherStore: integer("used_other_store").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [
  index("store_fact_use_owner_idx").on(table.ownerId, table.recordedAt, table.id),
  check("store_fact_use_state_check", sql`${table.usedOtherStore} = 0
    and length(${table.id}) = 36
    and length(${table.storeId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.serviceArea}) between 1 and 160
    and length(${table.recordedAt}) between 20 and 40`),
]);
