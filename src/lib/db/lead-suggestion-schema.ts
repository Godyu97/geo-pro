import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// Draft questions stay out of prompt_set. The summary is hashed and not stored,
// so a phone number or the customer's original wording cannot be read back.
export const leadQuestionSuggestion = pgTable("lead_question_suggestion", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  summaryHash: text("summary_hash").notNull(),
  status: text("status").notNull(),
  modelName: text("model_name").notNull(),
  suggestionJson: text("suggestion_json").notNull(),
  injectionIgnored: integer("injection_ignored").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("lead_question_suggestion_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("lead_question_suggestion_state_check", sql`${table.status} in ('draft', 'accepted', 'discarded')
    and ${table.injectionIgnored} in (0, 1)
    and length(${table.summaryHash}) = 64
    and length(${table.modelName}) between 1 and 128
    and length(${table.suggestionJson}) between 20 and 2000
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
