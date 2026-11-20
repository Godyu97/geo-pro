/** A user-agent claim is not a verified crawler identity and is not an inclusion. */
export function classifyCrawler(input: { userAgentClaimsAi: boolean; identityVerified: boolean; answerCitations: number }) {
  return {
    identity: input.identityVerified ? "verified" as const : "unverified" as const,
    calledIncluded: false,
    citations: input.answerCitations,
  };
}

export function revokeSync(input: { revoked: boolean; retainedRows: number }) {
  return {
    pull: !input.revoked,
    retainedRows: input.retainedRows,
    historyDeleted: false,
  };
}
