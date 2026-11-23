import { createHash } from "node:crypto";

export type Variant = { id: string; channel: string; approved: boolean; body: string };

export type VariantRejectionCode =
  | "master_unapproved"
  | "body_diverged"
  | "variant_unapproved"
  | "channel_blocked";

export function variantNeedsOwnApproval(masterApproved: boolean, variant: Variant, masterBody: string) {
  if (!masterApproved) return true;
  return variant.body !== masterBody || !variant.approved;
}

/** Body text never grants approval. "沿用主稿批准" is ordinary copy, not a bypass. */
export function variantRejection(input: {
  masterApproved: boolean;
  variant: Variant;
  masterBody: string;
  blocked: boolean;
}): VariantRejectionCode | null {
  if (input.blocked) return "channel_blocked";
  if (!variantNeedsOwnApproval(input.masterApproved, input.variant, input.masterBody)) return null;
  if (!input.masterApproved) return "master_unapproved";
  if (input.variant.body !== input.masterBody) return "body_diverged";
  return "variant_unapproved";
}

export function channelVariantFingerprint(channel: string, body: string) {
  return createHash("sha256").update(JSON.stringify({ channel, body }), "utf8").digest("hex");
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

/** Code points, so a single emoji counts as one character. A null ceiling applies no limit. */
export function characterCount(text: string) {
  return Array.from(text).length;
}

export function exceedsPinnedCharacterLimit(body: string, maxCharacters: number | null) {
  if (maxCharacters == null) return false;
  return characterCount(body) > maxCharacters;
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
