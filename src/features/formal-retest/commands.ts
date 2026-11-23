import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  appendFormalConfounderSchema,
  type CreateFormalObservationInput,
  type RecordFormalCheckpointInput,
} from "./contracts.ts";
import {
  FormalObservationDao,
  type FormalCheckpointInsert,
  type FormalCheckpointRecord,
  type FormalConfounderRecord,
  type FormalObservationRecord,
} from "./dao.ts";
import { checkpointDue, formalComparison, recordConfounders, type Checkpoint, type ConfounderFactor } from "./rules.ts";

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

export type FormalConfounderView = {
  id: string;
  observationId: string;
  factor: ConfounderFactor;
  note: string;
  recordedAt: string;
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
  confounders: FormalConfounderView[];
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

function toConfounder(row: FormalConfounderRecord): FormalConfounderView {
  return {
    id: row.id,
    observationId: row.observationId,
    factor: row.factor,
    note: row.note,
    recordedAt: row.recordedAt,
  };
}

function toObservation(
  row: FormalObservationRecord,
  checkpoints: readonly FormalCheckpointRecord[],
  confounders: readonly FormalConfounderRecord[] = [],
): FormalObservationView {
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
    confounders: confounders.filter((item) => item.observationId === row.id).map(toConfounder),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const observationIds = observations.map((item) => item.id);
  const checkpoints = await dao.checkpointsFor(ownerId, observationIds);
  const confounders = await dao.confoundersFor(ownerId, observationIds);
  return { observations: observations.map((item) => toObservation(item, checkpoints, confounders)) };
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
    const confounders = await dao.confoundersFor(ownerId, [observation.id]);
    return {
      observation: toObservation({ ...observation, status, updatedAt }, checkpoints, confounders),
      checkpoint: toCheckpoint(checkpoint),
    };
  });
}

export async function listFormalConfounders(db: DatabaseConnection, ownerId: string, observationId: string) {
  const dao = new FormalObservationDao(db);
  const observation = await dao.observationForOwner(ownerId, observationId);
  if (!observation) return { error: "NOT_FOUND" as const };
  const owned = await new BrandDao(db).owned(ownerId, observation.brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const confounders = await dao.confoundersFor(ownerId, [observation.id]);
  return { confounders: confounders.map(toConfounder) };
}

export async function appendFormalConfounder(
  db: DatabaseConnection,
  ownerId: string,
  observationId: string,
  input: unknown,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const dao = new FormalObservationDao(tx);
    const observation = await dao.observationForOwner(ownerId, observationId);
    if (!observation) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, observation.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    if (!isRecord(input)) return { error: "INVALID_INPUT" as const };
    if ("thresholdPp" in input || "threshold" in input) {
      const factor = typeof input.factor === "string" ? input.factor : "";
      const thresholdPp = typeof input.thresholdPp === "number" && Number.isFinite(input.thresholdPp) ? input.thresholdPp : 0;
      const decision = recordConfounders({ factors: factor.length > 0 ? [factor] : [], thresholdPp });
      if (decision.thresholdChanged) return { error: "INVALID_INPUT" as const };
      return { error: "THRESHOLD_REJECTED" as const };
    }
    const parsed = appendFormalConfounderSchema.safeParse(input);
    if (!parsed.success) return { error: "INVALID_INPUT" as const };
    const decision = recordConfounders({ factors: [parsed.data.factor], thresholdPp: 0 });
    if (!decision.accepted || decision.thresholdChanged || decision.factors[0] !== parsed.data.factor) {
      return { error: "INVALID_INPUT" as const };
    }
    const row: FormalConfounderRecord & { ownerId: string } = {
      id: randomUUID(),
      observationId: observation.id,
      brandId: observation.brandId,
      ownerId,
      factor: parsed.data.factor,
      note: parsed.data.note,
      recordedAt: clock(),
    };
    await dao.insertConfounders([row]);
    const confounders = await dao.confoundersFor(ownerId, [observation.id]);
    return { confounders: confounders.map(toConfounder) };
  });
}
