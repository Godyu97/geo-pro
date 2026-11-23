import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// No payment connector is stored. paid stays 0, and status is only draft or awaiting payment.
export const serviceOrder = pgTable("service_order", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  quoted: integer("quoted").notNull(),
  status: text("status").notNull(),
  paid: integer("paid").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("service_order_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("service_order_state_check", sql`${table.paid} = 0
    and ${table.quoted} in (0, 1)
    and ${table.status} in ('draft', 'awaiting_payment')
    and ((${table.quoted} = 1 and ${table.status} = 'awaiting_payment')
      or (${table.quoted} = 0 and ${table.status} = 'draft'))
    and ${table.amount} between 0 and 2000000000
    and ${table.currency} ~ '^[A-Z]{3}$'
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
