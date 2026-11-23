import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// One local observation. The asked city and the sampled place stay in separate columns.
// ranked and claimed_local_users stay 0: an unknown sample is not a local ranking.
export const localObservation = pgTable("local_observation", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  targetCity: text("target_city").notNull(),
  sampledCity: text("sampled_city"),
  ranked: integer("ranked").notNull(),
  claimedLocalUsers: integer("claimed_local_users").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [
  index("local_observation_owner_idx").on(table.ownerId, table.recordedAt, table.id),
  check("local_observation_state_check", sql`${table.ranked} = 0
    and ${table.claimedLocalUsers} = 0
    and length(${table.targetCity}) between 1 and 80
    and (${table.sampledCity} is null or length(${table.sampledCity}) between 1 and 80)
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.recordedAt}) between 20 and 40`),
]);
