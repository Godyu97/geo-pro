import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";
import { brandFactVersion } from "./brand-fact-schema";

// One check of an infographic or voiceover against an approved fact.
// A mismatch or a customer-proof claim blocks delivery and does not open a package.
export const mediaReview = pgTable("media_review", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  shownValue: text("shown_value").notNull(),
  approvedValue: text("approved_value").notNull(),
  factVersionId: text("fact_version_id").notNull(),
  reason: text("reason").notNull(),
  deliver: integer("deliver").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [
  foreignKey({
    name: "media_review_fact_fk",
    columns: [table.brandId, table.factVersionId],
    foreignColumns: [brandFactVersion.brandId, brandFactVersion.id],
  }).onDelete("cascade"),
  index("media_review_owner_idx").on(table.ownerId, table.recordedAt, table.id),
  index("media_review_owner_brand_idx").on(table.ownerId, table.brandId, table.recordedAt, table.id),
  check("media_review_state_check", sql`${table.deliver} in (0, 1)
    and ${table.kind} in ('image', 'script')
    and ${table.reason} in ('ok', 'fact_mismatch', 'not_proof')
    and (
      (${table.reason} = 'ok' and ${table.deliver} = 1 and ${table.shownValue} = ${table.approvedValue})
      or (${table.reason} = 'fact_mismatch' and ${table.deliver} = 0 and ${table.shownValue} <> ${table.approvedValue})
      or (${table.reason} = 'not_proof' and ${table.deliver} = 0)
    )
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.factVersionId}) = 36
    and length(${table.shownValue}) between 1 and 4000
    and length(${table.approvedValue}) between 1 and 4000
    and length(${table.recordedAt}) between 20 and 40`),
]);
