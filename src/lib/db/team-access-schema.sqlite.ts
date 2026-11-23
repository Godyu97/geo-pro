import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

export const brandMemberGrant = sqliteTable("brand_member_grant", {
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

export const queuedBrandAction = sqliteTable("queued_brand_action", {
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

export const brandOwnerTransfer = sqliteTable("brand_owner_transfer", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  toUserId: text("to_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("brand_owner_transfer_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("brand_owner_transfer_state_check", sql`${table.fromUserId} <> ${table.toUserId}
    and length(${table.fromUserId}) between 1 and 128
    and length(${table.toUserId}) between 1 and 128
    and length(${table.actorId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const teamInvitation = sqliteTable("team_invitation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  inviteeUserId: text("invitee_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  replacedBy: text("replaced_by"),
}, (table) => [
  uniqueIndex("team_invitation_token_uidx").on(table.tokenHash),
  index("team_invitation_invitee_idx").on(table.inviteeUserId, table.createdAt, table.id),
  index("team_invitation_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("team_invitation_state_check", sql`${table.role} = 'member'
    and ${table.status} in ('open', 'accepted', 'expired', 'revoked')
    and ${table.inviteeUserId} <> ${table.createdBy}
    and length(${table.inviteeUserId}) between 1 and 128
    and length(${table.createdBy}) between 1 and 128
    and length(${table.tokenHash}) = 64
    and ${table.tokenHash} = lower(${table.tokenHash})
    and length(${table.expiresAt}) between 20 and 40
    and length(${table.createdAt}) between 20 and 40
    and ((${table.status} in ('open', 'accepted', 'revoked') and ${table.replacedBy} is null)
      or (${table.status} = 'expired' and (${table.replacedBy} is null or length(${table.replacedBy}) between 1 and 128)))`),
]);
