import "server-only";

import { randomUUID } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao, type BrandRecord } from "../brands/dao.ts";
import { EvidenceDao } from "../evidence/dao.ts";
import { invalidateEvidenceOverview } from "../evidence/overview-cache.ts";
import { entityCorrectionWriteSchema, entityDisambiguationWriteSchema } from "./contracts.ts";
import {
  EntityRevisionDao,
  type EntityCorrectionRecord,
  type EntityDisambiguationRecord,
} from "./dao.ts";
import { correctionStatus, sameNameConfusion } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE|duplicate key|answer_analysis_version_uidx|entity_disambiguation_prior_uidx|entity_disambiguation_next_uidx|entity_correction_event_uidx/i.test(message);
}

export type EntityRevisionBoard = {
  disambiguations: Array<{
    id: string;
    observationId: string;
    priorAnalysisId: string;
    nextAnalysisId: string;
    countAsTargetMention: boolean;
  }>;
  corrections: Array<{
    id: string;
    observationId: string;
    action: EntityCorrectionRecord["action"];
    effect: EntityCorrectionRecord["effect"];
  }>;
};

function presentDisambiguation(row: EntityDisambiguationRecord) {
  return {
    id: row.id,
    observationId: row.observationId,
    priorAnalysisId: row.priorAnalysisId,
    nextAnalysisId: row.nextAnalysisId,
    countAsTargetMention: row.countAsTargetMention === 1,
  };
}

function presentCorrection(row: EntityCorrectionRecord) {
  return {
    id: row.id,
    observationId: row.observationId,
    action: row.action,
    effect: row.effect,
  };
}

export function presentEntityRevisions(
  disambiguations: readonly EntityDisambiguationRecord[],
  corrections: readonly EntityCorrectionRecord[],
): EntityRevisionBoard {
  return {
    disambiguations: disambiguations.map(presentDisambiguation),
    corrections: corrections.map(presentCorrection),
  };
}

export type EntityRevisionWorkspace = {
  brandName: string;
  brandStatus: BrandRecord["status"];
  board: EntityRevisionBoard;
};

export function entityRevisionUnavailable(error: unknown) {
  const traceId = randomUUID();
  console.error("entity-corrections-page-unavailable", {
    traceId,
    message: error instanceof Error ? error.message : "unknown",
  });
  return { error: "SERVICE_UNAVAILABLE" as const, traceId };
}

export async function listEntityRevisions(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new EntityRevisionDao(db);
  const disambiguations = await dao.disambiguationsForBrand(ownerId, brandId);
  const corrections = await dao.correctionsForBrand(ownerId, brandId);
  return { board: presentEntityRevisions(disambiguations, corrections) };
}

export async function readEntityRevisionWorkspace(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
): Promise<EntityRevisionWorkspace | { error: "NOT_FOUND" }> {
  const owned = await new BrandDao(db).ownedSummary(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new EntityRevisionDao(db);
  const [disambiguations, corrections] = await Promise.all([
    dao.disambiguationsForBrand(ownerId, brandId),
    dao.correctionsForBrand(ownerId, brandId),
  ]);
  return {
    brandName: owned.name,
    brandStatus: owned.status,
    board: presentEntityRevisions(disambiguations, corrections),
  };
}

export async function confirmEntityDisambiguation(
  db: DatabaseConnection,
  ownerId: string,
  input: unknown,
  clock: Clock = systemClock,
  cache?: CacheStore,
) {
  const parsed = entityDisambiguationWriteSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" as const };
  const decision = sameNameConfusion({
    sameSurfaceName: parsed.data.sameSurfaceName,
    confirmedDifferentEntity: parsed.data.confirmedDifferentEntity,
  });
  try {
    const result = await db.transaction(async (tx) => {
      const owned = await new BrandDao(tx).owned(ownerId, parsed.data.brandId);
      if (!owned) return { error: "NOT_FOUND" as const };
      if (!decision.needsDisambiguation || decision.countAsTargetMention) return { error: "INVALID_INPUT" as const };
      const evidence = new EvidenceDao(tx);
      const observation = await evidence.observationForOwner(ownerId, parsed.data.observationId);
      if (!observation || observation.brandId !== parsed.data.brandId) return { error: "NOT_FOUND" as const };
      const latest = await evidence.latestAnalysis(observation.id);
      if (!latest || latest.id !== parsed.data.priorAnalysisId || latest.brandId !== parsed.data.brandId) {
        return { error: "INVALID_INPUT" as const };
      }
      const now = clock();
      const nextId = randomUUID();
      const mentioned = decision.countAsTargetMention ? "true" : "false";
      await evidence.markAnalysisRevised(latest.id, parsed.data.brandId);
      await evidence.insertAnalysis({
        id: nextId,
        observationId: observation.id,
        brandId: parsed.data.brandId,
        version: latest.version + 1,
        entityVersion: observation.entityVersion,
        ruleVersion: latest.ruleVersion,
        mentioned,
        recommended: latest.recommended,
        officialSiteCited: latest.officialSiteCited,
        evidenceSpan: latest.evidenceSpan,
        status: latest.recommended === "true" && mentioned === "false" ? "needs_review" : "classified",
        revisedFrom: latest.id,
        reason: "same_name_different_entity",
        reviewerId: ownerId,
        createdAt: now,
      });
      const row: EntityDisambiguationRecord = {
        id: randomUUID(),
        brandId: parsed.data.brandId,
        ownerId,
        observationId: observation.id,
        priorAnalysisId: latest.id,
        nextAnalysisId: nextId,
        countAsTargetMention: decision.countAsTargetMention ? 1 : 0,
        createdAt: now,
      };
      await new EntityRevisionDao(tx).insertDisambiguation(row);
      return {
        recorded: true as const,
        disambiguation: presentDisambiguation(row),
        prior: { id: latest.id, version: latest.version, mentioned: latest.mentioned },
        next: { id: nextId, version: latest.version + 1, mentioned },
      };
    });
    if ("recorded" in result) {
      await invalidateEvidenceOverview(ownerId, parsed.data.brandId, cache ?? openCache());
    }
    return result;
  } catch (error) {
    if (uniqueConflict(error)) return { error: "INVALID_INPUT" as const };
    throw error;
  }
}

export async function recordEntityCorrection(
  db: DatabaseConnection,
  ownerId: string,
  input: unknown,
  clock: Clock = systemClock,
) {
  const parsed = entityCorrectionWriteSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" as const };
  const status = correctionStatus({
    actionDone: parsed.data.actionDone,
    retestStillWrong: parsed.data.retestStillWrong,
  });
  try {
    return await db.transaction(async (tx) => {
      const owned = await new BrandDao(tx).owned(ownerId, parsed.data.brandId);
      if (!owned) return { error: "NOT_FOUND" as const };
      const observation = await new EvidenceDao(tx).observationForOwner(ownerId, parsed.data.observationId);
      if (!observation || observation.brandId !== parsed.data.brandId) return { error: "NOT_FOUND" as const };
      const row: EntityCorrectionRecord = {
        id: randomUUID(),
        brandId: parsed.data.brandId,
        ownerId,
        observationId: observation.id,
        action: status.action,
        effect: status.effect,
        createdAt: clock(),
      };
      await new EntityRevisionDao(tx).insertCorrection(row);
      return { recorded: true as const, correction: presentCorrection(row) };
    });
  } catch (error) {
    if (uniqueConflict(error)) return { error: "INVALID_INPUT" as const };
    throw error;
  }
}
