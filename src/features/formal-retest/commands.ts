import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { CreateFormalObservationInput, RecordFormalCheckpointInput } from "./contracts.ts";
import {
  FormalObservationDao,
  type FormalCheckpointInsert,
  type FormalCheckpointRecord,
  type FormalObservationRecord,
} from "./dao.ts";
import { checkpointDue, formalComparison, type Checkpoint } from "./rules.ts";

type Clock = () => string;
type CheckpointMode = FormalCheckpointRecord["mode"];

const systemClock: Clock = () => new Date().toISOString();

export type FormalCheckpointView = {
  id: string;
  observationId: string;
  checkpoint: Checkpoint;
  mode: CheckpointMode;
  comparableCount: number;
  excluded: string[];
  conclusion: string | null;
  evaluatedOn: string;
  createdAt: string;
};

export type FormalObservationView = {
  id: string;
  brandId: string;
  frozenSetId: string;
  effectiveOn: string;
  frozenNonBrandCount: number;
  status: FormalObservationRecord["status"];
  createdAt: string;
  updatedAt: string;
  checkpoints: FormalCheckpointView[];
};

function excludedIds(excludedJson: string) {
  const parsed: unknown = JSON.parse(excludedJson);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function toCheckpoint(row: FormalCheckpointRecord): FormalCheckpointView {
  return {
    id: row.id,
    observationId: row.observationId,
    checkpoint: row.checkpoint,
    mode: row.mode,
    comparableCount: row.comparableCount,
    excluded: excludedIds(row.excludedJson),
    conclusion: row.conclusion,
    evaluatedOn: row.evaluatedOn,
    createdAt: row.createdAt,
  };
}

function toObservation(row: FormalObservationRecord, checkpoints: readonly FormalCheckpointRecord[]): FormalObservationView {
  return {
    id: row.id,
    brandId: row.brandId,
    frozenSetId: row.frozenSetId,
    effectiveOn: row.effectiveOn,
    frozenNonBrandCount: row.frozenNonBrandCount,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    checkpoints: checkpoints.filter((item) => item.observationId === row.id).map(toCheckpoint),
  };
}

export function decideFormalCheckpoint(input: {
  effectiveOn: string;
  today: string;
  checkpoint: Checkpoint;
  comparableQuestions: number;
  frozenQuestions: number;
  excluded: readonly string[];
}) {
  const due = checkpointDue({ effectiveOn: input.effectiveOn, today: input.today, checkpoint: input.checkpoint });
  const comparison = formalComparison({
    comparableQuestions: input.comparableQuestions,
    frozenQuestions: input.frozenQuestions,
    excluded: input.excluded,
  });
  if (!due) {
    return { mode: "progress" as const, conclusion: null, excluded: comparison.excluded };
  }
  const conclusion = JSON.stringify({
    kind: comparison.mode,
    comparableQuestions: input.comparableQuestions,
    frozenQuestions: input.frozenQuestions,
  });
  return { mode: comparison.mode, conclusion, excluded: comparison.excluded };
}

export async function listFormalObservations(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new FormalObservationDao(db);
  const observations = await dao.observationsForBrand(ownerId, brandId);
  const checkpoints = await dao.checkpointsFor(ownerId, observations.map((item) => item.id));
  return { observations: observations.map((item) => toObservation(item, checkpoints)) };
}

export async function createFormalObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateFormalObservationInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const observation: FormalObservationRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      frozenSetId: input.frozenSetId,
      effectiveOn: input.effectiveOn,
      frozenNonBrandCount: input.frozenNonBrandCount,
      status: "observing",
      createdAt: now,
      updatedAt: now,
    };
    await new FormalObservationDao(tx).insertObservations([observation]);
    return { observation: toObservation(observation, []) };
  });
}

export async function recordFormalCheckpoint(
  db: DatabaseConnection,
  ownerId: string,
  observationId: string,
  input: RecordFormalCheckpointInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const dao = new FormalObservationDao(tx);
    const observation = await dao.observationForOwner(ownerId, observationId);
    if (!observation) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, observation.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    if (input.comparableQuestions > observation.frozenNonBrandCount) return { error: "INVALID_INPUT" as const };
    const decision = decideFormalCheckpoint({
      effectiveOn: observation.effectiveOn,
      today: input.today,
      checkpoint: input.checkpoint,
      comparableQuestions: input.comparableQuestions,
      frozenQuestions: observation.frozenNonBrandCount,
      excluded: input.excluded,
    });
    const now = clock();
    const checkpoint: FormalCheckpointInsert = {
      id: randomUUID(),
      observationId: observation.id,
      brandId: observation.brandId,
      ownerId,
      checkpoint: input.checkpoint,
      mode: decision.mode,
      comparableCount: input.comparableQuestions,
      excludedJson: JSON.stringify(decision.excluded),
      conclusion: decision.conclusion,
      evaluatedOn: input.today,
      createdAt: now,
    };
    await dao.insertCheckpoints([checkpoint]);
    let status = observation.status;
    let updatedAt = observation.updatedAt;
    if (decision.mode !== "progress" && observation.status === "observing") {
      const marked = await dao.markCheckpointDue(ownerId, observation.id, now);
      if (marked) {
        status = "checkpoint_due";
        updatedAt = now;
      }
    }
    const checkpoints = await dao.checkpointsFor(ownerId, [observation.id]);
    return {
      observation: toObservation({ ...observation, status, updatedAt }, checkpoints),
      checkpoint: toCheckpoint(checkpoint),
    };
  });
}
