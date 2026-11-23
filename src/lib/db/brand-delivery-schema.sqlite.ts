import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const brandDelivery = sqliteTable("brand_delivery", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull(),
  disputeReason: text("dispute_reason"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("brand_delivery_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("brand_delivery_state_check", sql`${table.status} in ('pending', 'accepted', 'disputed')
    and ((${table.status} = 'disputed' and ${table.disputeReason} is not null and length(${table.disputeReason}) between 1 and 500)
      or (${table.status} in ('pending', 'accepted') and ${table.disputeReason} is null))
    and length(${table.title}) between 1 and 120
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
