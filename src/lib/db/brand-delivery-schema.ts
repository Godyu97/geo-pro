import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// Acceptance is a delivery state. The table has no payment, collection, or paid column.
export const brandDelivery = pgTable("brand_delivery", {
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
