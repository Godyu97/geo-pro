import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  connectorEventKeySchema,
  connectorEventListLimit,
  connectorEventSources,
  payloadDigestSchema,
  type ConnectorEventSourceName,
} from "./event-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const timestampSchema = z.iso.datetime({ precision: 3 });
const sourceSchema = z.enum(connectorEventSources);

const eventRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  eventKey: connectorEventKeySchema,
  count: z.literal(1),
  conflict: flag,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const sourceRow = z.object({
  eventId: brandIdSchema,
  source: sourceSchema,
  payloadDigest: payloadDigestSchema,
});

const joinedRow = eventRow.extend({
  source: sourceSchema.nullable(),
  payloadDigest: payloadDigestSchema.nullable(),
});

export type ConnectorEventRecord = z.infer<typeof eventRow> & {
  sources: { source: ConnectorEventSourceName; payloadDigest: string }[];
};

export type ConnectorEventInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  eventKey: string;
  count: 1;
  conflict: 0 | 1;
  createdAt: string;
  updatedAt: string;
};

export type ConnectorEventSourceInsert = {
  id: string;
  eventId: string;
  brandId: string;
  ownerId: string;
  source: ConnectorEventSourceName;
  payloadDigest: string;
  createdAt: string;
};

const eventColumns = `id, brand_id AS "brandId", event_key AS "eventKey", count, conflict,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

function attachSources(
  events: readonly z.infer<typeof eventRow>[],
  sources: readonly z.infer<typeof sourceRow>[],
): ConnectorEventRecord[] {
  const grouped = new Map<string, z.infer<typeof sourceRow>[]>();
  for (const source of sources) {
    const list = grouped.get(source.eventId) ?? [];
    list.push(source);
    grouped.set(source.eventId, list);
  }
  return events.map((event) => {
    const ordered = [...(grouped.get(event.id) ?? [])].sort((left, right) => left.source.localeCompare(right.source));
    if (ordered.length > connectorEventSources.length || new Set(ordered.map((row) => row.source)).size !== ordered.length) {
      throw new Error("connector-event-sources");
    }
    return { ...event, sources: ordered.map((row) => ({ source: row.source, payloadDigest: row.payloadDigest })) };
  });
}

function attachJoined(rows: readonly z.infer<typeof joinedRow>[]): ConnectorEventRecord[] {
  const grouped = new Map<string, ConnectorEventRecord>();
  for (const row of rows) {
    const current = grouped.get(row.id) ?? {
      id: row.id,
      brandId: row.brandId,
      eventKey: row.eventKey,
      count: row.count,
      conflict: row.conflict,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sources: [],
    };
    if (row.source && row.payloadDigest) {
      current.sources.push({ source: row.source, payloadDigest: row.payloadDigest });
    }
    grouped.set(row.id, current);
  }
  return [...grouped.values()].map((event) => {
    const sources = [...event.sources].sort((left, right) => left.source.localeCompare(right.source));
    if (sources.length > connectorEventSources.length || new Set(sources.map((row) => row.source)).size !== sources.length) {
      throw new Error("connector-event-sources");
    }
    return { ...event, sources };
  });
}

export function connectorEventsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${eventColumns} FROM connector_event
      WHERE owner_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, connectorEventListLimit] as QueryValue[],
  };
}

export function connectorEventSourcesQuery(ownerId: string, eventIds: readonly string[]) {
  if (eventIds.length === 0) {
    return {
      sql: `SELECT event_id AS "eventId", source, payload_digest AS "payloadDigest"
        FROM connector_event_source
        WHERE owner_id = ? AND 1 = 0
        LIMIT ?`,
      values: [ownerId, connectorEventListLimit * connectorEventSources.length] as QueryValue[],
    };
  }
  return {
    sql: `SELECT event_id AS "eventId", source, payload_digest AS "payloadDigest"
      FROM connector_event_source
      WHERE owner_id = ? AND event_id IN (${eventIds.map(() => "?").join(", ")})
      ORDER BY event_id ASC, source ASC
      LIMIT ?`,
    values: [ownerId, ...eventIds, connectorEventListLimit * connectorEventSources.length] as QueryValue[],
  };
}

export function connectorEventsByKeysQuery(ownerId: string, brandId: string, eventKeys: readonly string[]) {
  return {
    sql: `SELECT e.id AS "id", e.brand_id AS "brandId", e.event_key AS "eventKey", e.count AS "count",
        e.conflict AS "conflict", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
        s.source AS "source", s.payload_digest AS "payloadDigest"
      FROM connector_event e
      LEFT JOIN connector_event_source s ON s.event_id = e.id AND s.owner_id = e.owner_id
      WHERE e.owner_id = ? AND e.brand_id = ? AND e.event_key IN (${eventKeys.map(() => "?").join(", ")})
      ORDER BY e.event_key ASC, s.source ASC`,
    values: [ownerId, brandId, ...eventKeys] as QueryValue[],
  };
}

export class ConnectorEventDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id FROM brand
        WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [ownerId, 20],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async eventsForOwner(ownerId: string) {
    const query = connectorEventsForOwnerQuery(ownerId);
    return z.array(eventRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async sourcesFor(ownerId: string, eventIds: readonly string[]) {
    const query = connectorEventSourcesQuery(ownerId, eventIds);
    return z.array(sourceRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async eventsByIds(ownerId: string, eventIds: readonly string[]) {
    if (eventIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${eventColumns} FROM connector_event
        WHERE owner_id = ? AND id IN (${eventIds.map(() => "?").join(", ")})
        LIMIT ?`,
      [ownerId, ...eventIds, eventIds.length],
    );
    const parsed = z.array(eventRow).parse(rows);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return eventIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async eventsByKeys(ownerId: string, brandId: string, eventKeys: readonly string[], lock: boolean) {
    if (eventKeys.length === 0) return [];
    const query = connectorEventsByKeysQuery(ownerId, brandId, eventKeys);
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE OF e" : "";
    const rows = z.array(joinedRow).parse(await queryWithParameters(this.db, query.sql + clause, query.values));
    return attachJoined(rows);
  }

  async withSources(ownerId: string, events: readonly z.infer<typeof eventRow>[]) {
    if (events.length === 0) return [];
    return attachSources(events, await this.sourcesFor(ownerId, events.map((event) => event.id)));
  }

  async insertEvents(rows: readonly ConnectorEventInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO connector_event (
        id, brand_id, owner_id, event_key, count, conflict, created_at, updated_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [
        row.id, row.brandId, row.ownerId, row.eventKey, row.count, row.conflict, row.createdAt, row.updatedAt,
      ]),
    );
  }

  async insertSources(rows: readonly ConnectorEventSourceInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO connector_event_source (
        id, event_id, brand_id, owner_id, source, payload_digest, created_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [
        row.id, row.eventId, row.brandId, row.ownerId, row.source, row.payloadDigest, row.createdAt,
      ]),
    );
  }

  async sourcesByBrand(ownerId: string, brandIds: readonly string[]) {
    if (brandIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT DISTINCT e.brand_id AS "brandId", s.source AS "source"
       FROM connector_event e
       INNER JOIN connector_event_source s ON s.event_id = e.id AND s.owner_id = e.owner_id
       WHERE e.owner_id = ? AND e.brand_id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY e.brand_id ASC, s.source ASC
       LIMIT ?`,
      [ownerId, ...brandIds, brandIds.length * connectorEventSources.length],
    );
    return z.array(z.object({ brandId: brandIdSchema, source: sourceSchema })).parse(rows);
  }

  async sourcesForEvents(ownerId: string, brandId: string, eventKeys: readonly string[]) {
    if (eventKeys.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT e.event_key AS "eventId", s.source AS "source"
       FROM connector_event e
       INNER JOIN connector_event_source s ON s.event_id = e.id AND s.owner_id = e.owner_id
       WHERE e.owner_id = ? AND e.brand_id = ? AND e.event_key IN (${eventKeys.map(() => "?").join(", ")})
       ORDER BY e.event_key ASC, s.source ASC
       LIMIT ?`,
      [ownerId, brandId, ...eventKeys, eventKeys.length * connectorEventSources.length],
    );
    return z.array(z.object({ eventId: connectorEventKeySchema, source: sourceSchema })).parse(rows);
  }

  async markConflicts(ownerId: string, eventIds: readonly string[], updatedAt: string) {
    if (eventIds.length === 0) return;
    await queryWithParameters(
      this.db,
      `UPDATE connector_event SET conflict = 1, updated_at = ?
        WHERE owner_id = ? AND conflict = 0 AND count = 1 AND id IN (${eventIds.map(() => "?").join(", ")})`,
      [updatedAt, ownerId, ...eventIds],
    );
  }
}
