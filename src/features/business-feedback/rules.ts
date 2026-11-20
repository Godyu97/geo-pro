export type LeadEvidence = "referral" | "self_report" | "landing_page" | "unknown";

const rank: Record<LeadEvidence, number> = { referral: 4, self_report: 3, landing_page: 2, unknown: 1 };

export function dedupedLead(rows: readonly { eventId: string; evidence: LeadEvidence }[]) {
  const grouped = new Map<string, LeadEvidence[]>();
  for (const row of rows) {
    const list = grouped.get(row.eventId) ?? [];
    list.push(row.evidence);
    grouped.set(row.eventId, list);
  }
  return [...grouped.entries()].map(([eventId, evidence]) => ({
    eventId,
    count: 1,
    evidence,
    primary: evidence.reduce((best, item) => (rank[item] > rank[best] ? item : best)),
  }));
}

export function conversionRate(input: { numerator: number | null; denominator: number | null }) {
  if (input.numerator === null || input.denominator === null || input.denominator <= 0) {
    return { count: input.numerator, rate: null };
  }
  return { count: input.numerator, rate: input.numerator / input.denominator };
}

export function crawlerVisitIsNotAiInclusion(input: { crawlerVisits: number; answerCitations: number }) {
  return { visits: input.crawlerVisits, citations: input.answerCitations, calledIncluded: false };
}

/** Rows with a direct identifier or no event id are rejected. Accepted rows still dedupe by event id. */
export function previewLeadImport(rows: readonly {
  eventId: string | null;
  evidence: LeadEvidence;
  directIdentifier: boolean;
}[]) {
  const rejected: { index: number; reason: "missing_id" | "direct_pii" }[] = [];
  const accepted: { eventId: string; evidence: LeadEvidence }[] = [];
  rows.forEach((row, index) => {
    if (row.directIdentifier) {
      rejected.push({ index, reason: "direct_pii" });
      return;
    }
    if (row.eventId === null || row.eventId.trim().length === 0) {
      rejected.push({ index, reason: "missing_id" });
      return;
    }
    accepted.push({ eventId: row.eventId, evidence: row.evidence });
  });
  return { leads: dedupedLead(accepted), rejected };
}
