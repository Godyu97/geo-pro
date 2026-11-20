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

export function leaveWorkspace(input: { actorIsLastOwner: boolean }) {
  if (input.actorIsLastOwner) return { allowed: false as const, reason: "transfer_required" as const };
  return { allowed: true as const, reason: "ok" as const };
}

export function invitePreview() {
  return { exposesPrivateBrandName: false as const };
}

export function canExport(input: { exportGrant: boolean }) {
  return input.exportGrant;
}

export function approveSeparated(input: {
  dualControl: boolean;
  kind: "fact" | "content";
  authorId: string;
  actorId: string;
  actorFactApprover: boolean;
  actorContentApprover: boolean;
  historicalSingleApproval: boolean;
}) {
  const allowedDuty = input.kind === "fact" ? input.actorFactApprover : input.actorContentApprover;
  if (!allowedDuty) {
    return { allowed: false as const, reason: "duty" as const, historicalUntouched: input.historicalSingleApproval };
  }
  if (input.dualControl && input.authorId === input.actorId) {
    return { allowed: false as const, reason: "separation" as const, historicalUntouched: input.historicalSingleApproval };
  }
  return { allowed: true as const, reason: "ok" as const, historicalUntouched: input.historicalSingleApproval };
}

export function batchExport(input: { grantedBrandIds: readonly string[]; requestedBrandIds: readonly string[] }) {
  const allowed = new Set(input.grantedBrandIds);
  const denied = input.requestedBrandIds.filter((brandId) => !allowed.has(brandId));
  if (denied.length > 0) return { allowed: false as const, denied, rows: [] as string[] };
  return { allowed: true as const, denied, rows: [...input.requestedBrandIds] };
}
