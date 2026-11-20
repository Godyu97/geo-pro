export type Variant = { id: string; channel: string; approved: boolean; body: string };

export function variantNeedsOwnApproval(masterApproved: boolean, variant: Variant, masterBody: string) {
  if (!masterApproved) return true;
  return variant.body !== masterBody || !variant.approved;
}

export function maintenanceQueue(input: { factId: string; pageIds: readonly string[] }) {
  const pages = [...new Set(input.pageIds)];
  return { factId: input.factId, pages, taskCount: pages.length === 0 ? 0 : 1 };
}

export function calendarRow(input: { plannedOn: string | null; verifiedOn: string | null; blocked: boolean }) {
  return {
    plannedOn: input.plannedOn,
    verifiedOn: input.verifiedOn,
    published: Boolean(input.verifiedOn),
    blocked: input.blocked,
  };
}

/** A blocked channel stays blocked. Already verified channels are not rolled back. */
export function settleChannels(rows: readonly { channel: string; state: "verified" | "blocked" }[]) {
  return {
    verified: rows.filter((row) => row.state === "verified").map((row) => row.channel),
    blocked: rows.filter((row) => row.state === "blocked").map((row) => row.channel),
    rolledBack: [] as string[],
  };
}

export function exportPackage(input: { markdown: string; tables: readonly string[] }) {
  return { markdown: input.markdown, tables: [...input.tables], droppedTables: 0 };
}

/** One fact expiry lists every affected page and opens a single deduped maintenance task. */
export function impactSurface(input: {
  factId: string;
  pages: readonly { pageId: string; draftId: string; channel: string }[];
}) {
  const queue = maintenanceQueue({ factId: input.factId, pageIds: input.pages.map((page) => page.pageId) });
  return { factId: input.factId, pages: input.pages.map((page) => ({ ...page })), taskCount: queue.taskCount };
}

/** The planned date is not the live date. Retest due stays separate from public verification. */
export function calendarSchedule(input: {
  plannedOn: string | null;
  verifiedOn: string | null;
  retestDueOn: string | null;
  blocked: boolean;
}) {
  const row = calendarRow(input);
  return { ...row, retestDueOn: input.retestDueOn, liveOn: row.verifiedOn };
}
