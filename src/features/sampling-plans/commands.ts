import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type {
  ArriveSamplingPlanInput,
  CreateSamplingPlan,
  ExpireSamplingChannelInput,
  ReviseSamplingBudgetInput,
  SamplingPlanError,
  SetSamplingTrendThresholdInput,
  TransitionSamplingPlanInput,
} from "./contracts.ts";
import { SamplingPlanDao, type SamplingPlanRecord, type SamplingSlotRecord } from "./dao.ts";
import {
  coverageDenominator,
  pauseIneligibleChannel,
  pauseUnaffordableSlots,
  reviseBudget,
  transitionPlan,
  type SamplingSlot,
} from "./rules.ts";

type Clock = () => string;
type Failure = { error: SamplingPlanError };

const systemClock: Clock = () => new Date().toISOString();

class SamplingPlanWriteConflict extends Error {
  constructor() {
    super("sampling-plan-version-conflict");
    this.name = "SamplingPlanWriteConflict";
  }
}

function versionConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE|PRIMARY KEY|duplicate key/i.test(message);
}

function toRuleSlot(slot: SamplingSlotRecord): SamplingSlot {
  return {
    id: slot.id,
    channelId: slot.channelId,
    at: slot.at,
    status: slot.status,
    manual: slot.manual === 1,
  };
}

function toPublicSlot(slot: SamplingSlotRecord) {
  return {
    id: slot.id,
    channelId: slot.channelId,
    at: slot.at,
    status: slot.status,
    manual: slot.manual === 1,
    costMinor: slot.costMinor,
  };
}

export type SamplingPlanView = {
  id: string;
  brandId: string;
  version: number;
  phase: SamplingPlanRecord["phase"];
  currency: string;
  budgetMinor: number;
  spentMinor: number;
  pendingMinor: number;
  trendThresholdPp: number;
  createdAt: string;
  versions: Array<{
    version: number;
    budgetMinor: number;
    currency: string;
    phase: SamplingPlanRecord["phase"];
    trendThresholdPp: number;
    createdAt: string;
  }>;
  slots: Array<{
    id: string;
    channelId: string;
    at: string;
    status: SamplingSlotRecord["status"];
    manual: boolean;
    costMinor: number;
  }>;
  coverageSlotIds: string[];
};

function manualBit(manual: boolean): 0 | 1 {
  return manual ? 1 : 0;
}

function toView(versions: readonly SamplingPlanRecord[], slots: readonly SamplingSlotRecord[]): SamplingPlanView {
  const current = versions[versions.length - 1];
  if (!current) throw new Error("Sampling plan version is missing");
  const visible = slots.map(toPublicSlot);
  return {
    id: current.id,
    brandId: current.brandId,
    version: current.version,
    phase: current.phase,
    currency: current.currency,
    budgetMinor: current.budgetMinor,
    spentMinor: current.spentMinor,
    pendingMinor: current.pendingMinor,
    trendThresholdPp: current.trendThresholdPp,
    createdAt: current.createdAt,
    versions: versions.map((row) => ({
      version: row.version,
      budgetMinor: row.budgetMinor,
      currency: row.currency,
      phase: row.phase,
      trendThresholdPp: row.trendThresholdPp,
      createdAt: row.createdAt,
    })),
    slots: visible,
    coverageSlotIds: coverageDenominator(visible).map((slot) => slot.id),
  };
}

function applyAffordability(
  slots: readonly SamplingSlotRecord[],
  plan: { budgetMinor: number; spentMinor: number; pendingMinor: number },
  nextAt: string,
) {
  const view = slots.map(toRuleSlot);
  const next = view
    .filter((slot) => slot.status === "scheduled" && slot.at >= nextAt)
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))[0];
  if (!next) return { slots: [...slots], pausedIds: [] as string[] };
  const cost = slots.find((slot) => slot.id === next.id)?.costMinor ?? 0;
  const paused = pauseUnaffordableSlots(view, {
    spentMinor: plan.spentMinor,
    pendingMinor: plan.pendingMinor,
    budgetMinor: plan.budgetMinor,
    nextAt,
    slotCostMinor: cost,
  });
  const statusById = new Map(paused.slots.map((slot) => [slot.id, slot.status]));
  return {
    slots: slots.map((slot) => ({ ...slot, status: statusById.get(slot.id) ?? slot.status })),
    pausedIds: paused.pausedIds,
  };
}

function duplicateSlotIds(slots: readonly { id: string }[]) {
  return new Set(slots.map((slot) => slot.id)).size !== slots.length;
}

