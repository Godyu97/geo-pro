import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// Event ids are opaque tokens. Phone numbers, email addresses and other direct
// identifiers are rejected before insert and have no columns here.
export const businessLead = pgTable("business_lead", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  eventId: text("event_id").notNull(),
  primaryClass: text("primary_class").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("business_lead_brand_event_uidx").on(table.brandId, table.eventId),
  index("business_lead_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("business_lead_state_check", sql`${table.primaryClass} in ('referral', 'self_report', 'landing_page', 'unknown')
    and length(${table.eventId}) between 1 and 64
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const businessLeadEvidence = pgTable("business_lead_evidence", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => businessLead.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  category: text("category").notNull(),
  position: integer("position").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("business_lead_evidence_lead_idx").on(table.leadId, table.position),
  uniqueIndex("business_lead_evidence_category_uidx").on(table.leadId, table.category),
  check("business_lead_evidence_state_check", sql`${table.category} in ('referral', 'self_report', 'landing_page', 'unknown')
    and ${table.position} between 1 and 4
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
