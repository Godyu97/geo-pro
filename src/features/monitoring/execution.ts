import "server-only";

import { randomUUID } from "node:crypto";
import { queryWithParameters, type DatabaseConnection, type TransactionConnection } from "../../lib/db/connection.ts";
import { officialNetworkFacts, serializeOfficialReceipt, unknownOfficialSample } from "../../lib/ai/official-sampling.ts";
import { CapabilityDao } from "../capabilities/dao.ts";
import { formalRunEligibility } from "../capabilities/rules.ts";
import { QuotaDao } from "../quotas/dao.ts";
import { grantState } from "../quotas/ledger.ts";
import type { MonitoringError, MonitoringNextStep } from "./contracts.ts";
import {
  MonitoringDao,
  type MonitoringAttemptRow,
  type MonitoringRunRow,
  type MonitoringSlotRow,
} from "./dao.ts";
import { PromptDao } from "../prompts/dao.ts";
import {
  type IsolatedSample,
  type OfficialSample,
  type OfficialSamplingPort,
  type SamplingRequest,
} from "./transport.ts";

export type { IsolatedSample } from "./transport.ts";

export type IsolatedTransport = {
  label: "isolated";
  sample(input: SamplingRequest): Promise<IsolatedSample>;
};

type Denied = { error: MonitoringError; next: MonitoringNextStep | null };
type Usage = { startedReservations: number; knownActual: number; pendingUpper: number };
export type ExecutedRun = MonitoringRunRow & {
  slots: MonitoringSlotRow[];
  attempts: MonitoringAttemptRow[];
  replayed: boolean;
  pausedForBudget: boolean;
};

const reservationScope = (brandId: string, reservationId: string) => ({
  brandId, kind: "sampling" as const, reservationId,
});
const attemptScope = (brandId: string, reservationId: string, attemptId: string) => ({
  ...reservationScope(brandId, reservationId), attemptId,
});

function denied(error: MonitoringError, next: MonitoringNextStep | null = null): Denied {
  return { error, next };
}

function isDenied(value: ExecutedRun | Denied): value is Denied {
  return "error" in value;
}

export function rawResultContract(attempt: MonitoringAttemptRow) {
  return {
    attemptId: attempt.id,
    slotId: attempt.slotId,
    runId: attempt.runId,
    synthetic: attempt.synthetic === 1,
    transport: attempt.transport,
    rawText: attempt.rawText,
    adopted: attempt.disposition === "adopted",
    late: attempt.late === 1,
    costState: attempt.costState,
    actualMinor: attempt.actualMinor,
  };
}

function rollup(slots: Array<Pick<MonitoringSlotRow, "status">>): { status: MonitoringRunRow["status"]; samplingComplete: 0 | 1 } {
  const queued = slots.some((slot) => slot.status === "queued");
  const paused = slots.some((slot) => slot.status === "paused");
  const started = slots.some((slot) => slot.status !== "queued" && slot.status !== "paused");
  if (queued && !started && !paused) return { status: "queued", samplingComplete: 0 };
  if (queued || slots.some((slot) => slot.status === "running")) return { status: "running", samplingComplete: 0 };
  if (paused) return { status: "paused", samplingComplete: 0 };
  if (slots.every((slot) => slot.status === "succeeded")) return { status: "succeeded", samplingComplete: 1 };
  if (slots.every((slot) => slot.status === "cancelled")) return { status: "cancelled", samplingComplete: 1 };
  if (slots.every((slot) => slot.status === "failed" || slot.status === "cancelled")) return { status: "failed", samplingComplete: 1 };
  if (slots.every((slot) => slot.status === "succeeded" || slot.status === "cancelled")) return { status: "cancelled", samplingComplete: 1 };
  return { status: "partial", samplingComplete: 1 };
}

async function persist(monitoring: MonitoringDao, ownerId: string, runId: string, replayed: boolean, pausedForBudget = false): Promise<ExecutedRun> {
  const slots = await monitoring.slots([runId]);
  const progress = rollup(slots);
  await monitoring.setRun(runId, progress.status, progress.samplingComplete);
  const run = await monitoring.runForOwner(ownerId, runId);
  if (!run) throw new Error("monitoring-run-missing");
  return { ...run, slots, attempts: await monitoring.attempts([runId]), replayed, pausedForBudget };
}

