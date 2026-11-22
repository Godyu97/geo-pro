import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// One row per user and brand. Revoke clears active and keeps the row so queued
// actions can still point at the grant that authorized them.
export const brandMemberGrant = pgTable("brand_member_grant", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  active: integer("active").notNull(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("brand_member_grant_pair_uidx").on(table.userId, table.brandId),
  index("brand_member_grant_user_idx").on(table.userId, table.brandId).where(sql`${table.active} = 1`),
  index("brand_member_grant_brand_idx").on(table.brandId, table.userId),
  check("brand_member_grant_state_check", sql`${table.role} in ('owner', 'member')
    and ${table.active} in (0, 1)
    and length(${table.userId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and (${table.expiresAt} is null or length(${table.expiresAt}) between 20 and 40)
    and ((${table.active} = 1 and ${table.revokedAt} is null)
      or (${table.active} = 0 and length(${table.revokedAt}) between 20 and 40))`),
]);

// Attachment bytes stay on the row. A stopped action is not deleted and is not returned.
export const queuedBrandAction = pgTable("queued_brand_action", {
  id: text("id").primaryKey(),
  grantId: text("grant_id").notNull().references(() => brandMemberGrant.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  attachment: text("attachment").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("queued_brand_action_grant_idx").on(table.grantId, table.status),
  check("queued_brand_action_state_check", sql`${table.status} in ('queued', 'stopped')
    and length(${table.attachment}) between 16 and 64
    and length(${table.createdAt}) between 20 and 40`),
]);
