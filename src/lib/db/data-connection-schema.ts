import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// Field preview only. No access token, cookie, remote host, or connector event is stored.
// pull_attempted_at stays empty until one approved pull is recorded.
export const dataConnection = pgTable("data_connection", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  status: text("status").notNull(),
  fieldCount: integer("field_count").notNull(),
  pullAttemptedAt: text("pull_attempted_at"),
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
    and (
      (${table.status} = 'preview' and ${table.pullAttemptedAt} is null)
      or (
        ${table.status} = 'approved'
        and (${table.pullAttemptedAt} is null or length(${table.pullAttemptedAt}) between 20 and 40)
      )
    )`),
]);

export const dataConnectionField = pgTable("data_connection_field", {
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
    and ${table.fieldName} ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
    and length(${table.id}) = 36
    and length(${table.connectionId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128`),
]);
