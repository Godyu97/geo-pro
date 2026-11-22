import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";

// A sheet freezes question ids. An attempt stores no account, password, cookie, or proxy.
// Captcha or login stays handoff and cannot be confirmed into complete evidence.
export const captureSheet = pgTable("capture_sheet", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  promptIdsJson: text("prompt_ids_json").notNull(),
  mode: text("mode").notNull(),
  assistedMinutes: integer("assisted_minutes"),
  manualMinutes: integer("manual_minutes"),
  citationsComplete: integer("citations_complete").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("capture_sheet_owner_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("capture_sheet_state_check", sql`${table.mode} in ('assisted', 'manual')
    and ${table.citationsComplete} in (0, 1)
    and (${table.assistedMinutes} is null or ${table.assistedMinutes} between 0 and 100000)
    and (${table.manualMinutes} is null or ${table.manualMinutes} between 0 and 100000)
    and length(${table.promptIdsJson}) between 40 and 8000
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const captureAttempt = pgTable("capture_attempt", {
  id: text("id").primaryKey(),
  sheetId: text("sheet_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  blockedBy: text("blocked_by"),
  citationCount: integer("citation_count").notNull(),
  status: text("status").notNull(),
  confirmed: integer("confirmed").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "capture_attempt_sheet_fk",
    columns: [table.sheetId],
    foreignColumns: [captureSheet.id],
  }).onDelete("cascade"),
  index("capture_attempt_sheet_idx").on(table.ownerId, table.sheetId, table.createdAt, table.id),
  check("capture_attempt_state_check", sql`${table.status} in ('handoff', 'partial', 'preview')
    and ${table.confirmed} in (0, 1)
    and ${table.citationCount} between 0 and 1000
    and (
      (${table.blockedBy} in ('captcha', 'login') and ${table.status} = 'handoff' and ${table.confirmed} = 0)
      or (${table.blockedBy} is null and ${table.citationCount} = 0 and ${table.status} = 'partial')
      or (${table.blockedBy} is null and ${table.citationCount} between 1 and 1000 and ${table.status} = 'preview')
    )
    and length(${table.id}) = 36
    and length(${table.sheetId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and (${table.blockedBy} is null or length(${table.blockedBy}) between 5 and 7)
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);
