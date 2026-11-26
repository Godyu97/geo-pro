import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { statisticsTimeZone } from "../../lib/i18n/format.ts";
import { BrandDao } from "../brands/dao.ts";
import { SamplingProtocolDao } from "../monitoring/protocol-dao.ts";
import { draftContent, primaryTypes } from "../prompts/contracts.ts";
import { isTimeZone } from "../sampling-plans/due-window.ts";
import {
  appendFormalConfounderSchema,
  formalCheckpointEvaluationSchema,
  registerFormalControlSchema,
  stopFormalObservationSchema,
  type CreateFormalObservationInput,
  type RecordFormalCheckpointInput,
} from "./contracts.ts";
import {
  FormalObservationDao,
  type FormalCheckpointInsert,
  type FormalCheckpointRecord,
  type FormalConfounderRecord,
  type FormalControlRecord,
  type FormalObservationRecord,
  type SavedFormalSlotRow,
} from "./dao.ts";
import {
  applyBaselineGate,
  assessBaseline,
  checkpointDue,
  evaluateFormalCheckpointGate,
  recordConfounders,
  registerControlPage,
  stopObservation,
  type BaselineAssessment,
  type Checkpoint,
  type ConfounderFactor,
  type FormalCheckpointEvaluation,
  type FormalSlotSample,
} from "./rules.ts";

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
  evaluation: FormalCheckpointEvaluation | null;
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

export type FormalControlView = {
  id: string;
  observationId: string;
  pageKey: string;
  label: "observation";
  registeredAt: string;
};

export type FormalBaselineView = {
  timeZone: string;
  start: string;
  end: string;
  compliant: boolean;
  rescheduleOn: string | null;
  interventionCount: number;
  publicationCount: number;
};

export type FormalObservationView = {
  id: string;
  brandId: string;
  frozenSetId: string;
  effectiveOn: string;
  frozenNonBrandCount: number;
  status: FormalObservationRecord["status"];
  stopReason: string | null;
  retainedSlotIds: string[];
  createdAt: string;
  updatedAt: string;
  baseline: FormalBaselineView;
  checkpoints: FormalCheckpointView[];
  confounders: FormalConfounderView[];
  controls: FormalControlView[];
};

