import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

// Local notification permission only. No access token, destination, or notice body is stored.
export const notificationEndpoint = sqliteTable("notification_endpoint", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("notification_endpoint_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("notification_endpoint_state_check", sql`${table.status} in ('verified', 'revoked')
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.label}) between 1 and 80
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const notificationDelivery = sqliteTable("notification_delivery", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  sent: integer("sent").notNull(),
  bodyHasCustomerText: integer("body_has_customer_text").notNull(),
  bodyHash: text("body_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "notification_delivery_endpoint_fk",
    columns: [table.endpointId],
    foreignColumns: [notificationEndpoint.id],
  }).onDelete("cascade"),
  index("notification_delivery_endpoint_idx").on(table.ownerId, table.endpointId, table.createdAt, table.id),
  check("notification_delivery_state_check", sql`${table.sent} in (0, 1)
    and ${table.bodyHasCustomerText} in (0, 1)
    and (${table.bodyHasCustomerText} = 0 or ${table.sent} = 0)
    and length(${table.id}) = 36
    and length(${table.endpointId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.bodyHash}) = 64
    and ${table.bodyHash} = lower(${table.bodyHash})
    and ${table.bodyHash} not glob '*[^0-9a-f]*'
    and length(${table.createdAt}) between 20 and 40`),
]);
