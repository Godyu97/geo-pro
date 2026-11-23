import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// White-label copy keeps track, sample size and grade. Revocation does not delete access rows.
export const whitelabelShare = pgTable("whitelabel_share", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  track: text("track").notNull(),
  sampleSize: integer("sample_size").notNull(),
  grade: text("grade").notNull(),
  expiresAt: text("expires_at").notNull(),
  revoked: integer("revoked").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("whitelabel_share_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("whitelabel_share_state_check", sql`${table.revoked} in (0, 1)
    and ${table.sampleSize} between 0 and 2000000000
    and ${table.track} ~ '^[a-z0-9_]{1,64}$'
    and ${table.grade} ~ '^[a-z0-9_]{1,32}$'
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.expiresAt}) between 20 and 40
    and length(${table.createdAt}) between 20 and 40`),
]);

export const whitelabelShareAccess = pgTable("whitelabel_share_access", {
  id: text("id").primaryKey(),
  shareId: text("share_id").notNull().references(() => whitelabelShare.id, { onDelete: "cascade" }),
  visitorId: text("visitor_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessedAt: text("accessed_at").notNull(),
}, (table) => [
  index("whitelabel_share_access_share_idx").on(table.shareId, table.accessedAt, table.id),
  check("whitelabel_share_access_state_check", sql`length(${table.id}) = 36
    and length(${table.shareId}) = 36
    and length(${table.visitorId}) between 1 and 128
    and length(${table.accessedAt}) between 20 and 40`),
]);
