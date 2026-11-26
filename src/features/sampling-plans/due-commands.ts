import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { PromptDao } from "../prompts/dao.ts";
import { recordQualityAlert } from "../quality-alerts/commands.ts";
import type { SamplingPlanError, DriveDueWindowInput } from "./contracts.ts";
import { driveDueWindowSchema } from "./contracts.ts";
import { SamplingDueDao, type SamplingDueRunRecord, type SamplingWindowReadingRecord } from "./due-dao.ts";
import {
  buildWindowReadings,
  decideDueWindow,
  localWindowId,
  trendThresholdForWindow,
  windowBounds,
  type DueDecision,
  type ObservationFact,
} from "./due-window.ts";
import { SamplingPlanDao, type SamplingPlanRecord, type SamplingSlotRecord } from "./dao.ts";
import { coverageDenominator, manualSheetLines } from "./rules.ts";

type Failure = { error: SamplingPlanError };

export type DueOfficialExecutor = (input: {
  dueId: string;
  slotId: string;
  channelId: string;
  windowId: string;
  planVersion: number;
  costMinor: number;
}) => Promise<{ runId: string; chargedMinor: number }>;

export type DueWindowRunView = {
  id: string;
  planId: string;
  slotId: string;
  channelId: string;
  windowId: string;
  kind: SamplingDueRunRecord["kind"];
  status: SamplingDueRunRecord["status"];
  monitoringRunId: string | null;
  chargedMinor: number;
  promptSetId: string | null;
  promptSetVersion: number | null;
  promptIds: string[];
  replayed: boolean;
};

export type DueWindowReadingView = {
  planId: string;
  windowId: string;
  timezone: string;
  plannedCount: number;
  eligibleCount: number;
  recommendedCount: number;
  judgedCount: number;
  coverageSufficient: boolean;
  comparableWindows: number;
  waitingForTrend: boolean;
  alertId: string | null;
};

export type DueDriveResult = {
  planId: string;
  version: number;
  pausedBudgetIds: string[];
  pausedChannelIds: string[];
  runs: DueWindowRunView[];
  readings: DueWindowReadingView[];
  pendingOfficialSlotIds: string[];
  coverageSlotIds: string[];
  alert: { id: string; kind: "data_quality" | "trend"; created: boolean; claimBrandDecline: boolean } | null;
};

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE|duplicate key|sampling_due_run_slot_uidx/i.test(message);
}

