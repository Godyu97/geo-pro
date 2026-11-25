import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import { approveSeparated } from "../team-access/rules.ts";
import type { ApprovalKind } from "./contracts.ts";
import { ApprovalPolicyDao } from "./dao.ts";

export type ApprovalScope = {
  brandOwnerId: string;
  dual: boolean;
  actorIsOwner: boolean;
  matchingDuty: boolean;
};

export async function openApprovalScope(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  kind: ApprovalKind,
): Promise<ApprovalScope | { error: "NOT_FOUND" }> {
  const dao = new ApprovalPolicyDao(db);
  const brand = await dao.brandGate(brandId);
  if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" };
  const policy = await dao.policy(brandId);
  const dual = policy?.dualControl === 1;
  if (brand.ownerId === actorId) {
    return { brandOwnerId: brand.ownerId, dual, actorIsOwner: true, matchingDuty: true };
  }
  if (!dual) return { error: "NOT_FOUND" };
  const duty = await dao.duty(brandId, actorId);
  if (!duty) return { error: "NOT_FOUND" };
  const matchingDuty = kind === "fact" ? duty.factApprover === 1 : duty.contentApprover === 1;
  return { brandOwnerId: brand.ownerId, dual: true, actorIsOwner: false, matchingDuty };
}

export async function delegatedOwnerId(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  kind: ApprovalKind,
) {
  const scope = await openApprovalScope(db, actorId, brandId, kind);
  if ("error" in scope || scope.actorIsOwner || !scope.matchingDuty) return null;
  return scope.brandOwnerId;
}

export async function rejectIfSeparated(
  db: QueryConnection,
  input: {
    scope: ApprovalScope;
    brandId: string;
    versionId: string;
    kind: ApprovalKind;
    authorId: string;
    actorId: string;
    now: string;
  },
): Promise<{ ok: true } | { ok: false; error: "SEPARATION" | "DUTY" }> {
  if (!input.scope.dual) return { ok: true };
  const decision = approveSeparated({
    dualControl: true,
    kind: input.kind,
    authorId: input.authorId,
    actorId: input.actorId,
    actorFactApprover: input.scope.actorIsOwner || (input.kind === "fact" && input.scope.matchingDuty),
    actorContentApprover: input.scope.actorIsOwner || (input.kind === "content" && input.scope.matchingDuty),
    historicalSingleApproval: false,
  });
  if (decision.allowed) return { ok: true };
  await new ApprovalPolicyDao(db).insertAttempt({
    id: randomUUID(),
    brandId: input.brandId,
    versionId: input.versionId,
    kind: input.kind,
    reason: decision.reason,
    actorId: input.actorId,
    createdAt: input.now,
  });
  return { ok: false, error: decision.reason === "separation" ? "SEPARATION" : "DUTY" };
}
