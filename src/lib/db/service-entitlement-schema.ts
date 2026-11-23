import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// A package change inserts a new entitlement version. Usage rows keep the original entitlement id.
// Trial and quote are the only kinds. The tables have no charge, collection, or paid column.
export const serviceEntitlement = pgTable("service_entitlement", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  kind: text("kind").notNull(),
  monitoringQuota: integer("monitoring_quota").notNull(),
  contentQuota: integer("content_quota").notNull(),
  laborQuota: integer("labor_quota").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("service_entitlement_brand_kind_version_uidx").on(table.brandId, table.kind, table.version),
  index("service_entitlement_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("service_entitlement_state_check", sql`${table.kind} in ('trial', 'quote')
    and ${table.version} between 1 and 1000000
    and ${table.monitoringQuota} between 0 and 1000000
    and ${table.contentQuota} between 0 and 1000000
    and ${table.laborQuota} between 0 and 1000000
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const entitlementUsage = pgTable("entitlement_usage", {
  id: text("id").primaryKey(),
  entitlementId: text("entitlement_id").notNull().references(() => serviceEntitlement.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("entitlement_usage_entitlement_idx").on(table.entitlementId, table.createdAt, table.id),
  check("entitlement_usage_state_check", sql`${table.kind} in ('monitoring', 'content', 'labor')
    and ${table.quantity} between 1 and 1000000
    and length(${table.id}) = 36
    and length(${table.entitlementId}) = 36
    and length(${table.createdAt}) between 20 and 40`),
]);
