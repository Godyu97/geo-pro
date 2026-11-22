import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const qualityAlert = sqliteTable("quality_alert", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  windowId: text("window_id").notNull(),
  status: text("status").notNull(),
  claimBrandDecline: integer("claim_brand_decline").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("quality_alert_open_window_uidx")
    .on(table.brandId, table.kind, table.windowId)
    .where(sql`${table.status} <> 'resolved'`),
  index("quality_alert_owner_idx").on(table.ownerId, table.brandId, table.updatedAt, table.id),
  check("quality_alert_state_check", sql`${table.kind} in ('data_quality', 'trend')
    and ${table.status} in ('open', 'acknowledged', 'snoozed', 'resolved')
    and ${table.claimBrandDecline} in (0, 1)
    and (
      (${table.kind} = 'data_quality' and ${table.claimBrandDecline} = 0
        and ${table.reason} in ('coverage_insufficient', 'citation_field_changed', 'mode_changed'))
      or (${table.kind} = 'trend' and ${table.claimBrandDecline} = 1 and ${table.reason} = 'recommendation_drop')
    )
    and length(${table.windowId}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const qualityAlertEvent = sqliteTable("quality_alert_event", {
  id: text("id").primaryKey(),
  alertId: text("alert_id").notNull().references(() => qualityAlert.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("quality_alert_event_alert_idx").on(table.ownerId, table.alertId, table.occurredAt, table.id),
  check("quality_alert_event_state_check", sql`length(${table.ownerId}) between 1 and 128
    and length(${table.occurredAt}) between 20 and 40`),
]);
