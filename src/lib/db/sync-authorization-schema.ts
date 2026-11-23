import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// One sync grant. history_deleted stays 0: revocation stops the next pull and keeps retained rows.
// No remote host, token, or deleted-history marker is stored.
export const syncAuthorization = pgTable("sync_authorization", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  revoked: integer("revoked").notNull(),
  retainedRows: integer("retained_rows").notNull(),
  historyDeleted: integer("history_deleted").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("sync_authorization_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("sync_authorization_state_check", sql`${table.revoked} in (0, 1)
    and ${table.historyDeleted} = 0
    and ${table.retainedRows} between 0 and 1000000000
    and length(${table.sourceName}) between 1 and 80
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const syncAttempt = pgTable("sync_attempt", {
  id: text("id").primaryKey(),
  authorizationId: text("authorization_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  result: text("result").notNull(),
  attemptedAt: text("attempted_at").notNull(),
}, (table) => [
  foreignKey({
    name: "sync_attempt_authorization_fk",
    columns: [table.authorizationId],
    foreignColumns: [syncAuthorization.id],
  }).onDelete("cascade"),
  index("sync_attempt_owner_idx").on(table.ownerId, table.authorizationId, table.attemptedAt, table.id),
  check("sync_attempt_state_check", sql`${table.result} in ('allowed', 'stopped')
    and length(${table.id}) = 36
    and length(${table.authorizationId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.attemptedAt}) between 20 and 40`),
]);