function finiteThreshold(value: number | undefined, fallback: number) {
  const threshold = value ?? fallback;
  return Number.isFinite(threshold) && threshold > 0 ? threshold : null;
}

export async function listSamplingPlans(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new SamplingPlanDao(db);
  const rows = await dao.plansForBrand(brandId, ownerId);
  const planIds = [...new Set(rows.map((row) => row.id))];
  const slots = await dao.slotsForPlans(ownerId, planIds);
  const grouped = new Map<string, SamplingPlanRecord[]>();
  for (const row of rows) {
    const versions = grouped.get(row.id) ?? [];
    versions.push(row);
    grouped.set(row.id, versions);
  }
  const slotsByPlan = new Map<string, SamplingSlotRecord[]>();
  for (const slot of slots) {
    const list = slotsByPlan.get(slot.planId) ?? [];
    list.push(slot);
    slotsByPlan.set(slot.planId, list);
  }
  return {
    plans: [...grouped.values()].map((versions) => toView(versions, slotsByPlan.get(versions[0]?.id ?? "") ?? [])),
  };
}

export async function readSamplingPlan(db: DatabaseConnection, ownerId: string, planId: string) {
  const dao = new SamplingPlanDao(db);
  const versions = await dao.versions(ownerId, planId);
  if (versions.length === 0) return { error: "NOT_FOUND" as const };
  const slots = await dao.slotsForPlans(ownerId, [planId]);
  return { plan: toView(versions, slots) };
}

export async function readSamplingPlanVersion(db: DatabaseConnection, ownerId: string, planId: string, version: number) {
  const row = await new SamplingPlanDao(db).version(ownerId, planId, version);
  if (!row) return { error: "NOT_FOUND" as const };
  return {
    version: row.version,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    phase: row.phase,
    trendThresholdPp: row.trendThresholdPp,
  };
}

export async function saveSamplingPlan(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateSamplingPlan,
  clock: Clock = systemClock,
) {
  if (duplicateSlotIds(input.slots)) return { error: "INVALID_INPUT" as const };
  const trendThresholdPp = finiteThreshold(input.trendThresholdPp, 10);
  if (trendThresholdPp === null) return { error: "INVALID_INPUT" as const };
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new SamplingPlanDao(tx);
    const now = clock();
    const planId = randomUUID();
    const draft: SamplingPlanRecord = {
      id: planId,
      version: 1,
      brandId: input.brandId,
      ownerId,
      phase: input.phase,
      currency: input.currency,
      budgetMinor: input.budgetMinor,
      spentMinor: input.spentMinor,
      pendingMinor: input.pendingMinor,
      trendThresholdPp,
      createdAt: now,
    };
    const slots: SamplingSlotRecord[] = input.slots.map((slot) => ({
      id: slot.id,
      planId,
      brandId: input.brandId,
      ownerId,
      channelId: slot.channelId,
      at: slot.at,
      status: slot.status,
      manual: manualBit(slot.manual),
      costMinor: slot.costMinor,
    }));
    const paused = applyAffordability(slots, draft, input.nextAt);
    await dao.insertPlan(draft);
    await dao.insertSlots(paused.slots);
    return { plan: toView([draft], paused.slots) };
  });
}

async function persistPause(
  dao: SamplingPlanDao,
  ownerId: string,
  planId: string,
  pausedIds: readonly string[],
  channelId?: string,
) {
  if (pausedIds.length === 0) return;
  await dao.pauseSlots(ownerId, planId, pausedIds, channelId);
}

export async function arriveAtSamplingWindow(
  db: DatabaseConnection,
  ownerId: string,
  input: ArriveSamplingPlanInput,
) {
  return db.transaction(async (tx) => {
    const dao = new SamplingPlanDao(tx);
    const current = await dao.latest(ownerId, input.planId);
    if (!current) return { error: "NOT_FOUND" as const };
    const slots = await dao.slotsForPlans(ownerId, [input.planId]);
    const paused = applyAffordability(slots, current, input.nextAt);
    await persistPause(dao, ownerId, input.planId, paused.pausedIds);
    const versions = await dao.versions(ownerId, input.planId);
    return { plan: toView(versions, paused.slots), pausedIds: paused.pausedIds };
  });
}

