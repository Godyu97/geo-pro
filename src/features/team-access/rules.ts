export function approveContent(input: {
  dualControl: boolean;
  authorId: string;
  actorId: string;
  actorCanApprove: boolean;
}) {
  if (!input.actorCanApprove) return { allowed: false, reason: "role" as const };
  if (input.dualControl && input.authorId === input.actorId) return { allowed: false, reason: "separation" as const };
  return { allowed: true, reason: "ok" as const };
}

export function revokedAction(input: { queued: boolean; grantRevoked: boolean }) {
  if (input.queued && input.grantRevoked) return { run: false, download: false };
  return { run: input.queued, download: !input.grantRevoked };
}

export function brandVisible(grants: readonly { brandId: string; active: boolean }[], brandId: string) {
  return grants.some((grant) => grant.brandId === brandId && grant.active);
}
