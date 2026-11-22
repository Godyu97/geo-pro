import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { factGaps } from "../brand-facts/rules.ts";
import { withEligibleFacts } from "../brand-facts/service.ts";
import { BrandDao } from "../brands/dao.ts";
import { approveContent } from "../content/commands.ts";
import { computeApprovalFingerprint } from "../content/package.ts";
import { ContentDao } from "../content/dao.ts";
import type {
  ApprovalDecision,
  ApprovalDutyView,
  ApprovalPolicyList,
  ApprovalPolicyView,
  DecideApprovalInput,
  SaveApprovalPolicyInput,
} from "./contracts.ts";
import { ApprovalPolicyDao, type ApprovalContentGate, type ApprovalDutyRecord, type ApprovalPolicyRecord } from "./dao.ts";
import { approveSeparated } from "../team-access/rules.ts";

function clock() {
  return new Date().toISOString();
}

function toDuty(row: Pick<ApprovalDutyRecord, "userId" | "factApprover" | "contentApprover">): ApprovalDutyView {
  return {
    userId: row.userId,
    factApprover: row.factApprover === 1,
    contentApprover: row.contentApprover === 1,
  };
}

function toPolicy(brandId: string, policy: ApprovalPolicyRecord | undefined, duties: readonly ApprovalDutyRecord[]): ApprovalPolicyView {
  return {
    brandId,
    version: policy?.version ?? 0,
    dualControl: policy?.dualControl === 1,
    duties: duties.filter((duty) => duty.brandId === brandId).map(toDuty),
  };
}

function parseIds(json: string) {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function claimsRecord(claimsJson: string) {
  const parsed: unknown = JSON.parse(claimsJson);
  if (Array.isArray(parsed)) {
    const record: Record<string, string> = {};
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const text = "text" in item && typeof item.text === "string" ? item.text : "";
      const factVersionId = "factVersionId" in item && typeof item.factVersionId === "string" ? item.factVersionId : "";
      if (text.trim() && factVersionId) record[text] = factVersionId;
    }
    return record;
  }
  if (parsed && typeof parsed === "object") {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") record[key] = value;
    }
    return record;
  }
  return {};
}

function versionFingerprint(version: ApprovalContentGate) {
  return computeApprovalFingerprint({
    title: version.title,
    bodyMarkdown: version.bodyMarkdown,
    claims: claimsRecord(version.claimsJson),
    imageAssetIds: parseIds(version.imageAssetIdsJson),
    targetChannel: version.targetChannel,
    labelingProfileVersion: version.labelingProfileVersion,
    labelingProfileStatus: version.labelingProfileStatus,
    factVersionIds: parseIds(version.factVersionIdsJson),
  });
}

function denied(reason: "separation" | "duty", versionId: string): ApprovalDecision {
  return { error: reason === "separation" ? "SEPARATION" : "DUTY", versionId, reason };
}

export async function listApprovalPolicies(db: QueryConnection, actorId: string): Promise<ApprovalPolicyList> {
  const dao = new ApprovalPolicyDao(db);
  const brandIds = await dao.ownedBrandIds(actorId);
  const [policies, duties] = await Promise.all([
    dao.policiesForBrands(brandIds),
    dao.dutiesForBrands(brandIds),
  ]);
  const byBrand = new Map(policies.map((policy) => [policy.brandId, policy]));
  return { policies: brandIds.map((brandId) => toPolicy(brandId, byBrand.get(brandId), duties)) };
}

export async function saveApprovalPolicy(
  db: DatabaseConnection,
  actorId: string,
  input: SaveApprovalPolicyInput,
  now = clock(),
): Promise<ApprovalPolicyView | { error: "NOT_FOUND" | "INVALID_INPUT" }> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    const dao = new ApprovalPolicyDao(tx);
    const brand = await dao.brandGate(input.brandId);
    if (!brand || brand.ownerId !== actorId || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" };
    if (!await dao.usersExist(input.duties.map((duty) => duty.userId))) return { error: "NOT_FOUND" };
    const saved = await dao.upsertPolicy({
      id: randomUUID(),
      brandId: input.brandId,
      dualControl: input.dualControl ? 1 : 0,
      updatedAt: now,
      updatedBy: actorId,
    });
    if (!saved) return { error: "INVALID_INPUT" };
    const duties = input.duties.map((duty) => ({
      id: randomUUID(),
      userId: duty.userId,
      factApprover: duty.factApprover ? 1 : 0,
      contentApprover: duty.contentApprover ? 1 : 0,
    })) as { id: string; userId: string; factApprover: 0 | 1; contentApprover: 0 | 1 }[];
    await dao.replaceDuties(input.brandId, duties, now);
    return {
      brandId: input.brandId,
      version: saved.version,
      dualControl: saved.dualControl === 1,
      duties: input.duties.map((duty) => ({
        userId: duty.userId,
        factApprover: duty.factApprover,
        contentApprover: duty.contentApprover,
      })),
    };
  });
}

