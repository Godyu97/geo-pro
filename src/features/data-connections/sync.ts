export type SyncSource = "csv" | "connector";

/** The same event key from two sources stays one lead and keeps both source labels. */
export function syncEvents(rows: readonly { eventId: string; source: SyncSource }[]) {
  const grouped = new Map<string, SyncSource[]>();
  for (const row of rows) {
    const list = grouped.get(row.eventId) ?? [];
    if (!list.includes(row.source)) list.push(row.source);
    grouped.set(row.eventId, list);
  }
  return [...grouped.entries()].map(([eventId, sources]) => ({ eventId, count: 1, sources }));
}

export function previewSync(input: { approved: boolean; fieldNames: readonly string[] }) {
  if (!input.approved) return { pull: false, fields: [...input.fieldNames] };
  return { pull: true, fields: [...input.fieldNames] };
}
