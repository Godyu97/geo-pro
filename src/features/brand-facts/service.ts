import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { delegatedOwnerId, openApprovalScope, rejectIfSeparated } from "../approval-policy/enforce.ts";
import { activeSourceFragmentIds, readActiveSourceFragment } from "../asset-reuse/dao.ts";
import { BrandDao } from "../brands/dao.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import {
  factCommand, factIdsSchema, factScope, factStage,
  type FactCommand, type FactCursor, type FactFields, type FactScope, type FactVersion,
} from "./contracts.ts";
import { FactDao, pageSize } from "./dao.ts";
import { ContentDao } from "../content/dao.ts";
import { ContentMaintenanceAbort, openRevokedFactMaintenance } from "../content/maintenance.ts";
import { dependencyEffect, emptyFields, factGaps, factStatus } from "./rules.ts";

const clockNow = () => new Date();
const fail = <T extends string>(error: T) => ({ error });
const done = (id: string) => ({ id });

type WorkspaceQuery = {
  fact?: string; paste?: string;
  after?: FactCursor; pasteAfter?: FactCursor; impactAfter?: string;
};

function page<T extends { id: string; createdAt: string }>(items: T[]) {
  const last = items[pageSize - 1];
  return { items: items.slice(0, pageSize), next: items.length > pageSize ? { id: last.id, at: last.createdAt } : null };
}

export async function readFactWorkspace(db: QueryConnection, scope: FactScope, query: WorkspaceQuery, clock = clockNow) {
  let effective = scope;
  let readOnlyMember = false;
  let canReadOriginal = true;
  let brand = await new BrandDao(db).ownedSummary(scope.ownerId, scope.brandId);
  if (!brand) {
    const memberScope = await authorizeBrandActor(db, scope.ownerId, scope.brandId, "read", clock().toISOString());
    if (memberScope) {
      effective = { ownerId: memberScope.ownerId, brandId: scope.brandId };
      readOnlyMember = memberScope.role === "read_only";
      brand = await new BrandDao(db).ownedSummary(memberScope.ownerId, scope.brandId);
    } else {
      const delegated = await delegatedOwnerId(db, scope.ownerId, scope.brandId, "fact");
      if (!delegated) return null;
      canReadOriginal = false;
      effective = { ownerId: delegated, brandId: scope.brandId };
      brand = await new BrandDao(db).ownedSummary(delegated, scope.brandId);
    }
    if (!brand) return null;
  }
  const dao = new FactDao(db, effective);
  const [versions, pastes, fact, paste, impacts, successor] = await Promise.all([
    dao.versions(query.after), dao.pastes(query.pasteAfter),
    query.fact ? dao.version(query.fact) : null,
    query.paste ? dao.paste(query.paste) : null,
    query.fact ? dao.impact(query.fact, query.impactAfter) : [],
    query.paste ? dao.pasteSuccessor(query.paste) : null,
  ]);
  if ((query.fact && !fact) || (query.paste && !paste)) return null;
  const [latest, prior, originalFragment] = fact ? await Promise.all([
    dao.latest(fact.factId), dao.priorApproval(fact),
    fact.originalFragment && canReadOriginal
      ? readActiveSourceFragment(db, effective.brandId, effective.ownerId, fact.originalFragment.id)
      : null,
  ]) : [null, null, null];
  const source = fact?.originalFragment;
  const originalAvailable = !source || (canReadOriginal ? originalFragment !== null :
    (await activeSourceFragmentIds(db, effective.brandId, effective.ownerId, [source.id])).has(source.id));
  const conflict = fact && prior && prior.fields.claim !== fact.fields.claim ? prior : null;
  const dependencies = conflict
    ? await new ContentDao(db).listFactDependencies(effective.ownerId, effective.brandId, conflict.id)
    : null;
  const today = clock().toISOString().slice(0, 10);
  return {
    brandName: brand.name,
    versions: page(versions.map((item) => ({
      id: item.id, createdAt: item.createdAt, version: item.version, title: item.fields.title, status: factStatus(item, today),
    }))),
    readOnly: brand.status !== "active" || readOnlyMember,
    pastes: page(pastes), fact, paste, successor, originalFragment, latestId: latest?.id ?? null, today,
    conflict: conflict ? { id: conflict.id, version: conflict.version, claim: conflict.fields.claim } : null,
    dependencies,
    impacts: impacts.slice(0, pageSize).map((item) => ({
      ...item, effect: dependencyEffect(item.stage, fact !== null && isUsable(fact, today) &&
        originalAvailable),
    })),
    nextImpact: impacts.length > pageSize ? impacts[pageSize - 1].contentVersionId : null,
  };
}