function excludedIds(excludedJson: string) {
  const parsed: unknown = JSON.parse(excludedJson);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseEvaluation(evaluationJson: string | null): FormalCheckpointEvaluation | null {
  if (!evaluationJson) return null;
  return formalCheckpointEvaluationSchema.parse(JSON.parse(evaluationJson));
}

function toCheckpoint(row: FormalCheckpointRecord): FormalCheckpointView {
  return {
    id: row.id,
    observationId: row.observationId,
    checkpoint: row.checkpoint,
    mode: row.mode,
    comparableCount: row.comparableCount,
    excluded: excludedIds(row.excludedJson),
    evaluation: parseEvaluation(row.evaluationJson),
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

function toControl(row: FormalControlRecord): FormalControlView {
  return {
    id: row.id,
    observationId: row.observationId,
    pageKey: row.pageKey,
    label: row.label,
    registeredAt: row.registeredAt,
  };
}

function toBaselineView(assessment: BaselineAssessment): FormalBaselineView {
  return {
    timeZone: assessment.timeZone,
    start: assessment.start,
    end: assessment.end,
    compliant: assessment.compliant,
    rescheduleOn: assessment.rescheduleOn,
    interventionCount: assessment.hits.filter((hit) => hit.kind === "intervention").length,
    publicationCount: assessment.hits.filter((hit) => hit.kind === "publication").length,
  };
}

async function loadBaselineContext(db: QueryConnection, ownerId: string, brandId: string) {
  const dao = new FormalObservationDao(db);
  const [protocol, interventions, publications] = await Promise.all([
    new SamplingProtocolDao(db).latestFrozenForBrand(ownerId, brandId),
    dao.effectiveInterventions(ownerId, brandId),
    dao.verifiedPublications(ownerId, brandId),
  ]);
  const timeZone = protocol && isTimeZone(protocol.timezone) ? protocol.timezone : statisticsTimeZone;
  return {
    timeZone,
    events: [
      ...interventions.map((row) => ({ kind: "intervention" as const, id: row.id, effectiveAt: row.effectiveAt })),
      ...publications.map((row) => ({ kind: "publication" as const, id: row.id, effectiveAt: row.effectiveAt })),
    ],
  };
}

function baselineFor(context: Awaited<ReturnType<typeof loadBaselineContext>>, effectiveOn: string) {
  return toBaselineView(assessBaseline({ effectiveOn, timeZone: context.timeZone, events: context.events }));
}

function retainedSlotIds(checkpoints: readonly FormalCheckpointRecord[]) {
  const ids = new Set<string>();
  for (const row of checkpoints) {
    for (const id of parseEvaluation(row.evaluationJson)?.slotIds ?? []) ids.add(id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function toObservation(
  row: FormalObservationRecord,
  checkpoints: readonly FormalCheckpointRecord[],
  confounders: readonly FormalConfounderRecord[] = [],
  controls: readonly FormalControlRecord[] = [],
  baseline: FormalBaselineView,
): FormalObservationView {
  return {
    id: row.id,
    brandId: row.brandId,
    frozenSetId: row.frozenSetId,
    effectiveOn: row.effectiveOn,
    frozenNonBrandCount: row.frozenNonBrandCount,
    status: row.status,
    stopReason: row.stopReason,
    retainedSlotIds: retainedSlotIds(checkpoints.filter((item) => item.observationId === row.id)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    baseline,
    checkpoints: checkpoints.filter((item) => item.observationId === row.id).map(toCheckpoint),
    confounders: confounders.filter((item) => item.observationId === row.id).map(toConfounder),
    controls: controls.filter((item) => item.observationId === row.id).map(toControl),
  };
}

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /unique|duplicate key/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const brandWebsiteSchema = z.object({ website: z.string().nullable().optional() });

function resolveHasOfficialWebsite(rows: readonly SavedFormalSlotRow[]) {
  const brandContents = rows.map((row) => row.brandContent).filter((value): value is string => value !== null);
  if (brandContents.length === 0) return true;
  return brandContents.some((raw) => {
    const parsed = brandWebsiteSchema.safeParse(JSON.parse(raw));
    return Boolean(parsed.success && parsed.data.website?.trim());
  });
}

function mapSavedSlots(rows: readonly SavedFormalSlotRow[]): FormalSlotSample[] {
  const promptCache = new Map<string, z.infer<typeof draftContent>>();
  return rows.map((row) => {
    let naturalQuestion = row.naturalQuestion === 1;
    if (naturalQuestion && row.promptContent) {
      let prompt = promptCache.get(row.promptContent);
      if (!prompt) {
        const parsed = draftContent.safeParse(JSON.parse(row.promptContent));
        if (parsed.success) {
          prompt = parsed.data;
          promptCache.set(row.promptContent, prompt);
        }
      }
      const question = prompt?.questions.find((item) => item.id === row.questionId);
      if (question) {
        naturalQuestion = question.primary && primaryTypes.has(question.type) && question.status === "confirmed";
      }
    }
    return {
      slotId: row.slotId,
      runId: row.runId,
      questionId: row.questionId,
      naturalQuestion,
      slotStatus: row.slotStatus,
      slotCreatedAt: row.slotCreatedAt,
      timezone: row.protocolTimezone ?? "UTC",
      observation: row.observationId && row.capturedAt && row.evidenceState && row.citationSetState
        && row.requestedNetworkMode && row.networkTrigger && row.newSession
        && row.targetRegion && row.observedRegion && row.entityVersion !== null
        ? {
            id: row.observationId,
            capturedAt: row.capturedAt,
            evidenceState: row.evidenceState,
            citationSetState: row.citationSetState,
            requestedNetworkMode: row.requestedNetworkMode,
            networkTrigger: row.networkTrigger,
            newSession: row.newSession,
            targetRegion: row.targetRegion,
            observedRegion: row.observedRegion,
            entityVersion: row.entityVersion,
            searchRequired: row.searchRequired === 1,
            newSessionRequired: row.newSessionRequired === 1,
            protocolRegion: row.protocolRegion,
          }
        : null,
      analysis: row.analysisId && row.analysisVersion !== null && row.analysisEntityVersion !== null
        && row.analysisRuleVersion && row.analysisStatus && row.mentioned && row.recommended && row.officialSiteCited
        ? {
            id: row.analysisId,
            version: row.analysisVersion,
            entityVersion: row.analysisEntityVersion,
            ruleVersion: row.analysisRuleVersion,
            status: row.analysisStatus,
            mentioned: row.mentioned,
            recommended: row.recommended,
            officialSiteCited: row.officialSiteCited,
          }
        : null,
    };
  });
}

export function decideFormalCheckpoint(input: {
  effectiveOn: string;
  today: string;
  checkpoint: Checkpoint;
  frozenQuestions: number;
  hasOfficialWebsite?: boolean;
  slots?: readonly FormalSlotSample[];
  excluded?: readonly string[];
}) {
  return evaluateFormalCheckpointGate({
    effectiveOn: input.effectiveOn,
    today: input.today,
    checkpoint: input.checkpoint,
    frozenNonBrandCount: input.frozenQuestions,
    hasOfficialWebsite: input.hasOfficialWebsite ?? true,
    slots: input.slots ?? [],
    callerExcluded: input.excluded ?? [],
  });
}

export async function listFormalObservations(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new FormalObservationDao(db);
  const observations = await dao.observationsForBrand(ownerId, brandId);
  const observationIds = observations.map((item) => item.id);
  const checkpoints = await dao.checkpointsFor(ownerId, observationIds);
  const confounders = await dao.confoundersFor(ownerId, observationIds);
  const controls = await dao.controlsFor(ownerId, observationIds);
  const baselineContext = await loadBaselineContext(db, ownerId, brandId);
  return {
    observations: observations.map((item) => toObservation(
      item,
      checkpoints,
      confounders,
      controls,
      baselineFor(baselineContext, item.effectiveOn),
    )),
  };
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
    const baseline = baselineFor(await loadBaselineContext(tx, ownerId, input.brandId), input.effectiveOn);
    const observation: FormalObservationRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      frozenSetId: input.frozenSetId,
      effectiveOn: input.effectiveOn,
      frozenNonBrandCount: input.frozenNonBrandCount,
      status: "observing",
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    };
    await new FormalObservationDao(tx).insertObservations([observation]);
    return { observation: toObservation(observation, [], [], [], baseline) };
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
    if (observation.status === "stopped") return { error: "OBSERVATION_STOPPED" as const };
    const due = checkpointDue({
      effectiveOn: observation.effectiveOn,
      today: input.today,
      checkpoint: input.checkpoint,
    });
    const savedRows = due
      ? await dao.savedSlotsForFrozenSet(ownerId, observation.brandId, observation.frozenSetId)
      : [];
    const baseline = baselineFor(await loadBaselineContext(tx, ownerId, observation.brandId), observation.effectiveOn);
    const decision = applyBaselineGate(decideFormalCheckpoint({
      effectiveOn: observation.effectiveOn,
      today: input.today,
      checkpoint: input.checkpoint,
      frozenQuestions: observation.frozenNonBrandCount,
      hasOfficialWebsite: resolveHasOfficialWebsite(savedRows),
      slots: mapSavedSlots(savedRows),
      excluded: input.excluded,
    }), baseline.compliant);
    const now = clock();
    const checkpoint: FormalCheckpointInsert = {
      id: randomUUID(),
      observationId: observation.id,
      brandId: observation.brandId,
      ownerId,
      checkpoint: input.checkpoint,
      mode: decision.mode,
      comparableCount: decision.comparableCount,
      excludedJson: JSON.stringify(decision.excluded),
      evaluationJson: decision.evaluation ? JSON.stringify(decision.evaluation) : null,
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
    const controls = await dao.controlsFor(ownerId, [observation.id]);
    return {
      observation: toObservation({ ...observation, status, updatedAt }, checkpoints, confounders, controls, baseline),
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

export async function listFormalControls(db: DatabaseConnection, ownerId: string, observationId: string) {
  const dao = new FormalObservationDao(db);
  const observation = await dao.observationForOwner(ownerId, observationId);
  if (!observation) return { error: "NOT_FOUND" as const };
  const owned = await new BrandDao(db).owned(ownerId, observation.brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const controls = await dao.controlsFor(ownerId, [observation.id]);
  return { controls: controls.map(toControl) };
}

export async function registerFormalControl(
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
    const label = typeof input.label === "string" ? input.label : "";
    const labelDecision = registerControlPage({ label, checkpointCount: 0, checkpointMode: null });
    if (!labelDecision.accepted) return { error: "INVALID_INPUT" as const };
    const parsed = registerFormalControlSchema.safeParse(input);
    if (!parsed.success) return { error: "INVALID_INPUT" as const };
    const checkpoints = await dao.checkpointsFor(ownerId, [observation.id]);
    const checkpointMode = checkpoints.at(-1)?.mode ?? null;
    const decision = registerControlPage({
      label: parsed.data.label,
      checkpointCount: checkpoints.length,
      checkpointMode,
    });
    if (decision.checkpointMode !== checkpointMode) return { error: "INVALID_INPUT" as const };
    if (!decision.accepted) return { error: "CHECKPOINT_EXISTS" as const };
    const existing = await dao.controlByPage(ownerId, observation.id, parsed.data.pageKey);
    if (!existing) {
      try {
        await dao.insertControls([{
          id: randomUUID(),
          observationId: observation.id,
          brandId: observation.brandId,
          ownerId,
          pageKey: parsed.data.pageKey,
          label: decision.label,
          registeredAt: clock(),
        }]);
      } catch (error) {
        if (!uniqueConflict(error)) throw error;
      }
    }
    const controls = await dao.controlsFor(ownerId, [observation.id]);
    return { controls: controls.map(toControl) };
  });
}

async function observationView(
  db: QueryConnection,
  ownerId: string,
  observation: FormalObservationRecord,
  checkpoints: readonly FormalCheckpointRecord[],
  confounders: readonly FormalConfounderRecord[],
  controls: readonly FormalControlRecord[],
) {
  const baseline = baselineFor(await loadBaselineContext(db, ownerId, observation.brandId), observation.effectiveOn);
  return toObservation(observation, checkpoints, confounders, controls, baseline);
}

export async function readFormalObservation(db: DatabaseConnection, ownerId: string, observationId: string) {
  const dao = new FormalObservationDao(db);
  const observation = await dao.observationForOwner(ownerId, observationId);
  if (!observation) return { error: "NOT_FOUND" as const };
  const owned = await new BrandDao(db).owned(ownerId, observation.brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const checkpoints = await dao.checkpointsFor(ownerId, [observation.id]);
  const confounders = await dao.confoundersFor(ownerId, [observation.id]);
  const controls = await dao.controlsFor(ownerId, [observation.id]);
  return {
    observation: await observationView(db, ownerId, observation, checkpoints, confounders, controls),
  };
}

export async function stopFormalObservation(
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
    const parsed = stopFormalObservationSchema.safeParse(input);
    if (!parsed.success) return { error: "INVALID_INPUT" as const };
    const checkpoints = await dao.checkpointsFor(ownerId, [observation.id]);
    const decision = stopObservation({
      reason: parsed.data.reason,
      slotIds: retainedSlotIds(checkpoints),
    });
    if (!decision.stopped) return { error: "INVALID_INPUT" as const };
    if (observation.status === "stopped") return { error: "OBSERVATION_STOPPED" as const };
    const now = clock();
    const marked = await dao.markStopped(ownerId, observation.id, decision.reason, now);
    if (!marked) return { error: "OBSERVATION_STOPPED" as const };
    const confounders = await dao.confoundersFor(ownerId, [observation.id]);
    const controls = await dao.controlsFor(ownerId, [observation.id]);
    const stopped = { ...observation, status: "stopped" as const, stopReason: decision.reason, updatedAt: now };
    return {
      observation: await observationView(tx, ownerId, stopped, checkpoints, confounders, controls),
      retainedSlotIds: decision.retainedSlotIds,
    };
  });
}