async function startQuota(quota: QuotaDao, brandId: string, reservationId: string, attemptId: string, upper: number, currency: string, time: string) {
  const scope = { brandId, kind: "sampling" as const, reservationId, attemptId };
  const reservation = await quota.reservation(scope);
  if (!reservation || reservation.state !== "reserved" || reservation.currency !== currency) return "conflict" as const;
  const costs = await quota.attemptTotals(scope);
  if (costs.unresolved) return "unresolved" as const;
  if (costs.actual + upper > reservation.upperMinor) return "over-limit" as const;
  await quota.insertAttempt(scope, upper, time);
  return "applied" as const;
}

function canAdopt(sample: IsolatedSample | OfficialSample, run: MonitoringRunRow) {
  if (sample.disposition !== "adopted" || sample.rawText.length === 0 || sample.rawText.length > 8000) return false;
  if (run.upperMinor !== null && sample.actualMinor > run.upperMinor) return false;
  if (!sample.synthetic && (sample.costState !== "known" || sample.currency !== run.currency)) return false;
  return true;
}

async function applySample(
  monitoring: MonitoringDao,
  quota: QuotaDao,
  run: MonitoringRunRow,
  slot: MonitoringSlotRow,
  attempt: MonitoringAttemptRow,
  sample: IsolatedSample | OfficialSample,
  time: string,
  usage: Usage | null,
) {
  const upper = run.upperMinor ?? 0;
  const paid = Boolean(slot.reservationId && run.currency);
  if (canAdopt(sample, run) && sample.disposition === "adopted") {
    await monitoring.updateAttempt({
      id: attempt.id, disposition: "adopted", rawText: sample.rawText, actualMinor: paid ? sample.actualMinor : null,
      costState: paid ? "known" : "none", late: 0, receipt: sampleReceipt(sample),
    });
    if (paid && slot.reservationId) {
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), sample.actualMinor, time);
      await quota.finalize(reservationScope(run.brandId, slot.reservationId), "settled", time);
      if (usage) {
        usage.pendingUpper -= upper;
        usage.knownActual += sample.actualMinor;
      }
    }
    await monitoring.setSlot(slot.id, "succeeded", attempt.id, 0);
    return;
  }
  if (sample.disposition === "safe_failure") {
    await monitoring.updateAttempt({
      id: attempt.id, disposition: "safe_failure", rawText: null, actualMinor: paid ? 0 : null,
      costState: paid ? "known" : "none", late: 0, receipt: sampleReceipt(sample),
    });
    if (paid && slot.reservationId) {
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), 0, time);
      if (usage) usage.pendingUpper -= upper;
      if (attempt.ordinal >= 3) await quota.finalize(reservationScope(run.brandId, slot.reservationId), "released", time);
    }
    await monitoring.setSlot(slot.id, attempt.ordinal >= 3 ? "failed" : "queued", null, 0);
    return;
  }
  const rawText = sample.synthetic
    ? sample.disposition === "unknown" ? sample.rawText ?? null : null
    : sample.rawText;
  await monitoring.updateAttempt({
    id: attempt.id, disposition: "unknown", rawText, actualMinor: null, costState: paid ? "unknown" : "none", late: 0,
    receipt: sampleReceipt(sample),
  });
  if (paid && slot.reservationId) {
    await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), null, time);
  }
  await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
}

