import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.sqlite";
import { brand } from "./brand-schema.sqlite";

// One observed crawler visit. Identity is unverified until an explicit mark exists.
// called_included stays 0. Raw user-agent is not stored.
export const crawlerObservation = sqliteTable("crawler_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  identity: text("identity").notNull(),
  citations: integer("citations").notNull(),
  calledIncluded: integer("called_included").notNull(),
  observedAt: text("observed_at").notNull(),
}, (table) => [
  index("crawler_observation_owner_idx").on(table.ownerId, table.observedAt, table.id),
  check("crawler_observation_state_check", sql`${table.identity} in ('unverified', 'verified')
    and ${table.citations} between 0 and 1000000000
    and ${table.calledIncluded} = 0
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.observedAt}) between 20 and 40`),
]);
