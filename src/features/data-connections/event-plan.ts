import type { SyncSource } from "./sync.ts";
import { syncEvents } from "./sync.ts";

export type PlannedConnectorSource = {
  source: SyncSource;
  payloadDigest: string;
};

export type PlannedConnectorEvent = {
  eventKey: string;
  count: 1;
  conflict: boolean;
  sources: PlannedConnectorSource[];
};

/** Collapse fixture rows with syncEvents, then compare payload digests for the same event key. */
export function planConnectorEvents(rows: readonly { eventKey: string; source: SyncSource; payloadDigest: string }[]): PlannedConnectorEvent[] {
  const synced = syncEvents(rows.map((row) => ({ eventId: row.eventKey, source: row.source })));
  const digests = new Map<string, Map<SyncSource, string[]>>();
  for (const row of rows) {
    const bySource = digests.get(row.eventKey) ?? new Map<SyncSource, string[]>();
    const values = bySource.get(row.source) ?? [];
    values.push(row.payloadDigest);
    bySource.set(row.source, values);
    digests.set(row.eventKey, bySource);
  }
  return synced.map((event) => {
    if (event.count !== 1) throw new Error("connector-event-count");
    const bySource = digests.get(event.eventId) ?? new Map<SyncSource, string[]>();
    const distinct = new Set<string>();
    const sources = event.sources.map((source) => {
      const values = bySource.get(source) ?? [];
      for (const value of values) distinct.add(value);
      const payloadDigest = values[0];
      if (!payloadDigest) throw new Error("connector-event-source");
      return { source, payloadDigest };
    });
    return { eventKey: event.eventId, count: event.count, conflict: distinct.size > 1, sources };
  });
}
