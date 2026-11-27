import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { PromptDao } from "../prompts/dao.ts";
import { recordQualityAlert } from "../quality-alerts/commands.ts";
import { QualityAlertDao, type QualityAlertRecord } from "../quality-alerts/dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { authorizeSamplingPlanWrite } from "./commands.ts";
import type { SamplingPlanError, DriveDueWindowInput } from "./contracts.ts";
import { driveDueWindowSchema, windowIdSchema } from "./contracts.ts";
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
  | { error: "NOT_FOUND" | "FORBIDDEN" | "PLAN_PHASE_CONFLICT" | "INVALID_INPUT" }
  | { plan: SamplingPlanRecord; decision: DueDecision; priorIds: Set<string> };

async function rememberDueRows(
  db: DatabaseConnection,
  actorId: string,
  input: DriveDueWindowInput,
  allowOfficialStart: boolean,
  officialSlotId?: string,
): Promise<RememberedDue> {
  return db.transaction(async (tx) => {
    const access = await authorizeSamplingPlanWrite(tx, actorId, input.planId);
    if ("error" in access) return access;
    const ownerId = access.ownerId;
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
      ...(officialSlotId ? { officialSlotId } : {}),
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
  onlySlotId?: string,
) {
  const pending = (await new SamplingDueDao(db).runsForPlan(ownerId, planId)).filter((row) => (
    row.status === "reserved" && (onlySlotId === undefined || row.slotId === onlySlotId)
  ));
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

export async function listSamplingDueWindows(db: DatabaseConnection, actorId: string, planIds: readonly string[]) {
  if (planIds.length === 0) return { runs: [], readings: [] };
  const identities = await new SamplingPlanDao(db).planIdentities(planIds);
  if (identities.length === 0) return { runs: [], readings: [] };
  const brandIds = [...new Set(identities.map((item) => item.brandId))];
  const scopes = await Promise.all(
    brandIds.map(async (brandId) => [brandId, await authorizeBrandActor(db, actorId, brandId, "read")] as const),
  );
  const scopeByBrand = new Map(scopes);
  const plansByOwner = new Map<string, string[]>();
  for (const identity of identities) {
    const scope = scopeByBrand.get(identity.brandId);
    if (!scope) continue;
    const list = plansByOwner.get(scope.ownerId) ?? [];
    list.push(identity.id);
    plansByOwner.set(scope.ownerId, list);
  }
  if (plansByOwner.size === 0) return { runs: [], readings: [] };
  const due = new SamplingDueDao(db);
  const batches = await Promise.all([...plansByOwner.entries()].map(async ([ownerId, ids]) => {
    const [runs, readings] = await Promise.all([
      due.runsForPlans(ownerId, ids),
      due.readingsForPlans(ownerId, ids),
    ]);
    return { runs, readings };
  }));
  return {
    runs: batches.flatMap((batch) => batch.runs).map((row) => toRunView(row, false)),
    readings: batches.flatMap((batch) => batch.readings).map(toReadingView),
  };
}

export type AlertWindowSourceRun = {
  dueRunId: string;
  slotId: string;
  channelId: string;
  monitoringRunId: string;
  chargedMinor: number;
};

export type AlertWindowSource = {
  alertId: string;
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
  acceptedRuns: AlertWindowSourceRun[];
};

/** Resolve bound plan window readings and accepted official runs for quality alerts. */
export async function listAlertWindowSources(
  db: DatabaseConnection,
  actorId: string,
  brandId: string,
  alertIds: readonly string[],
): Promise<{ sourcesByAlertId: Map<string, AlertWindowSource[]> } | { error: "NOT_FOUND" }> {
  const access = await authorizeBrandActor(db, actorId, brandId, "read");
  if (!access) return { error: "NOT_FOUND" };
  const ownerId = access.ownerId;
  const uniqueAlerts = [...new Set(alertIds)];
  const sourcesByAlertId = new Map<string, AlertWindowSource[]>();
  if (uniqueAlerts.length === 0) return { sourcesByAlertId };
  const due = new SamplingDueDao(db);
  const readings = await due.readingsForAlerts(ownerId, brandId, uniqueAlerts);
  if (readings.length === 0) return { sourcesByAlertId };
  const planIds = [...new Set(readings.map((row) => row.planId))];
  const windowIds = [...new Set(readings.map((row) => row.windowId))];
  const runs = await due.runsForWindows(ownerId, planIds, windowIds);
  const acceptedByWindow = new Map<string, AlertWindowSourceRun[]>();
  for (const run of runs) {
    if (run.kind !== "official" || run.status !== "accepted" || !run.monitoringRunId) continue;
    const key = `${run.planId}\u0000${run.windowId}`;
    const list = acceptedByWindow.get(key) ?? [];
    list.push({
      dueRunId: run.id,
      slotId: run.slotId,
      channelId: run.channelId,
      monitoringRunId: run.monitoringRunId,
      chargedMinor: run.chargedMinor,
    });
    acceptedByWindow.set(key, list);
  }
  for (const reading of readings) {
    if (!reading.alertId) continue;
    const key = `${reading.planId}\u0000${reading.windowId}`;
    const list = sourcesByAlertId.get(reading.alertId) ?? [];
    list.push({
      alertId: reading.alertId,
      planId: reading.planId,
      windowId: reading.windowId,
      timezone: reading.timezone,
      plannedCount: reading.plannedCount,
      eligibleCount: reading.eligibleCount,
      recommendedCount: reading.recommendedCount,
      judgedCount: reading.judgedCount,
      coverageSufficient: reading.coverageSufficient === 1,
      comparableWindows: reading.comparableWindows,
      waitingForTrend: reading.waitingForTrend === 1,
      acceptedRuns: acceptedByWindow.get(key) ?? [],
    });
    sourcesByAlertId.set(reading.alertId, list);
  }
  return { sourcesByAlertId };
}

export type SamplingWindowAcceptedRunDetail = {
  dueRunId: string;
  slotId: string;
  channelId: string;
  monitoringRunId: string;
  chargedMinor: number;
  runStatus: string | null;
  slotCount: number;
  succeededSlotCount: number;
  failedSlotCount: number;
  observationCount: number;
};

export type SamplingWindowDetail = {
  brandId: string;
  brandName: string | null;
  plan: {
    id: string;
    version: number;
    phase: SamplingPlanRecord["phase"];
    currency: string;
  };
  reading: DueWindowReadingView;
  alert: {
    id: string;
    kind: QualityAlertRecord["kind"];
    reason: QualityAlertRecord["reason"];
    status: QualityAlertRecord["status"];
    claimBrandDecline: boolean;
  } | null;
  slots: Array<{
    id: string;
    channelId: string;
    at: string;
    status: SamplingSlotRecord["status"];
    manual: boolean;
    costMinor: number;
  }>;
  acceptedRuns: SamplingWindowAcceptedRunDetail[];
  reservedRuns: DueWindowRunView[];
  manualSheets: Awaited<ReturnType<typeof manualSheetsForBrand>>;
};

/** Read one owned plan window, its retained slots in P, and runs linked strictly to that window. */
export async function readSamplingWindowDetail(
  db: DatabaseConnection,
  actorId: string,
  planId: string,
  windowId: string,
): Promise<{ detail: SamplingWindowDetail } | { error: "NOT_FOUND" }> {
  const parsedPlan = brandIdSchema.safeParse(planId);
  const parsedWindow = windowIdSchema.safeParse(windowId);
  if (!parsedPlan.success || !parsedWindow.success) return { error: "NOT_FOUND" };
  const due = new SamplingDueDao(db);
  const plans = new SamplingPlanDao(db);
  const identity = await plans.planIdentity(parsedPlan.data);
  if (!identity) return { error: "NOT_FOUND" };
  const access = await authorizeBrandActor(db, actorId, identity.brandId, "read");
  if (!access) return { error: "NOT_FOUND" };
  const ownerId = access.ownerId;
  const reading = await due.readingForWindow(ownerId, parsedPlan.data, parsedWindow.data);
  if (!reading) return { error: "NOT_FOUND" };
  const [versions, allSlots, dueRuns, ownedBrand, brandVersion, linkedAlert] = await Promise.all([
    plans.versions(ownerId, parsedPlan.data),
    plans.slotsForPlans(ownerId, [parsedPlan.data]),
    due.runsForWindow(ownerId, parsedPlan.data, parsedWindow.data),
    new BrandDao(db).owned(ownerId, reading.brandId),
    new BrandDao(db).version(ownerId, reading.brandId),
    reading.alertId ? new QualityAlertDao(db).alertForOwner(ownerId, reading.alertId) : Promise.resolve(null),
  ]);
  const latestPlan = versions[versions.length - 1];
  if (!latestPlan || !ownedBrand) return { error: "NOT_FOUND" };
  const windowSlots = allSlots
    .filter((slot) => localWindowId(slot.at, reading.timezone) === reading.windowId)
    .map((slot) => ({
      id: slot.id,
      channelId: slot.channelId,
      at: slot.at,
      status: slot.status,
      manual: slot.manual === 1,
      costMinor: slot.costMinor,
    }));
  const runViews = dueRuns.map((row) => toRunView(row, false));
  const accepted = dueRuns.filter((row) => row.kind === "official" && row.status === "accepted" && row.monitoringRunId);
  const reservedRuns = runViews.filter((row) => row.kind === "official" && row.status === "reserved");
  const manualRuns = runViews.filter((row) => row.kind === "manual");
  const manualSheets = await manualSheetsForBrand(db, reading.brandId, manualRuns);
  const runIds = [...new Set(accepted.map((row) => row.monitoringRunId).filter((id): id is string => Boolean(id)))];
  const [monitoringRuns, runSlots] = runIds.length > 0
    ? await Promise.all([
      due.monitoringRunsByIds(ownerId, reading.brandId, runIds),
      due.runSlotSummaries(reading.brandId, runIds),
    ])
    : [[], []];
  const observations = runSlots.length > 0
    ? await due.observationLinksForSlots(ownerId, reading.brandId, runSlots.map((slot) => slot.id))
    : [];
  const runById = new Map(monitoringRuns.map((row) => [row.id, row]));
  const slotsByRun = new Map<string, typeof runSlots>();
  for (const slot of runSlots) {
    const list = slotsByRun.get(slot.runId) ?? [];
    list.push(slot);
    slotsByRun.set(slot.runId, list);
  }
  const observedSlots = new Set(observations.map((row) => row.slotId).filter((id): id is string => Boolean(id)));
  const acceptedRuns: SamplingWindowAcceptedRunDetail[] = accepted.map((row) => {
    const runId = row.monitoringRunId as string;
    const summary = runById.get(runId) ?? null;
    const linkedSlots = slotsByRun.get(runId) ?? [];
    return {
      dueRunId: row.id,
      slotId: row.slotId,
      channelId: row.channelId,
      monitoringRunId: runId,
      chargedMinor: row.chargedMinor,
      runStatus: summary?.status ?? null,
      slotCount: summary?.slotCount ?? linkedSlots.length,
      succeededSlotCount: linkedSlots.filter((slot) => slot.status === "succeeded").length,
      failedSlotCount: linkedSlots.filter((slot) => slot.status === "failed").length,
      observationCount: linkedSlots.filter((slot) => observedSlots.has(slot.id)).length,
    };
  });
  return {
    detail: {
      brandId: reading.brandId,
      brandName: brandVersion?.fields.name ?? null,
      plan: {
        id: latestPlan.id,
        version: latestPlan.version,
        phase: latestPlan.phase,
        currency: latestPlan.currency,
      },
      reading: toReadingView(reading),
      alert: linkedAlert ? {
        id: linkedAlert.id,
        kind: linkedAlert.kind,
        reason: linkedAlert.reason,
        status: linkedAlert.status,
        claimBrandDecline: linkedAlert.claimBrandDecline === 1,
      } : null,
      slots: windowSlots,
      acceptedRuns,
      reservedRuns,
      manualSheets,
    },
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

/** Runs the authorized member can register onto a due official slot without calling the provider again. */
export async function listAttachableOfficialRuns(db: DatabaseConnection, actorId: string, brandId: string) {
  const access = await authorizeBrandActor(db, actorId, brandId, "read");
  if (!access) return [];
  return new SamplingDueDao(db).attachableOfficialRuns(access.ownerId, brandId);
}

async function prepareExistingRun(
  db: DatabaseConnection,
  actorId: string,
  input: DriveDueWindowInput,
): Promise<
  | { error: "NOT_FOUND" | "FORBIDDEN" | "PLAN_PHASE_CONFLICT" | "EXISTING_RUN_REJECTED" | "INVALID_INPUT" }
  | { replay: true }
  | { slotId: string; receipt: Awaited<ReturnType<SamplingDueDao["attachableOfficialRuns"]>>[number] }
> {
  if (!input.existingRunId) return { error: "INVALID_INPUT" };
  const access = await authorizeSamplingPlanWrite(db, actorId, input.planId);
  if ("error" in access) return access;
  const ownerId = access.ownerId;
  const plans = new SamplingPlanDao(db);
  const due = new SamplingDueDao(db);
  const current = await plans.latest(ownerId, input.planId);
  if (!current) return { error: "NOT_FOUND" };
  if (current.phase !== "active") return { error: "PLAN_PHASE_CONFLICT" };
  const [receipt] = await due.attachableOfficialRuns(ownerId, current.brandId, input.existingRunId);
  if (!receipt) return { error: "EXISTING_RUN_REJECTED" };
  const linked = await due.dueRunsForMonitoringRun(ownerId, current.brandId, receipt.id);
  if (linked.length > 1) return { error: "EXISTING_RUN_REJECTED" };
  const [existing] = linked;
  if (existing && existing.planId !== current.id) return { error: "EXISTING_RUN_REJECTED" };
  if (existing) return { replay: true };
  const gate = input.channels.find((channel) => channel.channelId === receipt.channelId);
  if (input.channels.length > 0 && gate?.state !== "eligible") return { error: "EXISTING_RUN_REJECTED" };
  const runWindow = localWindowId(receipt.createdAt, input.timezone);
  if (!runWindow) return { error: "INVALID_INPUT" };
  const remaining = current.budgetMinor - current.spentMinor - current.pendingMinor;
  const slots = await plans.slotsForPlans(ownerId, [current.id]);
  const target = slots
    .filter((slot) => (
      slot.manual === 0
      && slot.status === "scheduled"
      && slot.at <= input.now
      && slot.channelId === receipt.channelId
      && slot.costMinor <= remaining
      && localWindowId(slot.at, input.timezone) === runWindow
    ))
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))[0];
  if (!target) return { error: "EXISTING_RUN_REJECTED" };
  return { slotId: target.id, receipt };
}

async function driveParsed(
  db: DatabaseConnection,
  actorId: string,
  input: DriveDueWindowInput,
  executor: DueOfficialExecutor | undefined,
): Promise<DueDriveResult | Failure> {
  if (input.existingRunId && executor) return { error: "INVALID_INPUT" };
  const initialAccess = await authorizeSamplingPlanWrite(db, actorId, input.planId);
  if ("error" in initialAccess) return initialAccess;
  const adoption = input.existingRunId
    ? await prepareExistingRun(db, actorId, input)
    : null;
  if (adoption && "error" in adoption) return adoption;
  const adopting = adoption && "receipt" in adoption ? adoption : null;
  const activeExecutor = adopting
    ? async (start: Parameters<DueOfficialExecutor>[0]) => {
      if (start.slotId !== adopting.slotId || start.channelId !== adopting.receipt.channelId) {
        throw new Error("EXISTING_RUN_SLOT_MISMATCH");
      }
      return { runId: adopting.receipt.id, chargedMinor: adopting.receipt.knownMinor };
    }
    : executor;
  const saved = await rememberDueRows(db, actorId, input, Boolean(activeExecutor), adopting?.slotId);
  if ("error" in saved) return saved;
  const ownerId = saved.plan.ownerId;
  if (activeExecutor) await finishOfficial(db, ownerId, input.planId, activeExecutor, adopting?.slotId);
  const due = new SamplingDueDao(db);
  const plans = new SamplingPlanDao(db);
  const [runs, slots, versions] = await Promise.all([
    due.runsForPlan(ownerId, input.planId),
    plans.slotsForPlans(ownerId, [input.planId]),
    plans.versions(ownerId, input.planId),
  ]);
  if (
    input.existingRunId
    && !runs.some((row) => row.monitoringRunId === input.existingRunId && row.status === "accepted")
  ) {
    return { error: "EXISTING_RUN_REJECTED" };
  }
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
