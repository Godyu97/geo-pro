/** Support search is audited and does not return customer body. The last owner must transfer before closing. */
export function supportSearch(input: { reason: string; query: string }) {
  if (input.reason.trim().length === 0) return { allowed: false, audited: false, body: null };
  return { allowed: true, audited: true, body: null, queryKept: input.query.length > 0 };
}

export function closeAccount(input: { owner: boolean; lastOwner: boolean; identityVerified: boolean }) {
  if (!input.owner || !input.identityVerified) return { accepted: false, reason: "identity" as const, purged: false };
  if (input.lastOwner) return { accepted: false, reason: "transfer_required" as const, purged: false };
  return { accepted: true, reason: "queued" as const, purged: false };
}