async function recordDenial(
  db: DatabaseConnection,
  row: { brandId: string; versionId: string; kind: "fact" | "content"; reason: "separation" | "duty"; actorId: string; createdAt: string },
) {
  await db.transaction(async (tx) => {
    await new ApprovalPolicyDao(tx).insertAttempt({ id: randomUUID(), ...row });
  });
}

export async function decideApproval(
  db: DatabaseConnection,
  actorId: string,
  input: DecideApprovalInput,
  now = clock(),
): Promise<ApprovalDecision> {
  const dao = new ApprovalPolicyDao(db);
  const brand = await dao.brandGate(input.brandId);
  if (!brand || brand.status !== "active" || brand.frozenAt) return { error: "NOT_FOUND" };
  const isOwner = brand.ownerId === actorId;
  const [policy, duty] = await Promise.all([
    dao.policy(input.brandId),
    isOwner ? Promise.resolve(null) : dao.duty(input.brandId, actorId),
  ]);
  const dual = policy?.dualControl === 1;
  if (!isOwner && (!dual || !duty)) return { error: "NOT_FOUND" };
  if (!dual && input.kind === "content") {
    const approved = await approveContent(db, actorId, {
      action: "approve-content",
      brandId: input.brandId,
      versionId: input.versionId,
      operationId: randomUUID(),
    }, () => now);
    if ("error" in approved) {
      if (approved.error === "FACT_INVALID" || approved.error === "INVALID_INPUT" || approved.error === "OPERATION_CONFLICT") {
        return { error: approved.error };
      }
      return { error: "NOT_FOUND" };
    }
    return {
      kind: "content",
      versionId: approved.versionId,
      approvalId: approved.approvalId,
      status: "approved",
      replayed: approved.replayed,
    };
  }

  const actorFactApprover = isOwner || duty?.factApprover === 1;
  const actorContentApprover = isOwner || duty?.contentApprover === 1;
  if (input.kind === "content") return decideContent(db, actorId, input, now, brand.ownerId, actorFactApprover, actorContentApprover);
  return decideFact(db, actorId, input, now, brand.ownerId, actorFactApprover, actorContentApprover);
}

async function decideContent(
  db: DatabaseConnection,
  actorId: string,
  input: DecideApprovalInput,
  now: string,
  ownerId: string,
  actorFactApprover: boolean,
  actorContentApprover: boolean,
): Promise<ApprovalDecision> {
  const dao = new ApprovalPolicyDao(db);
  const version = await dao.contentVersion(input.brandId, input.versionId);
  if (!version) return { error: "NOT_FOUND" };
  const historical = await dao.hasApproval(version.id);
  const decision = approveSeparated({
    dualControl: true,
    kind: "content",
    authorId: version.ownerId,
    actorId,
    actorFactApprover,
    actorContentApprover,
    historicalSingleApproval: historical,
  });
  if (!decision.allowed) {
    await recordDenial(db, {
      brandId: input.brandId, versionId: version.id, kind: "content", reason: decision.reason, actorId, createdAt: now,
    });
    return denied(decision.reason, version.id);
  }
  if (version.status === "approved") {
    const existing = await dao.matchingApproval(version.id, versionFingerprint(version));
    if (!existing) return { error: "INVALID_INPUT" };
    return { kind: "content", versionId: version.id, approvalId: existing.id, status: "approved", replayed: true };
  }
  if (version.status !== "in_review") return { error: "INVALID_INPUT" };
  const factVersionIds = parseIds(version.factVersionIdsJson);
  if (factVersionIds.length === 0) return { error: "FACT_INVALID" };

  const gate = await withEligibleFacts(
    db,
    { ownerId, brandId: input.brandId },
    { factVersionIds, contentVersionId: version.id, stage: "review" },
    async (tx) => writeContentApproval(tx, actorId, input.brandId, version.id, ownerId, now),
    () => new Date(now),
  );
  if ("error" in gate) {
    if (gate.error === "factInvalid") return { error: "FACT_INVALID" };
    if (gate.error === "conflict") return { error: "OPERATION_CONFLICT" };
    return { error: "NOT_FOUND" };
  }
  if (!gate.data || !("approvalId" in gate.data)) {
    if (gate.data && "denied" in gate.data && gate.data.denied) return denied(gate.data.denied, version.id);
    return { error: "INVALID_INPUT" };
  }
  return { kind: "content", versionId: version.id, approvalId: gate.data.approvalId, status: "approved", replayed: false };
}