async function ownedRun(connection: DatabaseConnection, ownerId: string, runId: string, work: (
  transaction: TransactionConnection,
  monitoring: MonitoringDao,
  quota: QuotaDao,
  run: MonitoringRunRow,
) => Promise<ExecutedRun | Denied>) {
  try {
    return await connection.transaction(async (transaction) => {
      const monitoring = new MonitoringDao(transaction);
      const quota = new QuotaDao(transaction);
      const run = await monitoring.runForOwner(ownerId, runId);
      if (!run) return denied("NOT_FOUND");
      const brand = await quota.lockBrand(run.brandId, ownerId);
      if (!brand) return denied("NOT_FOUND");
      if (brand !== "active") return denied("NOT_ENTITLED");
      return work(transaction, monitoring, quota, run);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "forced-rollback") throw error;
    console.error("monitoring-execution-failed", { name: error instanceof Error ? error.name : "unknown" });
    return denied("SERVICE_UNAVAILABLE");
  }
}

function sampleReceipt(sample: IsolatedSample | OfficialSample) {
  if (sample.synthetic) return null;
  return serializeOfficialReceipt(sample);
}

const claimLeaseMs = 120_000;

function attemptAge(createdAt: string, time: string) {
  const age = Date.parse(time) - Date.parse(createdAt);
  return Number.isFinite(age) ? age : claimLeaseMs;
}

async function withLockedRun<T>(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  work: (
    transaction: TransactionConnection,
    monitoring: MonitoringDao,
    quota: QuotaDao,
    run: MonitoringRunRow,
  ) => Promise<T | Denied>,
): Promise<T | Denied> {
  try {
    return await connection.transaction(async (transaction) => {
      const monitoring = new MonitoringDao(transaction);
      const quota = new QuotaDao(transaction);
      const run = await monitoring.runForOwner(ownerId, runId);
      if (!run) return denied("NOT_FOUND");
      const brand = await quota.lockBrand(run.brandId, ownerId);
      if (!brand) return denied("NOT_FOUND");
      if (brand !== "active") return denied("NOT_ENTITLED");
      return work(transaction, monitoring, quota, run);
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "forced-rollback" || error.message === "official-claim-crash")) throw error;
    console.error("monitoring-execution-failed", { name: error instanceof Error ? error.name : "unknown" });
    return denied("SERVICE_UNAVAILABLE");
  }
}

export async function executeMonitoringRun(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  transport: IsolatedTransport | OfficialSamplingPort,
  now = () => new Date().toISOString(),
  options: { failBeforeCommit?: boolean; crashAfterClaim?: boolean } = {},
) {
  if (transport.label === "official_api") {
    return executeOfficialMonitoringRun(connection, ownerId, runId, transport, now, options);
  }
  const time = now();
  return ownedRun(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
    if (run.status === "cancelled") return persist(monitoring, ownerId, run.id, true);
    const slots = await monitoring.slots([run.id]);
    const grouped = new Map<string, MonitoringAttemptRow[]>();
    for (const attempt of await monitoring.attempts([run.id])) {
      const list = grouped.get(attempt.slotId) ?? [];
      list.push(attempt);
      grouped.set(attempt.slotId, list);
    }
    const capabilityDao = new CapabilityDao(transaction);
    const channels = await capabilityDao.latestByIds([...new Set(slots.map((slot) => slot.channelId))]);
    const channelById = new Map(channels.map((channel) => [channel.channelId, channel]));
    if (run.track === "model_api" && !(await monitoring.emailVerified(ownerId))) {
      await monitoring.pauseQueued(run.id);
      await persist(monitoring, ownerId, run.id, false);
      return denied("EMAIL_UNVERIFIED", "verify-email");
    }
    const grant = run.track === "model_api" ? await quota.grant(run.brandId, "sampling") : null;
    if (run.track === "model_api" && (!grant || grantState(grant, time) !== "active" || grant.currency !== run.currency || run.upperMinor === null)) {
      await monitoring.pauseQueued(run.id);
      await persist(monitoring, ownerId, run.id, false);
      return denied(run.upperMinor === null ? "NO_TRUSTED_CEILING" : "NOT_ENTITLED", run.upperMinor === null ? "confirm-ceiling" : "request-quota");
    }
    const usage = run.track === "model_api" ? await monitoring.samplingUsage(run.brandId) : null;
    let pausedForBudget = false;
    for (const slot of slots) {
      if (["succeeded", "failed", "cancelled", "reconciliation_required"].includes(slot.status)) continue;
      const sampling = (grouped.get(slot.id) ?? []).filter((attempt) => attempt.kind === "sampling");
      const pending = sampling.find((attempt) => attempt.disposition === "pending");
      if (pending || sampling.some((attempt) => attempt.disposition === "unknown" || attempt.disposition === "late")) {
        if (pending && slot.reservationId) {
          await monitoring.updateAttempt({ id: pending.id, disposition: "unknown", rawText: pending.rawText, actualMinor: null, costState: "unknown", late: pending.late });
          await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, pending.id), null, time);
        }
        await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
        continue;
      }
      if (sampling.length >= 3) {
        if (slot.reservationId) {
          const totals = await quota.attemptTotals(reservationScope(run.brandId, slot.reservationId));
          if (totals.unresolved === 0) await quota.finalize(reservationScope(run.brandId, slot.reservationId), "released", time);
        }
        await monitoring.setSlot(slot.id, "failed", null, slot.late);
        continue;
      }
      const channel = channelById.get(slot.channelId);
      if (!channel || channel.kind !== run.track || formalRunEligibility(channel, time) !== "eligible") {
        await monitoring.pauseQueued(run.id);
        await persist(monitoring, ownerId, run.id, false);
        return denied("CHANNEL_UNVERIFIED", "verify-channel");
      }
      const upper = run.upperMinor ?? 0;
      if (run.track === "model_api" && sampling.length === 0 && grant && usage
        && (usage.startedReservations + 1 > grant.countLimit || usage.knownActual + usage.pendingUpper + upper > grant.budgetMinor)) {
        await monitoring.pauseQueued(run.id);
        pausedForBudget = true;
        break;
      }
      const attemptId = randomUUID();
      const paid = Boolean(slot.reservationId && run.currency);
      if (paid && slot.reservationId && run.currency) {
        const started = await startQuota(quota, run.brandId, slot.reservationId, attemptId, upper, run.currency, time);
        if (started === "unresolved") {
          await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
          continue;
        }
        if (started !== "applied") {
          await monitoring.pauseQueued(run.id);
          pausedForBudget = true;
          break;
        }
        if (usage) {
          if (sampling.length === 0) usage.startedReservations += 1;
          usage.pendingUpper += upper;
        }
      }
      const attempt: MonitoringAttemptRow = {
        id: attemptId, slotId: slot.id, runId: run.id, brandId: run.brandId, kind: "sampling", ordinal: sampling.length + 1,
        transport: "isolated", synthetic: 1, disposition: "pending", rawText: null, currency: run.currency,
        upperMinor: paid ? upper : null, actualMinor: null, costState: paid ? "pending" : "none",
        quotaAttemptId: paid ? attemptId : null, late: 0, receipt: null, createdAt: time,
      };
      await monitoring.insertAttempt(attempt);
      const request: SamplingRequest = {
        slotId: slot.id, questionId: slot.questionId, channelId: slot.channelId, ordinal: attempt.ordinal,
        requestedNetworkMode: run.requestedNetworkMode,
        upperMinor: run.upperMinor, currency: run.currency, now: time,
        capability: channel ? {
          channelId: channel.channelId, version: channel.version, kind: channel.kind, status: channel.status,
          productEntry: channel.productEntry, modelVersion: channel.modelVersion,
          citationCapability: channel.citationCapability, searchRequired: channel.searchRequired === 1 ? 1 : 0,
          verifiedAt: channel.verifiedAt, expiresAt: channel.expiresAt,
        } : undefined,
      };
      let sample: IsolatedSample;
      try {
        sample = await transport.sample(request);
      } catch {
        sample = { disposition: "unknown", synthetic: true };
      }
      await applySample(monitoring, quota, run, slot, attempt, sample, time, usage);
    }
    if (options.failBeforeCommit) throw new Error("forced-rollback");
    return persist(monitoring, ownerId, run.id, false, pausedForBudget);
  });
}

