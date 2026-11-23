import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

// A draft industry question pack. covers_regulated is the only coverage flag.
// Drafting questions must not move status to available or open a prompt set.
export const industryPack = sqliteTable("industry_pack", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  coversRegulated: integer("covers_regulated").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("industry_pack_owner_idx").on(table.ownerId, table.createdAt, table.id),
  index("industry_pack_owner_brand_idx").on(table.ownerId, table.brandId, table.createdAt, table.id),
  check("industry_pack_state_check", sql`${table.coversRegulated} in (0, 1)
    and ${table.status} in ('draft', 'reviewed', 'available', 'retired')
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.scope}) between 1 and 400
    and length(${table.createdAt}) between 20 and 40`),
]);

// Generated questions stay draft. The body is the only stored model text.
export const industryPackQuestion = sqliteTable("industry_pack_question", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull().references(() => industryPack.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("industry_pack_question_pack_idx").on(table.packId, table.createdAt, table.id),
  check("industry_pack_question_state_check", sql`${table.status} = 'draft'
    and length(${table.id}) = 36
    and length(${table.packId}) = 36
    and length(${table.body}) between 1 and 500
    and length(${table.createdAt}) between 20 and 40`),
]);
