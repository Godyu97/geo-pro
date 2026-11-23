import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { brand } from "./brand-schema";

// One consultation per event key. Both import sources stay on connector_event_source.
// count is always 1. conflict is 1 when payload digests differ.
// No customer body, recommendation, or inclusion flag is stored.
export const connectorEvent = pgTable("connector_event", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  count: integer("count").notNull(),
  conflict: integer("conflict").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("connector_event_key_uidx").on(table.ownerId, table.brandId, table.eventKey),
  index("connector_event_owner_idx").on(table.ownerId, table.createdAt, table.id),
  check("connector_event_state_check", sql`${table.count} = 1
    and ${table.conflict} in (0, 1)
    and ${table.eventKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    and length(${table.id}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const connectorEventSource = pgTable("connector_event_source", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "connector_event_source_event_fk",
    columns: [table.eventId],
    foreignColumns: [connectorEvent.id],
  }).onDelete("cascade"),
  uniqueIndex("connector_event_source_event_uidx").on(table.eventId, table.source),
  index("connector_event_source_owner_idx").on(table.ownerId, table.eventId, table.source),
  check("connector_event_source_state_check", sql`${table.source} in ('csv', 'connector')
    and ${table.payloadDigest} ~ '^[a-f0-9]{64}$'
    and length(${table.id}) = 36
    and length(${table.eventId}) = 36
    and length(${table.brandId}) = 36
    and length(${table.ownerId}) between 1 and 128
    and length(${table.createdAt}) between 20 and 40`),
]);