const terminalSlot = new Set(["succeeded", "failed", "cancelled", "reconciliation_required"]);

function channelGate(channel: {
  channelId: string;
  kind: string;
  status: string;
  productEntry: string;
  modelVersion: string;
  verifiedAt: string | null;
  expiresAt: string | null;
}) {
  return {
    channelId: channel.channelId,
    kind: channel.kind,
    status: channel.status,
    productEntry: channel.productEntry,
    modelVersion: channel.modelVersion,
    verifiedAt: channel.verifiedAt,
    expiresAt: channel.expiresAt,
  };
}

async function executeOfficialMonitoringRun(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  transport: OfficialSamplingPort,
  now: () => string,
  options: { crashAfterClaim?: boolean },
) {
  const time = now();
  const opened = await withLockedRun(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
    if (run.status === "cancelled") return { kind: "result" as const, result: await persist(monitoring, ownerId, run.id, true) };
    const slots = await monitoring.slots([run.id]);
    const channels = await new CapabilityDao(transaction).latestByIds([...new Set(slots.map((slot) => slot.channelId))]);
    const channelById = new Map(channels.map((channel) => [channel.channelId, channel]));
    const pinned = slots.every((slot) => channelById.get(slot.channelId)?.version === slot.channelVersion);
    if (!pinned || channels.length === 0) {
      await monitoring.pauseQueued(run.id);
      await persist(monitoring, ownerId, run.id, false);
      return { kind: "result" as const, result: denied("CHANNEL_UNVERIFIED", "verify-channel") };
    }
    for (const channel of channels) {
      const decision = transport.probe(channelGate(channel), time);
      if (!decision.open && decision.code === "CHANNEL_UNVERIFIED") {
        await monitoring.pauseQueued(run.id);
        await persist(monitoring, ownerId, run.id, false);
        return { kind: "result" as const, result: denied("CHANNEL_UNVERIFIED", "verify-channel") };
      }
      if (!decision.open) return { kind: "result" as const, result: denied("REAL_CHANNEL_CLOSED", "await-channel") };
      if (run.track === "model_api" && !transport.priced(channel.modelVersion, run.currency)) {
        await monitoring.pauseQueued(run.id);
        await persist(monitoring, ownerId, run.id, false);
        return { kind: "result" as const, result: denied("NO_TRUSTED_CEILING", "confirm-ceiling") };
      }
    }
    if (run.track === "model_api" && !(await monitoring.emailVerified(ownerId))) {
      await monitoring.pauseQueued(run.id);
      await persist(monitoring, ownerId, run.id, false);
      return { kind: "result" as const, result: denied("EMAIL_UNVERIFIED", "verify-email") };
    }
    const grant = run.track === "model_api" ? await quota.grant(run.brandId, "sampling") : null;
    if (run.track === "model_api" && (!grant || grantState(grant, time) !== "active" || grant.currency !== run.currency || run.upperMinor === null)) {
      await monitoring.pauseQueued(run.id);
      await persist(monitoring, ownerId, run.id, false);
      return { kind: "result" as const, result: denied(run.upperMinor === null ? "NO_TRUSTED_CEILING" : "NOT_ENTITLED", run.upperMinor === null ? "confirm-ceiling" : "request-quota") };
    }
    const prompt = await new PromptDao(transaction, run.brandId).version(run.promptSetId);
    if (!prompt || slots.some((slot) => !prompt.content.questions.some((question) => question.id === slot.questionId && question.text.trim()))) {
      return { kind: "result" as const, result: denied("NOT_READY") };
    }
    return { kind: "ready" as const };
  });
  if (!opened || "error" in opened) return opened;
  if (opened.kind === "result") return opened.result;

  const touched = new Set<string>();
  for (;;) {
    const step = await withLockedRun(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
      if (run.status === "cancelled") return { kind: "done" as const, result: await persist(monitoring, ownerId, run.id, true) };
      const slots = await monitoring.slots([run.id]);
      const grouped = new Map<string, MonitoringAttemptRow[]>();
      for (const attempt of await monitoring.attempts([run.id])) {
        const list = grouped.get(attempt.slotId) ?? [];
        list.push(attempt);
        grouped.set(attempt.slotId, list);
      }
      const channels = await new CapabilityDao(transaction).latestByIds([...new Set(slots.map((slot) => slot.channelId))]);
      const channelById = new Map(channels.map((channel) => [channel.channelId, channel]));
      const grant = run.track === "model_api" ? await quota.grant(run.brandId, "sampling") : null;
      const usage = run.track === "model_api" ? await monitoring.samplingUsage(run.brandId) : null;
      const prompt = await new PromptDao(transaction, run.brandId).version(run.promptSetId);
      const questionText = new Map(prompt?.content.questions.map((question) => [question.id, question.text.trim()]) ?? []);
      for (const slot of slots) {
        if (terminalSlot.has(slot.status) || touched.has(slot.id)) continue;
        const sampling = (grouped.get(slot.id) ?? []).filter((attempt) => attempt.kind === "sampling");
        const pending = sampling.find((attempt) => attempt.disposition === "pending");
        const blocked = sampling.some((attempt) => attempt.disposition === "unknown" || attempt.disposition === "late");
        if (pending && !blocked && attemptAge(pending.createdAt, time) < claimLeaseMs) continue;
        if (pending || blocked) {
          if (pending && slot.reservationId) {
            await monitoring.updateAttempt({
              id: pending.id, disposition: "unknown", rawText: pending.rawText, actualMinor: null, costState: "unknown", late: pending.late,
            });
            await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, pending.id), null, time);
          }
          await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
          await persist(monitoring, ownerId, run.id, false);
          return { kind: "reconciled" as const };
        }
        if (sampling.length >= 3) {
          if (slot.reservationId) {
            const totals = await quota.attemptTotals(reservationScope(run.brandId, slot.reservationId));
            if (totals.unresolved === 0) await quota.finalize(reservationScope(run.brandId, slot.reservationId), "released", time);
          }
          await monitoring.setSlot(slot.id, "failed", null, slot.late);
          await persist(monitoring, ownerId, run.id, false);
          return { kind: "reconciled" as const };
        }
        const channel = channelById.get(slot.channelId);
        if (!channel || channel.version !== slot.channelVersion || channel.kind !== run.track || formalRunEligibility(channel, time) !== "eligible") {
          await monitoring.pauseQueued(run.id);
          await persist(monitoring, ownerId, run.id, false);
          return { kind: "done" as const, result: denied("CHANNEL_UNVERIFIED", "verify-channel") };
        }
        if (run.track === "model_api" && !transport.priced(channel.modelVersion, run.currency)) {
          await monitoring.pauseQueued(run.id);
          await persist(monitoring, ownerId, run.id, false);
          return { kind: "done" as const, result: denied("NO_TRUSTED_CEILING", "confirm-ceiling") };
        }
        const text = questionText.get(slot.questionId);
        if (!text) return { kind: "done" as const, result: denied("NOT_READY") };
        const upper = run.upperMinor ?? 0;
        if (run.track === "model_api" && sampling.length === 0 && grant && usage
          && (usage.startedReservations + 1 > grant.countLimit || usage.knownActual + usage.pendingUpper + upper > grant.budgetMinor)) {
          await monitoring.pauseQueued(run.id);
          return { kind: "done" as const, result: await persist(monitoring, ownerId, run.id, false, true) };
        }
        const attemptId = randomUUID();
        const paid = Boolean(slot.reservationId && run.currency);
        if (paid && slot.reservationId && run.currency) {
          const started = await startQuota(quota, run.brandId, slot.reservationId, attemptId, upper, run.currency, time);
          if (started === "unresolved") {
            await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
            await persist(monitoring, ownerId, run.id, false);
            return { kind: "reconciled" as const };
          }
          if (started !== "applied") {
            await monitoring.pauseQueued(run.id);
            return { kind: "done" as const, result: await persist(monitoring, ownerId, run.id, false, true) };
          }
        }
        const attempt: MonitoringAttemptRow = {
          id: attemptId, slotId: slot.id, runId: run.id, brandId: run.brandId, kind: "sampling", ordinal: sampling.length + 1,
          transport: "official_api", synthetic: 0, disposition: "pending", rawText: null, currency: run.currency,
          upperMinor: paid ? upper : null, actualMinor: null, costState: paid ? "pending" : "none",
          quotaAttemptId: paid ? attemptId : null, late: 0, receipt: null, createdAt: time,
        };
        await monitoring.insertAttempt(attempt);
        await monitoring.setSlot(slot.id, "running", null, slot.late);
        await persist(monitoring, ownerId, run.id, false);
        const request: SamplingRequest = {
          slotId: slot.id, questionId: slot.questionId, channelId: slot.channelId, ordinal: attempt.ordinal,
          questionText: text, requestedNetworkMode: run.requestedNetworkMode,
          upperMinor: run.upperMinor, currency: run.currency, now: time,
          capability: {
            channelId: channel.channelId, version: channel.version, kind: channel.kind, status: channel.status,
            productEntry: channel.productEntry, modelVersion: channel.modelVersion,
            citationCapability: channel.citationCapability, searchRequired: channel.searchRequired === 1 ? 1 : 0,
            verifiedAt: channel.verifiedAt, expiresAt: channel.expiresAt,
          },
        };
        return { kind: "claimed" as const, attempt, slot, searchRequired: channel.searchRequired === 1 ? 1 as const : 0 as const, request };
      }
      return { kind: "done" as const, result: await persist(monitoring, ownerId, run.id, false) };
    });
    if (!step || "error" in step) return step;
    if (step.kind === "reconciled") continue;
    if (step.kind === "done") return step.result;
    touched.add(step.slot.id);
    if (options.crashAfterClaim) throw new Error("official-claim-crash");
    let sample: OfficialSample;
    try {
      const value = await transport.sample(step.request);
      sample = value.synthetic ? unknownOfficialSample() : value;
    } catch {
      sample = unknownOfficialSample();
    }
    const written = await withLockedRun(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
      const current = (await monitoring.attempts([run.id])).find((item) => item.id === step.attempt.id);
      const slot = (await monitoring.slots([run.id])).find((item) => item.id === step.slot.id);
      if (!current || !slot) return denied("NOT_FOUND");
      if (current.costState === "known" && current.disposition !== "pending") return persist(monitoring, ownerId, run.id, true);
      await applySample(monitoring, quota, run, slot, current, sample, time, null);
      if (sample.disposition !== "safe_failure") {
        const facts = officialNetworkFacts(sample.networkTrigger, step.searchRequired);
        await new CapabilityDao(transaction).insertAnswerNetwork({
          id: randomUUID(), brandId: run.brandId, channelId: slot.channelId, channelVersion: slot.channelVersion,
          requestedNetworkMode: run.requestedNetworkMode, ...facts, createdAt: time,
        }, ownerId);
      }
      return persist(monitoring, ownerId, run.id, false);
    });
    if (!written || "error" in written) return written;
  }
}

