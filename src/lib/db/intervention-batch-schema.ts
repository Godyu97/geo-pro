import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// The effective time is the latest page verification, never a planned date.
// Pending batches keep a null effective time, including when a page is still unverified.
export const interventionBatch = pgTable("intervention_batch", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull(),
  effectiveAt: text("effective_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("intervention_batch_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("intervention_batch_state_check", sql`${table.status} in ('pending', 'effective')
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and (
      (${table.status} = 'pending' and ${table.effectiveAt} is null)
      or (${table.status} = 'effective' and ${table.effectiveAt} is not null
        and length(${table.effectiveAt}) between 20 and 40)
    )
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const interventionBatchPage = pgTable("intervention_batch_page", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  pageKey: text("page_key").notNull(),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "intervention_batch_page_batch_fk",
    columns: [table.batchId],
    foreignColumns: [interventionBatch.id],
  }).onDelete("cascade"),
  uniqueIndex("intervention_batch_page_key_uidx").on(table.batchId, table.pageKey),
  check("intervention_batch_page_state_check", sql`length(${table.id}) = 36
    and length(${table.batchId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.pageKey}) between 1 and 300
    and (${table.verifiedAt} is null or length(${table.verifiedAt}) between 20 and 40)
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);