export type FactWorkspace = NonNullable<Awaited<ReturnType<typeof readFactWorkspace>>>;

function isUsable(fact: FactVersion, today: string) {
  return factStatus(fact, today) === "approved" && factGaps(fact.fields, today, Boolean(fact.originalFragment)).length === 0;
}

export async function usableFactVersions(db: QueryConnection, scope: FactScope, facts: readonly FactVersion[], today: string) {
  const eligible = facts.filter((fact) => isUsable(fact, today));
  const ids = [...new Set(eligible.flatMap(({ originalFragment }) => originalFragment ? [originalFragment.id] : []))];
  const active = await activeSourceFragmentIds(db, scope.brandId, scope.ownerId, ids);
  return eligible.filter(({ originalFragment }) => !originalFragment || active.has(originalFragment.id));
}

export async function canReviewOriginalFragment(db: QueryConnection, scope: FactScope, actorId: string, id: string, now: string) {
  const access = await authorizeBrandActor(db, actorId, scope.brandId, "read", now);
  if (access?.ownerId !== scope.ownerId) return false;
  return (await activeSourceFragmentIds(db, scope.brandId, scope.ownerId, [id])).has(id);
}

async function canLinkPaste(dao: FactDao, fields: FactFields) {
  if (!fields.pasteId) return true;
  const paste = await dao.paste(fields.pasteId);
  if (!paste) return false;
  const span = fields.pasteSpan;
  return !span || (span[1] <= paste.original.length && !!paste.original.slice(...span).trim());
}

async function saveOriginal(dao: FactDao, command: Extract<FactCommand, { action: "savePaste" }>, now: string) {
  const saved = await dao.paste(command.id);
  if (saved) return saved.original === command.original && saved.previousId === command.previousId
    ? done(saved.id) : fail("conflict");
  if (command.previousId) {
    if (!await dao.paste(command.previousId)) return fail("notFound");
    if (await dao.pasteSuccessor(command.previousId)) return fail("conflict");
  }
  await dao.savePaste(command.id, command.previousId, command.original, now);
  return done(command.id);
}

function withInternalSource(fields: FactFields): FactFields {
  return { ...fields, sourceType: "internal", sourceReference: "", pasteId: null, pasteSpan: null };
}

async function createFromFragment(db: TransactionConnection, scope: FactScope, id: string, now: string) {
  const access = await authorizeBrandActor(db, scope.ownerId, scope.brandId, "write", now);
  if (!access) return fail("notFound");
  const brands = new BrandDao(db);
  if (!await brands.lockOwner(access.ownerId)) return fail("notFound");
  const currentAccess = await authorizeBrandActor(db, scope.ownerId, scope.brandId, "write", now);
  const brand = await brands.owned(access.ownerId, scope.brandId);
  if (currentAccess?.ownerId !== access.ownerId || brand?.status !== "active") return fail("notFound");
  const fragment = await readActiveSourceFragment(db, scope.brandId, access.ownerId, id);
  if (!fragment?.excerpt.trim()) return fail("notFound");
  const dao = new FactDao(db, { brandId: scope.brandId, ownerId: access.ownerId });
  const saved = await dao.version(id);
  if (saved) return saved.originalFragment?.id === id ? done((await dao.latest(saved.factId))?.id ?? id) : fail("conflict");
  await dao.insertVersion({
    id, factId: id, version: 1, entityVersion: brand.entityVersion, revision: 1,
    fields: withInternalSource({ ...emptyFields, sourceLocator: fragment.page?.toString() ?? "" }),
    originalFragment: { id, authorId: scope.ownerId },
    state: "pending_confirmation", createdAt: now, confirmedBy: null, confirmedAt: null, revokedAt: null,
  });
  return done(id);
}

async function createVersion(dao: FactDao, command: Extract<FactCommand, { action: "create" }>, entityVersion: number, now: string, actorId: string) {
  const previous = command.previousId ? await dao.version(command.previousId) : null;
  if (command.previousId && !previous) return fail("notFound");
  const factId = previous?.factId ?? command.id;
  const version = previous ? previous.version + 1 : 1;
  const originalFragment = previous?.originalFragment && { ...previous.originalFragment, authorId: actorId };
  const fields = originalFragment ? withInternalSource(command.fields) : command.fields;
  const saved = await dao.version(command.id);
  if (saved) return saved.factId === factId && saved.version === version &&
    saved.originalFragment?.id === originalFragment?.id &&
    JSON.stringify(saved.fields) === JSON.stringify(fields) ? done(saved.id) : fail("conflict");
  if (previous && ((previous.state !== "approved" && previous.state !== "revoked") ||
      (await dao.latest(factId))?.id !== previous.id)) return fail("conflict");
  if (!await canLinkPaste(dao, fields)) return fail("notFound");
  await dao.insertVersion({
    id: command.id, factId, version, entityVersion, revision: 1,
    fields, originalFragment, state: previous ? "pending_confirmation" : "draft", createdAt: now,
    confirmedBy: null, confirmedAt: null, revokedAt: null,
  });
  return done(command.id);
}