export async function pauseMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string) {
  return ownedRun(connection, ownerId, runId, async (_transaction, monitoring, _quota, run) => {
    if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") return persist(monitoring, ownerId, run.id, true);
    const before = await monitoring.slots([run.id]);
    await monitoring.pauseQueued(run.id);
    const replayed = before.every((slot) => slot.status !== "queued");
    return persist(monitoring, ownerId, run.id, replayed);
  });
}

export async function continueMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string) {
  return ownedRun(connection, ownerId, runId, async (transaction, monitoring, _quota, run) => {
    if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") return persist(monitoring, ownerId, run.id, true);
    const waiting = await queryWithParameters(transaction, "SELECT id FROM monitoring_slot WHERE run_id = ? AND status = 'paused'", [run.id]);
    if (waiting.length) {
      await queryWithParameters(transaction, `UPDATE monitoring_slot SET status = 'queued' WHERE id IN (${waiting.map(() => "?").join(", ")})`,
        waiting.map((row) => String(row.id)));
    }
    return persist(monitoring, ownerId, run.id, waiting.length === 0);
  });
}

export async function cancelMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string, now = () => new Date().toISOString()) {
  return ownedRun(connection, ownerId, runId, async (transaction, monitoring, _quota, run) => {
    if (run.status === "cancelled") return persist(monitoring, ownerId, run.id, true);
    await monitoring.cancelWaiting(run.id);
    const releasable = await queryWithParameters(transaction, `SELECT r.id FROM quota_reservation r
      JOIN monitoring_slot s ON s.brand_id = r.brand_id AND s.reservation_id = r.id
      WHERE r.brand_id = ? AND r.kind = 'sampling' AND r.state = 'reserved' AND s.run_id = ? AND s.status = 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM quota_attempt a WHERE a.brand_id = r.brand_id AND a.kind = r.kind
            AND a.reservation_id = r.id AND a.state <> 'known'
        )`, [run.brandId, run.id]);
    if (releasable.length) {
      await queryWithParameters(transaction, `UPDATE quota_reservation SET state = 'released', finalized_at = ?
        WHERE brand_id = ? AND kind = 'sampling' AND id IN (${releasable.map(() => "?").join(", ")})`,
      [now(), run.brandId, ...releasable.map((row) => String(row.id))]);
    }
    return persist(monitoring, ownerId, run.id, false);
  });
}

