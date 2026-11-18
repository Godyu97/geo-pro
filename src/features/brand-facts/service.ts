import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BrandDao } from "../brands/dao.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import {
  factCommand, factIdsSchema, factScope, factStage,
  type FactCommand, type FactCursor, type FactFields, type FactScope, type FactVersion,
} from "./contracts.ts";
import { FactDao, pageSize } from "./dao.ts";
import { dependencyEffect, factGaps, factStatus } from "./rules.ts";

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
  const brand = await new BrandDao(db).owned(scope.ownerId, scope.brandId);
  if (!brand) return null;
  const dao = new FactDao(db, scope);
  const [versions, pastes, fact, paste, impacts, successor] = await Promise.all([
    dao.versions(query.after), dao.pastes(query.pasteAfter),
    query.fact ? dao.version(query.fact) : null,
    query.paste ? dao.paste(query.paste) : null,
    query.fact ? dao.impact(query.fact, query.impactAfter) : [],
    query.paste ? dao.pasteSuccessor(query.paste) : null,
  ]);
  if ((query.fact && !fact) || (query.paste && !paste)) return null;
  const [latest, prior] = fact ? await Promise.all([dao.latest(fact.factId), dao.priorApproval(fact)]) : [null, null];
  const conflict = fact && prior && prior.fields.claim !== fact.fields.claim ? prior : null;
  const today = clock().toISOString().slice(0, 10);
  return {
    versions: page(versions.map((item) => ({
      id: item.id, createdAt: item.createdAt, version: item.version, title: item.fields.title, status: factStatus(item, today),
    }))),
    readOnly: brand.status !== "active",
    pastes: page(pastes), fact, paste, successor, latestId: latest?.id ?? null, today,
    conflict: conflict ? { id: conflict.id, version: conflict.version, claim: conflict.fields.claim } : null,
    impacts: impacts.slice(0, pageSize).map((item) => ({
      ...item, effect: dependencyEffect(item.stage, fact !== null && isUsable(fact, today)),
    })),
    nextImpact: impacts.length > pageSize ? impacts[pageSize - 1].contentVersionId : null,
  };
}

export type FactWorkspace = NonNullable<Awaited<ReturnType<typeof readFactWorkspace>>>;

function isUsable(fact: FactVersion, today: string) {
  return factStatus(fact, today) === "approved" && factGaps(fact.fields, today).length === 0;
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

async function createVersion(dao: FactDao, command: Extract<FactCommand, { action: "create" }>, entityVersion: number, now: string) {
  const previous = command.previousId ? await dao.version(command.previousId) : null;
  if (command.previousId && !previous) return fail("notFound");
  const factId = previous?.factId ?? command.id;
  const version = previous ? previous.version + 1 : 1;
  const saved = await dao.version(command.id);
  if (saved) return saved.factId === factId && saved.version === version &&
    JSON.stringify(saved.fields) === JSON.stringify(command.fields) ? done(saved.id) : fail("conflict");
  if (previous && ((previous.state !== "approved" && previous.state !== "revoked") ||
      (await dao.latest(factId))?.id !== previous.id)) return fail("conflict");
  if (!await canLinkPaste(dao, command.fields)) return fail("notFound");
  await dao.insertVersion({
    id: command.id, factId, version, entityVersion, revision: 1,
    fields: command.fields, state: previous ? "pending_confirmation" : "draft", createdAt: now,
    confirmedBy: null, confirmedAt: null, revokedAt: null,
  });
  return done(command.id);
}

function isCandidate(fact: FactVersion) {
  return fact.state === "draft" || fact.state === "pending_confirmation";
}

export async function executeFactCommand(db: DatabaseConnection, inputScope: unknown, input: unknown, clock = clockNow) {
  const scope = factScope.parse(inputScope);
  const command = factCommand.safeParse(input);
  if (!command.success) return fail("invalidInput");
  const operation = command.data;
  return db.transaction(async (transaction) => {
    const brands = new BrandDao(transaction);
    if (!await brands.lockOwner(scope.ownerId)) return fail("notFound");
    const brand = await brands.owned(scope.ownerId, scope.brandId);
    if (!brand) return fail("notFound");
    if (brand.status !== "active") return fail("readOnly");

    const now = clock().toISOString();
    const dao = new FactDao(transaction, scope);
    switch (operation.action) {
      case "savePaste": return saveOriginal(dao, operation, now);
      case "create": return createVersion(dao, operation, brand.entityVersion, now);
    }

    const current = await dao.version(operation.id);
    if (!current) return fail("notFound");
    if (current.revision !== operation.revision) return fail("conflict");
    switch (operation.action) {
      case "edit":
        if (!isCandidate(current)) return fail("conflict");
        if (!await canLinkPaste(dao, operation.fields)) return fail("notFound");
        await dao.edit(current, operation.fields);
        break;
      case "submit":
        if (current.state !== "draft") return fail("conflict");
        await dao.transition(current, "pending_confirmation", now);
        break;
      case "approve": {
        if (current.state !== "pending_confirmation") return fail("conflict");
        const gaps = factGaps(current.fields, now.slice(0, 10));
        if (gaps.length) return { error: "evidenceRequired" as const, gaps };
        const prior = await dao.priorApproval(current);
        const conflict = prior && prior.fields.claim !== current.fields.claim ? prior : null;
        if ((conflict?.id ?? null) !== operation.conflictId || (operation.revokeConflict && !conflict)) return fail("conflict");
        await dao.transition(current, "approved", now);
        if (conflict && operation.revokeConflict) await dao.transition(conflict, "revoked", now);
        break;
      }
      case "revoke":
        if (current.state !== "approved") return fail("conflict");
        await dao.transition(current, "revoked", now);
        break;
    }
    return done(current.id);
  });
}

const useInput = z.strictObject({ factVersionIds: factIdsSchema, contentVersionId: brandIdSchema, stage: factStage });

// A content consumer commits its own DB change inside this callback, under the
// same owner lock as fact revocation. Recheck at approval and formal delivery.
export async function withEligibleFacts<T>(
  db: DatabaseConnection, inputScope: unknown, input: unknown,
  work: (transaction: TransactionConnection, facts: { id: string; factId: string; version: number; claim: string }[]) => Promise<T>,
  clock = clockNow,
) {
  const scope = factScope.parse(inputScope);
  const { factVersionIds, contentVersionId, stage } = useInput.parse(input);
  return db.transaction(async (transaction) => {
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
    const items = new Map((await dao.versionsById(factVersionIds)).map((item) => [item.id, item]));
    const today = clock().toISOString().slice(0, 10);
    const invalid = factVersionIds.filter((id) => {
      const item = items.get(id);
      return !item || !isUsable(item, today);
    });
    if (invalid.length) return { error: "factInvalid" as const, ids: invalid };

    const facts = factVersionIds.map((id) => {
      const { factId, version, fields } = items.get(id)!;
      return { id, factId, version, claim: fields.claim };
    });
    await dao.recordUse(contentVersionId, stage, factVersionIds);
    return { data: await work(transaction, facts) };
  });
}

export function factUnavailable() {
  const traceId = randomUUID();
  console.error("brand-facts-unavailable", { traceId });
  return { error: "unavailable", traceId } as const;
}
