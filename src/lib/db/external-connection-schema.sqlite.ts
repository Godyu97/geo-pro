import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

// Local connection capabilities only. No password, access token, cookie, or remote host is stored.
export const externalConnection = sqliteTable("external_connection", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  label: text("label").notNull(),
  canRead: integer("can_read").notNull(),
  canDraft: integer("can_draft").notNull(),
  canPublish: integer("can_publish").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("external_connection_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("external_connection_state_check", sql`${table.status} in ('pending', 'verified', 'revoked')
    and ${table.canRead} in (0, 1)
    and ${table.canDraft} in (0, 1)
    and ${table.canPublish} in (0, 1)
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.label}) between 1 and 80
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const externalAction = sqliteTable("external_action", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  confirmed: integer("confirmed").notNull(),
  status: text("status").notNull(),
  receiptKind: text("receipt_kind"),
  effectiveAt: text("effective_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "external_action_connection_fk",
    columns: [table.connectionId],
    foreignColumns: [externalConnection.id],
  }).onDelete("cascade"),
  uniqueIndex("external_action_key_uidx").on(table.connectionId, table.idempotencyKey),
  index("external_action_connection_idx").on(table.ownerId, table.connectionId, table.createdAt, table.id),
  check("external_action_state_check", sql`${table.confirmed} in (0, 1)
    and ${table.status} in ('confirmed', 'acknowledged', 'unknown', 'failed', 'reconciled')
    and (${table.receiptKind} is null or ${table.receiptKind} in ('draft_created', 'public_url'))
    and length(${table.id}) = 36
    and length(${table.connectionId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.idempotencyKey}) between 8 and 80
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40
    and (
      (${table.status} = 'failed' and ${table.receiptKind} is null and ${table.effectiveAt} is null)
      or (${table.status} in ('confirmed', 'unknown') and ${table.confirmed} = 1 and ${table.receiptKind} is null and ${table.effectiveAt} is null)
      or (
        ${table.status} in ('acknowledged', 'reconciled')
        and ${table.confirmed} = 1
        and (
          (${table.receiptKind} is null and ${table.effectiveAt} is null)
          or (${table.receiptKind} = 'draft_created' and ${table.effectiveAt} is null)
          or (${table.receiptKind} = 'public_url' and ${table.effectiveAt} is not null and length(${table.effectiveAt}) between 20 and 40)
        )
      )
    )`),
]);
