import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// System rows have no brand and stay read-only in the command layer.
// A team clone must keep all three gates on and point at its source.
export const contentTemplate = pgTable("content_template", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id"),
  system: integer("is_system").notNull(),
  sourceTemplateId: text("source_template_id"),
  factGate: integer("fact_gate").notNull(),
  publicLicenseGate: integer("public_license_gate").notNull(),
  reviewGate: integer("review_gate").notNull(),
  status: text("status").notNull(),
  asksToInventCaseStudy: integer("asks_to_invent_case_study").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_template_source_fk",
    columns: [table.sourceTemplateId],
    foreignColumns: [table.id],
  }).onDelete("restrict"),
  index("content_template_system_idx").on(table.system, table.createdAt, table.id),
  index("content_template_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("content_template_state_check", sql`${table.system} in (0, 1)
    and ${table.factGate} in (0, 1)
    and ${table.publicLicenseGate} in (0, 1)
    and ${table.reviewGate} in (0, 1)
    and ${table.asksToInventCaseStudy} in (0, 1)
    and ${table.status} in ('draft', 'published', 'retired')
    and length(${table.id}) = 36
    and length(${table.name}) between 1 and 120
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40
    and (${table.brandId} is null or length(${table.brandId}) = 36)
    and (${table.ownerId} is null or length(${table.ownerId}) between 1 and 128)
    and (${table.sourceTemplateId} is null or length(${table.sourceTemplateId}) = 36)
    and (
      (${table.system} = 1 and ${table.brandId} is null and ${table.ownerId} is null and ${table.sourceTemplateId} is null)
      or (${table.system} = 0 and ${table.brandId} is not null and ${table.ownerId} is not null
        and ${table.sourceTemplateId} is not null
        and ${table.factGate} = 1 and ${table.publicLicenseGate} = 1 and ${table.reviewGate} = 1)
    )`),
]);