function isCandidate(fact: FactVersion) {
  return fact.state === "draft" || fact.state === "pending_confirmation";
}

async function approveFact(
  dao: FactDao,
  current: FactVersion,
  operation: Extract<FactCommand, { action: "approve" }>,
  approverId: string,
  now: string,
  maintenance: { db: TransactionConnection; ownerId: string; brandId: string },
) {
  if (current.state !== "pending_confirmation") return fail("conflict");
  const source = current.originalFragment;
  const gaps = factGaps(current.fields, now.slice(0, 10), Boolean(source));
  if (source && !await canReviewOriginalFragment(maintenance.db, maintenance, approverId, source.id, now)) {
    return { error: "evidenceRequired" as const, gaps: ["sourceMissing" as const] };
  }
  if (gaps.length) return { error: "evidenceRequired" as const, gaps };
  const prior = await dao.priorApproval(current);
  const conflict = prior && prior.fields.claim !== current.fields.claim ? prior : null;
  if ((conflict?.id ?? null) !== operation.conflictId || (operation.revokeConflict && !conflict)) return fail("conflict");
  await dao.transition(current, "approved", now, approverId);
  if (conflict && operation.revokeConflict) {
    await dao.transition(conflict, "revoked", now);
    await openRevokedFactMaintenance(maintenance.db, maintenance.ownerId, maintenance.brandId, conflict.id, now);
  }
  return done(current.id);
}

function maintenanceFailure(code: ContentMaintenanceAbort["code"]) {
  if (code === "NOT_FOUND") return fail("notFound");
  if (code === "INVALID_INPUT") return fail("invalidInput");
  return fail("conflict");
}

