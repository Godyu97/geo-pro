import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";

export const authMailRate = pgTable("auth_mail_rate", {
  key: text("key").primaryKey(),
  attempts: text("attempts").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => [index("auth_mail_rate_expiry_idx").on(table.expiresAt)]);