export async function redoMonitoringAnalysis(connection: DatabaseConnection, ownerId: string, runId: string, slotId: string, now = () => new Date().toISOString()) {
  return ownedRun(connection, ownerId, runId, async (_transaction, monitoring, _quota, run) => {
    const slots = await monitoring.slots([run.id]);
    const slot = slots.find((item) => item.id === slotId);
    const adopted = (await monitoring.attempts([run.id])).find((attempt) => attempt.id === slot?.adoptedAttemptId && attempt.rawText);
    if (!slot || !adopted || !adopted.rawText) return denied("NOT_READY");
    const analyses = (await monitoring.attempts([run.id])).filter((attempt) => attempt.slotId === slot.id && attempt.kind === "analysis");
    if (analyses.length >= 20) return denied("INVALID_INPUT");
    await monitoring.insertAttempt({
      id: randomUUID(), slotId: slot.id, runId: run.id, brandId: run.brandId, kind: "analysis", ordinal: analyses.length + 1,
      transport: adopted.transport, synthetic: adopted.synthetic, disposition: "analysis_reuse", rawText: adopted.rawText,
      currency: null, upperMinor: null, actualMinor: null, costState: "none", quotaAttemptId: null, late: 0, receipt: null, createdAt: now(),
    });
    return persist(monitoring, ownerId, run.id, false);
  });
}