export async function pauseExpiredSamplingChannel(
  db: DatabaseConnection,
  ownerId: string,
  input: ExpireSamplingChannelInput,
) {
  return db.transaction(async (tx) => {
    const dao = new SamplingPlanDao(tx);
    const current = await dao.latest(ownerId, input.planId);
    if (!current) return { error: "NOT_FOUND" as const };
    const slots = await dao.slotsForPlans(ownerId, [input.planId]);
    const view = slots.map(toRuleSlot);
    const next = pauseIneligibleChannel(view, { channelId: input.channelId, nextAt: input.nextAt });
    const pausedIds = next
      .filter((slot, index) => slot.status === "paused" && view[index]?.status !== "paused")
      .map((slot) => slot.id);
    const statusById = new Map(next.map((slot) => [slot.id, slot.status]));
    const updated = slots.map((slot) => ({ ...slot, status: statusById.get(slot.id) ?? slot.status }));
    await persistPause(dao, ownerId, input.planId, pausedIds, input.channelId);
    return { plan: toView([current], updated), pausedIds };
  });
}

export async function transitionSamplingPlan(
  db: DatabaseConnection,
  ownerId: string,
  input: TransitionSamplingPlanInput,
) {
  return db.transaction(async (tx) => {
    const dao = new SamplingPlanDao(tx);
    const current = await dao.latest(ownerId, input.planId);
    if (!current) return { error: "NOT_FOUND" as const };
    const next = transitionPlan(current.phase, input.phase);
    if (!next) return { error: "PLAN_PHASE_CONFLICT" as const };
    const saved = await dao.setPhase(ownerId, current.id, current.version, next);
    if (!saved) return { error: "NOT_FOUND" as const };
    return { plan: { id: current.id, version: current.version, phase: next, trendThresholdPp: current.trendThresholdPp } };
  });
}

export async function saveSamplingTrendThreshold(
  db: DatabaseConnection,
  ownerId: string,
  input: SetSamplingTrendThresholdInput,
) {
  const trendThresholdPp = finiteThreshold(input.trendThresholdPp, Number.NaN);
  if (trendThresholdPp === null) return { error: "INVALID_INPUT" as const };
  return db.transaction(async (tx) => {
    const dao = new SamplingPlanDao(tx);
    const current = await dao.latest(ownerId, input.planId);
    if (!current) return { error: "NOT_FOUND" as const };
    if (current.phase !== "draft") return { error: "PLAN_PHASE_CONFLICT" as const };
    const saved = await dao.setTrendThreshold(ownerId, current.id, current.version, trendThresholdPp);
    if (!saved) return { error: "PLAN_PHASE_CONFLICT" as const };
    const [versions, slots] = await Promise.all([
      dao.versions(ownerId, input.planId),
      dao.slotsForPlans(ownerId, [input.planId]),
    ]);
    return { plan: toView(versions, slots) };
  });
}

export async function reviseSamplingPlanBudget(
  db: DatabaseConnection,
  ownerId: string,
  planId: string,
  input: ReviseSamplingBudgetInput,
  clock: Clock = systemClock,
) {
  try {
    return await db.transaction(async (tx) => {
      const dao = new SamplingPlanDao(tx);
      const current = await dao.latest(ownerId, planId);
      if (!current) return { error: "NOT_FOUND" as const };
      const slots = await dao.slotsForPlans(ownerId, [planId]);
      const trendThresholdPp = finiteThreshold(input.trendThresholdPp, current.trendThresholdPp);
      if (trendThresholdPp === null) return { error: "INVALID_INPUT" as const };
      const revised = reviseBudget({
        version: current.version,
        phase: current.phase,
        budgetMinor: current.budgetMinor,
        failedSlotIds: slots.filter((slot) => slot.status === "failed").map((slot) => slot.id),
      }, input.budgetMinor);
      const next: SamplingPlanRecord = {
        ...current,
        version: revised.version,
        phase: revised.phase,
        budgetMinor: revised.budgetMinor,
        trendThresholdPp,
        createdAt: clock(),
      };
      try {
        await dao.insertPlan(next);
      } catch (error) {
        if (versionConflict(error)) throw new SamplingPlanWriteConflict();
        throw error;
      }
      const paused = input.nextAt ? applyAffordability(slots, next, input.nextAt) : { slots, pausedIds: [] as string[] };
      if (input.nextAt) await persistPause(dao, ownerId, planId, paused.pausedIds);
      const versions = await dao.versions(ownerId, planId);
      return {
        plan: toView(versions, paused.slots),
        failedSlotIds: revised.failedSlotIds,
      };
    });
  } catch (error) {
    if (error instanceof SamplingPlanWriteConflict) return { error: "VERSION_CONFLICT" as const } satisfies Failure;
    throw error;
  }
}
