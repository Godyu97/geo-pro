/** An agency membership does not replace a brand grant. Expired grants stop queued actions. */
export function agencyAccess(input: {
  agencyMember: boolean;
  grantActive: boolean;
  queued: boolean;
}) {
  if (!input.grantActive) return { allowed: false, runQueued: false, reason: "grant" as const };
  if (!input.agencyMember) return { allowed: false, runQueued: false, reason: "membership" as const };
  return { allowed: true, runQueued: input.queued, reason: "ok" as const };
}

export function portfolioRow(input: { brandId: string; grantActive: boolean; evidenceIds: readonly string[] }) {
  if (!input.grantActive) return { brandId: input.brandId, summary: "blocked" as const, evidenceIds: [] as string[] };
  return { brandId: input.brandId, summary: "visible" as const, evidenceIds: [...input.evidenceIds] };
}
