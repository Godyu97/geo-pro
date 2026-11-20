import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";

export const userDataExport = sqliteTable("user_data_export", {
  ownerId: text("owner_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  locale: text("locale").notNull(),
  requested: integer("requested").notNull(),
  included: integer("included").notNull(),
  fingerprint: text("fingerprint"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("user_data_export_locale_check", sql`${table.locale} in ('zh-CN', 'en')`),
  check("user_data_export_scope_check", sql`${table.requested} between 1 and 127 and ${table.included} between 0 and 127 and (${table.included} & ${table.requested}) = ${table.included}`),
  check("user_data_export_fingerprint_check", sql`(${table.included} = 0 and ${table.fingerprint} is null) or (${table.included} <> 0 and ${table.fingerprint} is not null and length(${table.fingerprint}) = 64)`),
]);