export async function reconcileMonitoringCost(
  connection: DatabaseConnection, ownerId: string, runId: string, attemptId: string, actualMinor: number | null, now = () => new Date().toISOString(),
) {
  return ownedRun(connection, ownerId, runId, async (_transaction, monitoring, quota, run) => {
    const attempt = await monitoring.attemptForOwner(ownerId, attemptId);
    if (!attempt || attempt.runId !== run.id || attempt.kind !== "sampling") return denied("NOT_FOUND");
    if (attempt.costState === "known") {
      return attempt.actualMinor === actualMinor ? persist(monitoring, ownerId, run.id, true) : denied("OPERATION_CONFLICT");
    }
    if (actualMinor === null) {
      await monitoring.updateAttempt({ ...attempt, disposition: attempt.disposition === "pending" ? "unknown" : attempt.disposition, costState: attempt.costState === "none" ? "none" : "unknown", actualMinor: null });
      return persist(monitoring, ownerId, run.id, attempt.costState === "unknown");
    }
    const slot = (await monitoring.slots([run.id])).find((item) => item.id === attempt.slotId);
    if (!slot) return denied("NOT_FOUND");
    const late = attempt.late;
    const canAdopt = Boolean(attempt.rawText) && slot.status !== "cancelled" && slot.adoptedAttemptId === null;
    await monitoring.updateAttempt({
      id: attempt.id, disposition: canAdopt ? "adopted" : attempt.disposition === "pending" ? "unknown" : attempt.disposition,
      rawText: attempt.rawText, actualMinor, costState: "known", late,
    });
    if (slot.reservationId && attempt.quotaAttemptId) {
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.quotaAttemptId), actualMinor, now());
      const reservation = await quota.reservation(reservationScope(run.brandId, slot.reservationId));
      if (reservation?.state === "reserved") {
        if (canAdopt || actualMinor > 0) await quota.finalize(reservationScope(run.brandId, slot.reservationId), "settled", now());
        else await quota.finalize(reservationScope(run.brandId, slot.reservationId), "released", now());
      }
    }
    if (canAdopt) await monitoring.setSlot(slot.id, "succeeded", attempt.id, late);
    else if (slot.status !== "succeeded" && slot.status !== "cancelled") await monitoring.setSlot(slot.id, "failed", null, late);
    return persist(monitoring, ownerId, run.id, false);
  });
}

