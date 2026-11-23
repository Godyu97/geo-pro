import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { ConnectorEventList, ConnectorEventView, ImportConnectorEventsInput } from "./event-contracts.ts";
import { ConnectorEventDao, type ConnectorEventInsert, type ConnectorEventRecord, type ConnectorEventSourceInsert } from "./event-dao.ts";
import { planConnectorEvents } from "./event-plan.ts";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function toView(row: ConnectorEventRecord): ConnectorEventView {
  if (row.count !== 1) throw new Error("connector-event-count");
  return {
    id: row.id,
    brandId: row.brandId,
    eventKey: row.eventKey,
    count: row.count,
    conflict: row.conflict === 1,
    sources: row.sources.map((source) => ({ source: source.source, payloadDigest: source.payloadDigest })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function viewsFor(dao: ConnectorEventDao, ownerId: string, eventIds: readonly string[]) {
  const events = await dao.eventsByIds(ownerId, eventIds);
  return (await dao.withSources(ownerId, events)).map(toView);
}

export async function listConnectorEvents(db: DatabaseConnection, ownerId: string): Promise<ConnectorEventList> {
  return db.transaction(async (tx) => {
    const dao = new ConnectorEventDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const events = await dao.eventsForOwner(ownerId);
    const stored = await dao.withSources(ownerId, events);
    return { brands, events: stored.map(toView) };
  });
}

export async function readConnectorEvent(db: DatabaseConnection, ownerId: string, eventId: string) {
  return db.transaction(async (tx) => {
    const dao = new ConnectorEventDao(tx);
    const [event] = await dao.eventsByIds(ownerId, [eventId]);
    if (!event) return { error: "NOT_FOUND" as const };
    const [stored] = await dao.withSources(ownerId, [event]);
    if (!stored) return { error: "NOT_FOUND" as const };
    return { event: toView(stored) };
  });
}

export async function importConnectorEvents(
  db: DatabaseConnection,
  ownerId: string,
  input: ImportConnectorEventsInput,
  clock: Clock = systemClock,
): Promise<{ events: ConnectorEventView[] } | { error: "NOT_FOUND" }> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const planned = planConnectorEvents(input.rows);
    const dao = new ConnectorEventDao(tx);
    const existing = await dao.eventsByKeys(ownerId, input.brandId, planned.map((event) => event.eventKey), true);
    const existingByKey = new Map(existing.map((event) => [event.eventKey, event]));
    const now = clock();
    const eventInserts: ConnectorEventInsert[] = [];
    const sourceInserts: ConnectorEventSourceInsert[] = [];
    const conflicts: string[] = [];
    const touched: string[] = [];

    for (const event of planned) {
      const found = existingByKey.get(event.eventKey);
      if (!found) {
        const id = randomUUID();
        touched.push(id);
        eventInserts.push({
          id,
          brandId: input.brandId,
          ownerId,
          eventKey: event.eventKey,
          count: event.count,
          conflict: event.conflict ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        });
        for (const source of event.sources) {
          sourceInserts.push({
            id: randomUUID(),
            eventId: id,
            brandId: input.brandId,
            ownerId,
            source: source.source,
            payloadDigest: source.payloadDigest,
            createdAt: now,
          });
        }
        continue;
      }
      touched.push(found.id);
      const stored = new Map(found.sources.map((source) => [source.source, source.payloadDigest]));
      let conflict = found.conflict === 1 || event.conflict;
      for (const source of event.sources) {
        const previous = stored.get(source.source);
        if (previous === undefined) {
          stored.set(source.source, source.payloadDigest);
          sourceInserts.push({
            id: randomUUID(),
            eventId: found.id,
            brandId: input.brandId,
            ownerId,
            source: source.source,
            payloadDigest: source.payloadDigest,
            createdAt: now,
          });
        } else if (previous !== source.payloadDigest) conflict = true;
      }
      if (new Set(stored.values()).size > 1) conflict = true;
      if (conflict && found.conflict === 0) conflicts.push(found.id);
    }

    await dao.insertEvents(eventInserts);
    await dao.insertSources(sourceInserts);
    await dao.markConflicts(ownerId, conflicts, now);
    return { events: await viewsFor(dao, ownerId, touched) };
  });
}
