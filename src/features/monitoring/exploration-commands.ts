import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  explorationExclusionReason,
  type CreateExplorationInput,
  type ExplorationError,
  type ExplorationList,
  type ExplorationObservationView,
} from "./exploration-contracts.ts";
import { ExplorationDao, type ExplorationRecord } from "./exploration-dao.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

function failed(error: ExplorationError): { error: ExplorationError } {
  return { error };
}

function toView(row: {
  id: string;
  brandId: string;
  questionText: string;
  answerText: string;
  exclusionReason: ExplorationRecord["exclusionReason"];
  createdAt: string;
}): ExplorationObservationView {
  return {
    id: row.id,
    brandId: row.brandId,
    questionText: row.questionText,
    answerText: row.answerText,
    exclusionReason: row.exclusionReason,
    excludedFromNatural: true,
    createdAt: row.createdAt,
  };
}

export async function listExplorationBrands(db: QueryConnection, ownerId: string) {
  return new ExplorationDao(db).activeBrandIds(ownerId);
}

export async function listExplorationObservations(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
): Promise<ExplorationList | { error: ExplorationError }> {
  const rows = await new ExplorationDao(db).listForOwner(ownerId, brandId);
  if (rows.length === 0) return failed("NOT_FOUND");
  return {
    observations: rows.flatMap((row) => {
      if (!row.id || row.questionText === null || row.answerText === null || !row.exclusionReason || row.excludedFromNatural !== 1 || !row.createdAt) {
        return [];
      }
      return [toView({
        id: row.id,
        brandId: row.brandId,
        questionText: row.questionText,
        answerText: row.answerText,
        exclusionReason: row.exclusionReason,
        createdAt: row.createdAt,
      })];
    }),
  };
}

export async function recordExplorationObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateExplorationInput & { copyToAnswerObservation?: boolean },
  clock: Clock = systemClock,
): Promise<{ observation: ExplorationObservationView } | { error: ExplorationError }> {
  // The same diagnostic text is refused before any write, including answer_observation.
  if (input.copyToAnswerObservation === true) return failed("NATURAL_COPY_REJECTED");
  if (input.exclusionReason !== explorationExclusionReason) return failed("INVALID_INPUT");
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return failed("NOT_FOUND");
    const owned = await brands.owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return failed("NOT_FOUND");
    const dao = new ExplorationDao(tx);
    const existing = await dao.byOperation(ownerId, input.operationId);
    if (existing) {
      const same = existing.brandId === input.brandId
        && existing.questionText === input.questionText
        && existing.answerText === input.answerText
        && existing.exclusionReason === explorationExclusionReason
        && existing.excludedFromNatural === 1;
      if (!same) return failed("OPERATION_CONFLICT");
      return { observation: toView(existing) };
    }
    const id = randomUUID();
    await dao.insert({
      id,
      brandId: input.brandId,
      ownerId,
      questionText: input.questionText,
      answerText: input.answerText,
      exclusionReason: explorationExclusionReason,
      excludedFromNatural: 1,
      operationId: input.operationId,
      createdAt: clock(),
    });
    const stored = await dao.rowForOwner(ownerId, id);
    if (!stored || stored.excludedFromNatural !== 1 || stored.exclusionReason !== explorationExclusionReason
      || stored.questionText !== input.questionText || stored.answerText !== input.answerText) {
      throw new Error("exploration-observation-missing");
    }
    return { observation: toView(stored) };
  });
}
