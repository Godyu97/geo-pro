import { sql } from "drizzle-orm";
import { check, foreignKey, integer, sqliteTable, primaryKey, text, unique } from "drizzle-orm/sqlite-core";
import { brand } from "./brand-schema.sqlite";

export const quotaGrant = sqliteTable("quota_grant", {
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  version: integer("version").notNull(),
  operationId: text("operation_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  countLimit: integer("count_limit").notNull(),
  budgetMinor: integer("budget_minor").notNull(),
  currency: text("currency").notNull(),
  expiresAt: text("expires_at").notNull(),
  changedAt: text("changed_at").notNull(),
  action: text("action").notNull(),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.kind, table.version] }),
  unique("quota_grant_operation_unique").on(table.brandId, table.kind, table.operationId),
  check("quota_grant_limits_check", sql`${table.kind} in ('sampling', 'generation') and ${table.action} in ('set', 'revoke')
    and ${table.version} > 0 and ${table.countLimit} > 0 and ${table.budgetMinor} >= 0 and length(${table.currency}) = 3`),
]);

export const quotaReservation = sqliteTable("quota_reservation", {
  brandId: text("brand_id").notNull(),
  kind: text("kind").notNull(),
  id: text("id").notNull(),
  grantVersion: integer("grant_version").notNull(),
  upperMinor: integer("upper_minor").notNull(),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull(),
  finalizedAt: text("finalized_at"),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.kind, table.id] }),
  foreignKey({ name: "quota_reservation_grant_fk",
    columns: [table.brandId, table.kind, table.grantVersion], foreignColumns: [quotaGrant.brandId, quotaGrant.kind, quotaGrant.version],
  }).onDelete("cascade"),
  check("quota_reservation_state_check", sql`${table.upperMinor} >= 0 and (
    (${table.state} = 'reserved' and ${table.finalizedAt} is null) or
    (${table.state} in ('settled', 'released') and ${table.finalizedAt} is not null)
  )`),
]);

export const quotaAttempt = sqliteTable("quota_attempt", {
  brandId: text("brand_id").notNull(),
  kind: text("kind").notNull(),
  reservationId: text("reservation_id").notNull(),
  id: text("id").notNull(),
  upperMinor: integer("upper_minor").notNull(),
  actualMinor: integer("actual_minor"),
  state: text("state").notNull(),
  startedAt: text("started_at").notNull(),
  reconciledAt: text("reconciled_at"),
}, (table) => [
  primaryKey({ columns: [table.brandId, table.kind, table.reservationId, table.id] }),
  foreignKey({ name: "quota_attempt_reservation_fk",
    columns: [table.brandId, table.kind, table.reservationId], foreignColumns: [quotaReservation.brandId, quotaReservation.kind, quotaReservation.id],
  }).onDelete("cascade"),
  check("quota_attempt_cost_check", sql`${table.upperMinor} >= 0 and (
    (${table.state} in ('pending', 'unknown') and ${table.actualMinor} is null and ${table.reconciledAt} is null) or
    (${table.state} = 'known' and ${table.actualMinor} is not null and ${table.actualMinor} >= 0 and ${table.reconciledAt} is not null)
  )`),
]);