function promptList(value: string | null) {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function toRunView(row: SamplingDueRunRecord, replayed: boolean): DueWindowRunView {
  return {
    id: row.id,
    planId: row.planId,
    slotId: row.slotId,
    channelId: row.channelId,
    windowId: row.windowId,
    kind: row.kind,
    status: row.status,
    monitoringRunId: row.monitoringRunId,
    chargedMinor: row.chargedMinor,
    promptSetId: row.promptSetId,
    promptSetVersion: row.promptSetVersion,
    promptIds: promptList(row.promptIdsJson),
    replayed,
  };
}

function toReadingView(row: SamplingWindowReadingRecord): DueWindowReadingView {
  return {
    planId: row.planId,
    windowId: row.windowId,
    timezone: row.timezone,
    plannedCount: row.plannedCount,
    eligibleCount: row.eligibleCount,
    recommendedCount: row.recommendedCount,
    judgedCount: row.judgedCount,
    coverageSufficient: row.coverageSufficient === 1,
    comparableWindows: row.comparableWindows,
    waitingForTrend: row.waitingForTrend === 1,
    alertId: row.alertId,
  };
}

type RememberedDue =
  | { error: "NOT_FOUND" | "PLAN_PHASE_CONFLICT" | "INVALID_INPUT" }
  | { plan: SamplingPlanRecord; decision: DueDecision; priorIds: Set<string> };

async function rememberDueRows(
  db: DatabaseConnection,
  ownerId: string,
  input: DriveDueWindowInput,
  allowOfficialStart: boolean,
): Promise<RememberedDue> {
  return db.transaction(async (tx) => {
    const plans = new SamplingPlanDao(tx);
    const due = new SamplingDueDao(tx);
    const current = await plans.latest(ownerId, input.planId);
    if (!current) return { error: "NOT_FOUND" as const };
    if (current.phase !== "active") return { error: "PLAN_PHASE_CONFLICT" as const };
    const slots = await plans.slotsForPlans(ownerId, [input.planId]);
    const existing = await due.runsForPlan(ownerId, input.planId);
    const decision = decideDueWindow({
      now: input.now,
      timeZone: input.timezone,
      remainingMinor: current.budgetMinor - current.spentMinor - current.pendingMinor,
      slots: slots.map((slot) => ({
        id: slot.id,
        channelId: slot.channelId,
        at: slot.at,
        status: slot.status,
        manual: slot.manual === 1,
        costMinor: slot.costMinor,
      })),
      channels: input.channels,
      existing: existing.map((row) => ({
        slotId: row.slotId,
        channelId: row.channelId,
        windowId: row.windowId,
        status: row.status,
      })),
      promptIds: input.promptIds,
      allowOfficialStart,
    });
    if (decision.invalid) return { error: "INVALID_INPUT" as const };
    const prompts = new PromptDao(tx, current.brandId);
    const requestedSet = input.promptSetId ? await prompts.version(input.promptSetId) : null;
    if (input.promptSetId && !requestedSet) return { error: "INVALID_INPUT" as const };
    let frozenSet = requestedSet;
    if (decision.manuals.length > 0) {
      if (new Set(input.promptIds).size !== input.promptIds.length) return { error: "INVALID_INPUT" as const };
      frozenSet ??= await prompts.latestVersion();
      if (!frozenSet) return { error: "INVALID_INPUT" as const };
      const allowed = new Set(
        frozenSet.content.questions
          .filter((question) => question.status === "confirmed")
          .map((question) => question.id),
      );
      if (input.promptIds.some((id) => !allowed.has(id))) return { error: "INVALID_INPUT" as const };
    }
    const pauseIds = decision.pauses.map((pause) => pause.id);
    if (pauseIds.length > 0) await plans.pauseSlots(ownerId, input.planId, pauseIds);
    const knownIds = new Set(existing.map((row) => row.id));
    for (const sheet of decision.manuals) {
      if (!frozenSet) return { error: "INVALID_INPUT" as const };
      const row: SamplingDueRunRecord = {
        id: randomUUID(),
        planId: current.id,
        planVersion: current.version,
        brandId: current.brandId,
        ownerId,
        channelId: sheet.channelId,
        windowId: sheet.windowId,
        slotId: sheet.slotId,
        timezone: input.timezone,
        kind: "manual",
        status: "sheet",
        monitoringRunId: null,
        chargedMinor: 0,
        promptSetId: frozenSet.id,
        promptSetVersion: frozenSet.version,
        promptIdsJson: JSON.stringify(sheet.promptIds),
        createdAt: input.now,
      };
      await due.insertRun(row);
      knownIds.add(row.id);
    }
    for (const start of decision.official) {
      const row: SamplingDueRunRecord = {
        id: randomUUID(),
        planId: current.id,
        planVersion: current.version,
        brandId: current.brandId,
        ownerId,
        channelId: start.channelId,
        windowId: start.windowId,
        slotId: start.slotId,
        timezone: input.timezone,
        kind: "official",
        status: "reserved",
        monitoringRunId: null,
        chargedMinor: 0,
        promptSetId: null,
        promptSetVersion: null,
        promptIdsJson: null,
        createdAt: input.now,
      };
      await due.insertRun(row);
      knownIds.add(row.id);
    }
    return {
      plan: current,
      decision,
      priorIds: new Set(existing.map((row) => row.id)),
    };
  });
}

async function finishOfficial(
  db: DatabaseConnection,
  ownerId: string,
  planId: string,
  executor: DueOfficialExecutor,
) {
  const pending = (await new SamplingDueDao(db).runsForPlan(ownerId, planId)).filter((row) => row.status === "reserved");
  if (pending.length === 0) return;
  const slots = await new SamplingPlanDao(db).slotsForPlans(ownerId, [planId]);
  const costById = new Map(slots.map((slot) => [slot.id, slot.costMinor]));
  for (const row of pending) {
    const receipt = await executor({
      dueId: row.id,
      slotId: row.slotId,
      channelId: row.channelId,
      windowId: row.windowId,
      planVersion: row.planVersion,
      costMinor: costById.get(row.slotId) ?? 0,
    });
    await db.transaction(async (tx) => {
      const accepted = await new SamplingDueDao(tx).acceptRun(ownerId, row.id, receipt.runId, receipt.chargedMinor);
      if (accepted) await new SamplingPlanDao(tx).completeSlots(ownerId, planId, [row.slotId]);
    });
  }
}

function latestAnalysis(rows: readonly { observationId: string; version: number; recommended: "true" | "false" | "unknown" }[]) {
  const byObservation = new Map<string, { version: number; recommended: "true" | "false" | "unknown" }>();
  for (const row of rows) {
    const current = byObservation.get(row.observationId);
    if (!current || row.version > current.version) byObservation.set(row.observationId, row);
  }
  return byObservation;
}

async function loadFacts(
  due: SamplingDueDao,
  ownerId: string,
  brandId: string,
  timezone: string,
  slots: readonly SamplingSlotRecord[],
  runs: readonly SamplingDueRunRecord[],
) {
  const accepted = runs.filter((row) => row.status === "accepted" && row.monitoringRunId);
  const runIds = [...new Set(accepted.map((row) => row.monitoringRunId).filter((id): id is string => Boolean(id)))];
  const monitorSlots = await due.runSlots(brandId, runIds);
  const windowByRun = new Map(accepted.map((row) => [row.monitoringRunId, row.windowId]));
  const windowByMonitorSlot = new Map(monitorSlots.map((slot) => [slot.id, windowByRun.get(slot.runId) ?? ""]));
  const sourced: Array<{
    id: string;
    windowId: string;
    evidenceState: string;
    citationSetState: string;
    requestedNetworkMode: string;
    networkTrigger: string;
  }> = [];
  if (monitorSlots.length > 0) {
    const linked = await due.observationsForSlots(ownerId, brandId, monitorSlots.map((slot) => slot.id));
    for (const row of linked) {
      const windowId = row.slotId ? windowByMonitorSlot.get(row.slotId) : undefined;
      if (!windowId) continue;
      sourced.push({ ...row, windowId });
    }
  } else {
    const windowIds = [...new Set(slots.map((slot) => localWindowId(slot.at, timezone)).filter((id): id is string => Boolean(id)))];
    for (const windowId of windowIds) {
      const bounds = windowBounds(windowId, timezone);
      if (!bounds) continue;
      const rows = await due.observationsBetween(ownerId, brandId, bounds.start, bounds.end);
      sourced.push(...rows.map((row) => ({ ...row, windowId })));
    }
  }
  const analyses = latestAnalysis(await due.analysesFor(brandId, [...new Set(sourced.map((row) => row.id))]));
  const facts = new Map<string, ObservationFact[]>();
  for (const row of sourced) {
    const list = facts.get(row.windowId) ?? [];
    list.push({
      windowId: row.windowId,
      evidenceState: row.evidenceState,
      citationSetState: row.citationSetState,
      requestedNetworkMode: row.requestedNetworkMode,
      networkTrigger: row.networkTrigger,
      recommended: analyses.get(row.id)?.recommended ?? null,
    });
    facts.set(row.windowId, list);
  }
  return { facts, monitorSlots, accepted };
}

/** Resolve each saved manual sheet against the frozen question set it was created with. */
export async function manualSheetsForBrand(
  db: DatabaseConnection,
  brandId: string,
  runs: readonly DueWindowRunView[],
) {
  const manuals = runs.filter((run) => run.kind === "manual");
  const promptSetIds = [...new Set(manuals.map((run) => run.promptSetId).filter((id): id is string => Boolean(id)))];
  const sources = promptSetIds.length > 0
    ? await new PromptDao(db, brandId).clusterSources(promptSetIds)
    : new Map();
  return manuals.map((run) => {
    const source = run.promptSetId ? sources.get(run.promptSetId) ?? null : null;
    const versionVerified = Boolean(
      source && run.promptSetId && run.promptSetVersion !== null && source.version === run.promptSetVersion,
    );
    const saved = new Map<string, string>();
    if (versionVerified && source) {
      for (const question of source.questions) saved.set(question.id, question.text);
    }
    return {
      runId: run.id,
      planId: run.planId,
      slotId: run.slotId,
      promptSetId: versionVerified && source ? source.id : run.promptSetId,
      promptSetVersion: versionVerified && source ? source.version : run.promptSetVersion,
      versionVerified,
      ...manualSheetLines(run.promptIds, saved),
    };
  });
}

export async function listSamplingDueWindows(db: DatabaseConnection, ownerId: string, planIds: readonly string[]) {
  const due = new SamplingDueDao(db);
  const [runs, readings] = await Promise.all([
    due.runsForPlans(ownerId, planIds),
    due.readingsForPlans(ownerId, planIds),
  ]);
  return {
    runs: runs.map((row) => toRunView(row, false)),
    readings: readings.map(toReadingView),
  };
}

export async function driveDueSamplingWindow(
  db: DatabaseConnection,
  ownerId: string,
  input: DriveDueWindowInput,
  executor?: DueOfficialExecutor,
): Promise<DueDriveResult | Failure> {
  const parsed = driveDueWindowSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  try {
    return await driveParsed(db, ownerId, parsed.data, executor);
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    return driveParsed(db, ownerId, parsed.data, executor);
  }
}

async function driveParsed(
  db: DatabaseConnection,
  ownerId: string,
  input: DriveDueWindowInput,
  executor: DueOfficialExecutor | undefined,
): Promise<DueDriveResult | Failure> {
  const saved = await rememberDueRows(db, ownerId, input, Boolean(executor));
  if ("error" in saved) return saved;
  if (executor) await finishOfficial(db, ownerId, input.planId, executor);
  const due = new SamplingDueDao(db);
  const plans = new SamplingPlanDao(db);
  const [runs, slots, versions] = await Promise.all([
    due.runsForPlan(ownerId, input.planId),
    plans.slotsForPlans(ownerId, [input.planId]),
    plans.versions(ownerId, input.planId),
  ]);
  const evidence = await loadFacts(due, ownerId, saved.plan.brandId, input.timezone, slots, runs);
  const statusById = new Map(slots.map((slot) => [slot.id, slot.status]));
  const groups = new Map<string, SamplingSlotRecord[]>();
  for (const slot of slots) {
    const windowId = localWindowId(slot.at, input.timezone);
    if (!windowId || slot.at > input.now) continue;
    const list = groups.get(windowId) ?? [];
    list.push(slot);
    groups.set(windowId, list);
  }
  const latestWindowId = [...groups.keys()].sort().at(-1);
  const windowEnd = latestWindowId ? windowBounds(latestWindowId, input.timezone)?.end : undefined;
  const thresholdPp = trendThresholdForWindow(
    (versions.length > 0 ? versions : [saved.plan]).map((row) => ({
      version: row.version,
      createdAt: row.createdAt,
      trendThresholdPp: row.trendThresholdPp,
    })),
    windowEnd ?? input.now,
  );
  const built = buildWindowReadings({
    thresholdPp,
    windows: [...groups.entries()].map(([windowId, windowSlots]) => {
      const backed = new Set(evidence.accepted.filter((row) => row.windowId === windowId).map((row) => row.slotId));
      const monitorCount = evidence.monitorSlots.filter((slot) => {
        const runWindow = evidence.accepted.find((row) => row.monitoringRunId === slot.runId)?.windowId;
        return runWindow === windowId;
      }).length;
      const uncovered = windowSlots.filter((slot) => !backed.has(slot.id)).length;
      return {
        windowId,
        statuses: windowSlots.map((slot) => statusById.get(slot.id) ?? slot.status),
        plannedCount: monitorCount > 0 ? monitorCount + uncovered : windowSlots.length,
        observations: evidence.facts.get(windowId) ?? [],
      };
    }),
  });
  const now = input.now;
  for (const reading of built.readings) {
    const row: SamplingWindowReadingRecord = {
      id: randomUUID(),
      planId: input.planId,
      brandId: saved.plan.brandId,
      ownerId,
      windowId: reading.windowId,
      timezone: input.timezone,
      plannedCount: reading.plannedCount,
      eligibleCount: reading.eligibleCount,
      recommendedCount: reading.recommendedCount,
      judgedCount: reading.judgedCount,
      coverageSufficient: reading.coverageSufficient ? 1 : 0,
      comparableWindows: reading.comparableWindows,
      waitingForTrend: reading.waitingForTrend ? 1 : 0,
      alertId: null,
      createdAt: now,
      updatedAt: now,
    };
    await due.upsertReading(row);
  }
  let alert: DueDriveResult["alert"] = null;
  if (built.alertKind !== "none" && built.samples.length > 0) {
    const recorded = await recordQualityAlert(db, ownerId, {
      action: "record",
      brandId: saved.plan.brandId,
      windows: built.samples,
    }, () => now, thresholdPp);
    if ("alert" in recorded && recorded.recorded) {
      alert = {
        id: recorded.alert.id,
        kind: recorded.alert.kind,
        created: recorded.created,
        claimBrandDecline: recorded.alert.claimBrandDecline,
      };
      await due.setReadingAlert(ownerId, input.planId, recorded.alert.windowId, recorded.alert.id, now);
    }
  }
  const readings = await due.readingsForPlans(ownerId, [input.planId]);
  const prior = saved.priorIds;
  return {
    planId: input.planId,
    version: saved.plan.version,
    pausedBudgetIds: saved.decision.pauses.filter((pause) => pause.reason === "budget").map((pause) => pause.id),
    pausedChannelIds: saved.decision.pauses.filter((pause) => pause.reason === "channel").map((pause) => pause.id),
    runs: runs.map((row) => toRunView(row, prior.has(row.id) && row.status !== "reserved")),
    readings: readings.map(toReadingView),
    pendingOfficialSlotIds: slots
      .filter((slot) => slot.manual === 0 && slot.status === "scheduled" && slot.at <= input.now)
      .map((slot) => slot.id),
    coverageSlotIds: coverageDenominator(slots.map((slot) => ({
      id: slot.id,
      channelId: slot.channelId,
      at: slot.at,
      status: slot.status,
      manual: slot.manual === 1,
    }))).map((slot) => slot.id),
    alert,
  };
}