export async function executeFactCommand(db: DatabaseConnection, inputScope: unknown, input: unknown, clock = clockNow) {
  const scope = factScope.parse(inputScope);
  const command = factCommand.safeParse(input);
  if (!command.success) return fail("invalidInput");
  const operation = command.data;
  try {
    return await db.transaction(async (transaction) => {
    const brands = new BrandDao(transaction);
    const now = clock().toISOString();
    if (operation.action === "createFromFragment") return createFromFragment(transaction, scope, operation.id, now);
    if (operation.action === "approve") {
      const approvalScope = await openApprovalScope(transaction, scope.ownerId, scope.brandId, "fact");
      if (!("error" in approvalScope) && approvalScope.dual) {
        if (!await brands.lockOwner(scope.ownerId)) return fail("notFound");
        if (!await brands.lockOwner(approvalScope.brandOwnerId)) return fail("notFound");
        const ownedBrand = await brands.owned(approvalScope.brandOwnerId, scope.brandId);
        if (!ownedBrand) return fail("notFound");
        if (ownedBrand.status !== "active") return fail("readOnly");
        const reviewerDao = new FactDao(transaction, { ownerId: approvalScope.brandOwnerId, brandId: scope.brandId });
        const pending = await reviewerDao.version(operation.id);
        if (!pending) return fail("notFound");
        if (pending.revision !== operation.revision) return fail("conflict");
        const separated = await rejectIfSeparated(transaction, {
          scope: approvalScope,
          brandId: scope.brandId,
          versionId: pending.id,
          kind: "fact",
          authorId: pending.originalFragment?.authorId ?? approvalScope.brandOwnerId,
          actorId: scope.ownerId,
          now,
        });
        if (!separated.ok) return fail(separated.error === "SEPARATION" ? "separation" : "duty");
        return approveFact(reviewerDao, pending, operation, scope.ownerId, now, {
          db: transaction, ownerId: approvalScope.brandOwnerId, brandId: scope.brandId,
        });
      }
    }
    let effectiveOwnerId = scope.ownerId;
    let brand = await brands.owned(scope.ownerId, scope.brandId);
    if (!brand) {
      const writeScope = await authorizeBrandActor(transaction, scope.ownerId, scope.brandId, "write", now);
      if (!writeScope) {
        const readScope = await authorizeBrandActor(transaction, scope.ownerId, scope.brandId, "read", now);
        return readScope ? fail("readOnly") : fail("notFound");
      }
      effectiveOwnerId = writeScope.ownerId;
    }
    if (!await brands.lockOwner(effectiveOwnerId)) return fail("notFound");
    if (effectiveOwnerId !== scope.ownerId &&
      (await authorizeBrandActor(transaction, scope.ownerId, scope.brandId, "write", now))?.ownerId !== effectiveOwnerId) {
      return fail("notFound");
    }
    brand = await brands.owned(effectiveOwnerId, scope.brandId);
    if (!brand) return fail("notFound");
    if (brand.status !== "active") return fail("readOnly");
    const dao = new FactDao(transaction, { ownerId: effectiveOwnerId, brandId: scope.brandId });
    switch (operation.action) {
      case "savePaste": return saveOriginal(dao, operation, now);
      case "create": return createVersion(dao, operation, brand.entityVersion, now, scope.ownerId);
    }

    const current = await dao.version(operation.id);
    if (!current) return fail("notFound");
    if (current.revision !== operation.revision) return fail("conflict");
    switch (operation.action) {
      case "edit": {
        if (!isCandidate(current)) return fail("conflict");
        const fields = current.originalFragment ? withInternalSource(operation.fields) : operation.fields;
        if (!await canLinkPaste(dao, fields)) return fail("notFound");
        if (current.originalFragment && JSON.stringify(current.fields) !== JSON.stringify(fields)) {
          current.originalFragment = { ...current.originalFragment, authorId: scope.ownerId };
        }
        await dao.edit(current, fields);
        break;
      }
      case "submit":
        if (current.state !== "draft") return fail("conflict");
        await dao.transition(current, "pending_confirmation", now);
        break;
      case "approve":
        return approveFact(dao, current, operation, scope.ownerId, now, {
          db: transaction, ownerId: effectiveOwnerId, brandId: scope.brandId,
        });
      case "revoke":
        if (current.state !== "approved") return fail("conflict");
        await dao.transition(current, "revoked", now);
        await openRevokedFactMaintenance(transaction, effectiveOwnerId, scope.brandId, current.id, now);
        break;
    }
    return done(current.id);
    });
  } catch (error) {
    if (error instanceof ContentMaintenanceAbort) return maintenanceFailure(error.code);
    throw error;
  }
}

const useInput = z.strictObject({ factVersionIds: factIdsSchema, contentVersionId: brandIdSchema, stage: factStage });

// A content consumer commits its own DB change inside this callback, under the
// same owner lock as fact revocation. Recheck at approval and formal delivery.
export async function withEligibleFacts<T>(
  db: DatabaseConnection, inputScope: unknown, input: unknown,
  work: (transaction: TransactionConnection, facts: { id: string; factId: string; version: number; claim: string }[]) => Promise<T>,
  clock = clockNow,
  transaction?: TransactionConnection,
) {
  const scope = factScope.parse(inputScope);
  const { factVersionIds, contentVersionId, stage } = useInput.parse(input);
  const checkAndUse = async (transaction: TransactionConnection) => {
    const brands = new BrandDao(transaction);
    if (!await brands.lockOwner(scope.ownerId)) return fail("notFound");
    const brand = await brands.owned(scope.ownerId, scope.brandId);
    if (!brand) return fail("notFound");
    if (brand.status !== "active") return fail("readOnly");
    const dao = new FactDao(transaction, scope);
    const previous = await dao.usedVersionIds(contentVersionId);
    if (previous.length && (previous.length !== factVersionIds.length || previous.some((id) => !factVersionIds.includes(id)))) {
      return fail("conflict");
    }
    const today = clock().toISOString().slice(0, 10);
    const eligible = await usableFactVersions(transaction, scope, await dao.versionsById(factVersionIds), today);
    const items = new Map(eligible.map((item) => [item.id, item]));
    const invalid = factVersionIds.filter((id) => !items.has(id));
    if (invalid.length) return { error: "factInvalid" as const, ids: invalid };

    const facts = factVersionIds.map((id) => {
      const { factId, version, fields } = items.get(id)!;
      return { id, factId, version, claim: fields.claim };
    });
    await dao.recordUse(contentVersionId, stage, factVersionIds);
    return { data: await work(transaction, facts) };
  };
  return transaction ? checkAndUse(transaction) : db.transaction(checkAndUse);
}

export function factUnavailable() {
  const traceId = randomUUID();
  console.error("brand-facts-unavailable", { traceId });
  return { error: "unavailable", traceId } as const;
}
