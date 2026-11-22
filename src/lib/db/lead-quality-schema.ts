import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// Validity rules are append-only. Freezing flips frozen from 0 to 1; a revision inserts the next version.
// Qualifications keep the rule version they were judged against. Rates are not stored.
export const leadValidityRule = pgTable("lead_validity_rule", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  frozen: integer("frozen").notNull(),
  requiresRealNeed: integer("requires_real_need").notNull(),
  requiresIndustry: integer("requires_industry").notNull(),
  requiresFollowUp: integer("requires_follow_up").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("lead_validity_rule_version_uidx").on(table.brandId, table.version),
  index("lead_validity_rule_owner_idx").on(table.ownerId, table.brandId, table.version, table.id),
  check("lead_validity_rule_state_check", sql`${table.version} between 1 and 10000
    and ${table.frozen} in (0, 1)
    and ${table.requiresRealNeed} in (0, 1)
    and ${table.requiresIndustry} in (0, 1)
    and ${table.requiresFollowUp} in (0, 1)
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

export const leadQualification = pgTable("lead_qualification", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  ruleId: text("rule_id").notNull().references(() => leadValidityRule.id, { onDelete: "cascade" }),
  ruleVersion: integer("rule_version").notNull(),
  status: text("status").notNull(),
  realNeed: integer("real_need").notNull(),
  targetIndustry: integer("target_industry").notNull(),
  followUp: integer("follow_up").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("lead_qualification_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  index("lead_qualification_status_idx").on(table.ownerId, table.brandId, table.status),
  index("lead_qualification_rule_idx").on(table.ruleId, table.ruleVersion),
  check("lead_qualification_state_check", sql`${table.status} in ('unfrozen', 'qualified', 'disqualified')
    and ${table.ruleVersion} between 1 and 10000
    and ${table.realNeed} in (0, 1)
    and ${table.targetIndustry} in (0, 1)
    and ${table.followUp} in (0, 1)
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);

// Crawler visits and answer citations stay in separate columns. called_included is fixed at 0:
// a crawler hit is not an AI inclusion. A missing or non-positive session denominator is stored as given.
export const leadObservation = pgTable("lead_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  identifiedReferrals: integer("identified_referrals").notNull(),
  sessionDenominator: integer("session_denominator"),
  selfReported: integer("self_reported").notNull(),
  crawlerVisits: integer("crawler_visits").notNull(),
  answerCitations: integer("answer_citations").notNull(),
  calledIncluded: integer("called_included").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("lead_observation_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("lead_observation_state_check", sql`${table.identifiedReferrals} between 0 and 1000000000
    and (${table.sessionDenominator} is null or ${table.sessionDenominator} between 0 and 1000000000)
    and ${table.selfReported} between 0 and 1000000000
    and ${table.crawlerVisits} between 0 and 1000000000
    and ${table.answerCitations} between 0 and 1000000000
    and ${table.calledIncluded} = 0
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
