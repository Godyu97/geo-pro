import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authMailRate = sqliteTable("auth_mail_rate", {
  key: text("key").primaryKey(),
  attempts: text("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("auth_mail_rate_expiry_idx").on(table.expiresAt)]);