export async function recordLateMonitoringResult(
  connection: DatabaseConnection, ownerId: string, runId: string, attemptId: string, rawText: string, actualMinor: number | null,
  now = () => new Date().toISOString(),
) {
  if (!rawText || rawText.length > 8000) return denied("INVALID_INPUT");
  const saved = await ownedRun(connection, ownerId, runId, async (_transaction, monitoring, _quota, run) => {
    const attempt = await monitoring.attemptForOwner(ownerId, attemptId);
    if (!attempt || attempt.runId !== run.id) return denied("NOT_FOUND");
    await monitoring.updateAttempt({ id: attempt.id, disposition: attempt.disposition === "pending" ? "late" : attempt.disposition, rawText, actualMinor: attempt.actualMinor, costState: attempt.costState, late: 1 });
    const slot = (await monitoring.slots([run.id])).find((item) => item.id === attempt.slotId);
    if (slot && slot.status !== "succeeded") await monitoring.setSlot(slot.id, slot.status === "queued" || slot.status === "paused" ? "reconciliation_required" : slot.status, null, 1);
    else if (slot) await monitoring.setSlot(slot.id, slot.status, slot.adoptedAttemptId, 1);
    return persist(monitoring, ownerId, run.id, false);
  });
  if (isDenied(saved) || actualMinor === null) return saved;
  return reconcileMonitoringCost(connection, ownerId, runId, attemptId, actualMinor, now);
}

export function executionPausedForBudget(result: ExecutedRun | Denied) {
  return !isDenied(result) && result.pausedForBudget;
}
