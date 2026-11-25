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

export type ValidityRule = {
  version: number;
  frozen: boolean;
  requiresRealNeed: boolean;
  requiresIndustry: boolean;
  requiresFollowUp: boolean;
};

export function reviseValidity(rule: ValidityRule): ValidityRule {
  return { ...rule, version: rule.version + 1, frozen: false };
}

export function qualifyLead(rule: ValidityRule, lead: { realNeed: boolean; targetIndustry: boolean; followUp: boolean }) {
  if (!rule.frozen) return { status: "unfrozen" as const, ruleVersion: rule.version };
  const qualified = (!rule.requiresRealNeed || lead.realNeed)
    && (!rule.requiresIndustry || lead.targetIndustry)
    && (!rule.requiresFollowUp || lead.followUp);
  return { status: qualified ? "qualified" as const : "disqualified" as const, ruleVersion: rule.version };
}

export function businessLayer(input: { raw: number; qualified: number; won: number }) {
  return { raw: input.raw, qualified: input.qualified, won: input.won };
}

/** Identified referrals use a session denominator. Self-reported leads are not divided by all site visits. */
export function aiReferralConversion(input: {
  identifiedReferrals: number;
  sessionDenominator: number | null;
  selfReported: number;
}) {
  return {
    identified: conversionRate({ numerator: input.identifiedReferrals, denominator: input.sessionDenominator }),
    selfReported: input.selfReported,
    selfReportedOverVisits: null,
  };
}

/** Same-event evidence that loses to a higher exclusive primary is an upgrade, not a second inquiry. */
export function leadPrimaryUpgrades(leads: readonly {
  eventId: string;
  evidence: readonly LeadEvidence[];
  primary: LeadEvidence;
}[]) {
  return leads.flatMap((lead) => {
    let from: LeadEvidence | null = null;
    for (const item of lead.evidence) {
      if (rank[item] >= rank[lead.primary]) continue;
      if (from === null || rank[item] > rank[from]) from = item;
    }
    return from === null ? [] : [{ eventId: lead.eventId, from, to: lead.primary }];
  });
}