async function writeContentApproval(
  tx: TransactionConnection,
  actorId: string,
  brandId: string,
  versionId: string,
  ownerId: string,
  now: string,
): Promise<{ approvalId: string } | { denied: "separation" | "duty" } | null> {
  const dao = new ApprovalPolicyDao(tx);
  const current = await dao.contentVersion(brandId, versionId);
  if (!current || current.status !== "in_review") return null;
  const policy = await dao.policy(brandId);
  if (!policy || policy.dualControl !== 1) return null;
  const duty = actorId === ownerId ? null : await dao.duty(brandId, actorId);
  const decision = approveSeparated({
    dualControl: true,
    kind: "content",
    authorId: current.ownerId,
    actorId,
    actorFactApprover: actorId === ownerId || duty?.factApprover === 1,
    actorContentApprover: actorId === ownerId || duty?.contentApprover === 1,
    historicalSingleApproval: await dao.hasApproval(current.id),
  });
  if (!decision.allowed) {
    await dao.insertAttempt({
      id: randomUUID(), brandId, versionId: current.id, kind: "content", reason: decision.reason, actorId, createdAt: now,
    });
    return { denied: decision.reason };
  }
  const fingerprint = versionFingerprint(current);
  const approvalId = randomUUID();
  const content = new ContentDao(tx);
  await content.insertApproval({
    id: approvalId,
    brandId,
    ownerId,
    contentVersionId: current.id,
    contentFingerprint: fingerprint,
    factVersionIdsJson: current.factVersionIdsJson,
    decision: "approved",
    actorId,
    createdAt: now,
  });
  await content.updateContentVersionStatus(current.id, "approved", now);
  await content.markPackagesDoNotReuse(ownerId, current.id, fingerprint);
  return { approvalId };
}

async function decideFact(
  db: DatabaseConnection,
  actorId: string,
  input: DecideApprovalInput,
  now: string,
  ownerId: string,
  actorFactApprover: boolean,
  actorContentApprover: boolean,
): Promise<ApprovalDecision> {
  const dao = new ApprovalPolicyDao(db);
  const fact = await dao.factVersion(input.brandId, input.versionId);
  if (!fact) return { error: "NOT_FOUND" };
  const policy = await dao.policy(input.brandId);
  const decision = approveSeparated({
    dualControl: policy?.dualControl === 1,
    kind: "fact",
    authorId: ownerId,
    actorId,
    actorFactApprover,
    actorContentApprover,
    historicalSingleApproval: fact.state === "approved",
  });
  if (!decision.allowed) {
    await recordDenial(db, {
      brandId: input.brandId, versionId: fact.id, kind: "fact", reason: decision.reason, actorId, createdAt: now,
    });
    return denied(decision.reason, fact.id);
  }
  if (fact.state === "approved") {
    return { kind: "fact", versionId: fact.id, status: "approved", replayed: true };
  }
  if (fact.state !== "pending_confirmation") return { error: "INVALID_INPUT" };
  return db.transaction(async (tx) => {
    const locked = new ApprovalPolicyDao(tx);
    const fields = await locked.factFields(input.brandId, fact.id);
    if (!fields || factGaps(fields, now.slice(0, 10)).length > 0) return { error: "INVALID_INPUT" as const };
    const current = await locked.factVersion(input.brandId, fact.id);
    if (current?.state === "approved") return { kind: "fact" as const, versionId: fact.id, status: "approved" as const, replayed: true };
    if (!current || current.state !== "pending_confirmation") return { error: "INVALID_INPUT" as const };
    const confirmed = await locked.confirmFact(input.brandId, fact.id, ownerId, actorId, now);
    if (!confirmed) return { error: "INVALID_INPUT" as const };
    return { kind: "fact" as const, versionId: fact.id, status: "approved" as const, replayed: false };
  });
}
