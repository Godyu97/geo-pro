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
import { SamplingProtocolDao } from "./protocol-dao.ts";
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
  if (!sample.synthetic && (!officialRawText(sample.rawText)
    || !Number.isSafeInteger(sample.actualMinor) || sample.actualMinor < 0
    || sample.costState !== "known" || sample.currency !== run.currency)) return false;
  return true;
}

function officialRawText(rawText: string | null) {
  return rawText && rawText.length >= 2 && rawText.length <= 8000 && !rawText.includes("\0") ? rawText : null;
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
  late: 0 | 1 = 0,
) {
  const upper = run.upperMinor ?? 0;
  const paid = Boolean(slot.reservationId && run.currency);
  if (canAdopt(sample, run) && sample.disposition === "adopted") {
    await monitoring.updateAttempt({
      id: attempt.id, disposition: "adopted", rawText: sample.rawText, actualMinor: paid ? sample.actualMinor : null,
      costState: paid ? "known" : "none", late, receipt: sampleReceipt(sample),
    });
    if (paid && slot.reservationId) {
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), sample.actualMinor, time);
      await quota.finalize(reservationScope(run.brandId, slot.reservationId), "settled", time);
      if (usage) {
        usage.pendingUpper -= upper;
        usage.knownActual += sample.actualMinor;
      }
    }
    await monitoring.setSlot(slot.id, "succeeded", attempt.id, late);
    return;
  }
  if (sample.disposition === "safe_failure") {
    await monitoring.updateAttempt({
      id: attempt.id, disposition: "safe_failure", rawText: null, actualMinor: paid ? 0 : null,
      costState: paid ? "known" : "none", late, receipt: sampleReceipt(sample),
    });
    if (paid && slot.reservationId) {
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), 0, time);
      if (usage) usage.pendingUpper -= upper;
      if (attempt.ordinal >= 3) await quota.finalize(reservationScope(run.brandId, slot.reservationId), "released", time);
    }
    await monitoring.setSlot(slot.id, attempt.ordinal >= 3 ? "failed" : slot.status === "paused" ? "paused" : "queued", null, late);
    return;
  }
  const rawText = sample.synthetic
    ? sample.disposition === "unknown" ? sample.rawText ?? null : null
    : officialRawText(sample.rawText);
  await monitoring.updateAttempt({
    id: attempt.id, disposition: "unknown", rawText, actualMinor: null, costState: paid ? "unknown" : "none", late,
    receipt: sampleReceipt(sample),
  });
  if (paid && slot.reservationId) {
    await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, attempt.id), null, time);
  }
  await monitoring.setSlot(slot.id, "reconciliation_required", null, late);
}

async function ownedRun<T>(connection: DatabaseConnection, ownerId: string, runId: string, work: (
  transaction: TransactionConnection,
  monitoring: MonitoringDao,
  quota: QuotaDao,
  run: MonitoringRunRow,
) => Promise<T | Denied>): Promise<T | Denied> {
  try {
    return await connection.transaction(async (transaction) => {
      const monitoring = new MonitoringDao(transaction);
      const quota = new QuotaDao(transaction);
      const run = await monitoring.runForOwner(ownerId, runId);
      if (!run) return denied("NOT_FOUND");
      const brand = await quota.lockBrand(run.brandId, ownerId);
      if (!brand) return denied("NOT_FOUND");
      if (brand !== "active") return denied("NOT_ENTITLED");
      const current = await monitoring.runForOwner(ownerId, runId);
      return current ? work(transaction, monitoring, quota, current) : denied("NOT_FOUND");
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

type OfficialClaim = {
  slotId: string;
  attemptId: string;
  searchRequired: 0 | 1;
  request: SamplingRequest;
};

async function claimOfficialSlot(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  transport: OfficialSamplingPort,
  now: () => string,
  touched: ReadonlySet<string>,
  changed: boolean,
) {
  return ownedRun<OfficialClaim | ExecutedRun>(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
    if (run.track !== "model_api") return denied("REAL_CHANNEL_CLOSED", "await-channel");
    const time = now();
    const [slots, attempts] = await Promise.all([monitoring.slots([run.id]), monitoring.attempts([run.id])]);
    if (attempts.some((attempt) => attempt.kind === "sampling" && attempt.synthetic === 1)) {
      return denied("REAL_CHANNEL_CLOSED", "await-channel");
    }
    const samplingBySlot = new Map<string, MonitoringAttemptRow[]>();
    for (const attempt of attempts) {
      if (attempt.kind !== "sampling") continue;
      const sampling = samplingBySlot.get(attempt.slotId) ?? [];
      sampling.push(attempt);
      samplingBySlot.set(attempt.slotId, sampling);
    }

    // Expired claims keep their reservations. Recovery also works after a pause,
    // cancellation or capability change because it never calls the provider.
    let recovered = false;
    for (const slot of slots) {
      if (touched.has(slot.id)) continue;
      const pending = samplingBySlot.get(slot.id)?.find((attempt) => attempt.disposition === "pending");
      if (!pending || attemptAge(pending.createdAt, time) < claimLeaseMs) continue;
      await monitoring.updateAttempt({ ...pending, disposition: "unknown", costState: pending.costState === "none" ? "none" : "unknown" });
      if (slot.reservationId && pending.quotaAttemptId) {
        await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, pending.quotaAttemptId), null, time);
      }
      if (slot.status !== "cancelled") await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
      recovered = true;
    }
    if (recovered) await monitoring.setRun(run.id, ...progressFields(await monitoring.slots([run.id])));

    const candidates = slots.filter((slot) => slot.status === "queued" && !touched.has(slot.id)
      && (samplingBySlot.get(slot.id) ?? []).every((attempt) => attempt.disposition === "safe_failure"));
    if (!candidates.length) return persist(monitoring, ownerId, run.id, !changed && !recovered);

    async function pause(error: MonitoringError, next: MonitoringNextStep) {
      await monitoring.pauseQueued(run.id);
      await monitoring.setRun(run.id, ...progressFields(await monitoring.slots([run.id])));
      return denied(error, next);
    }

    const channels = await new CapabilityDao(transaction).latestByIds([...new Set(candidates.map((slot) => slot.channelId))]);
    const channelById = new Map(channels.map((channel) => [channel.channelId, channel]));
    if (candidates.some((slot) => channelById.get(slot.channelId)?.version !== slot.channelVersion)) {
      return pause("CHANNEL_UNVERIFIED", "verify-channel");
    }
    for (const channel of channels) {
      if (channel.kind !== "model_api" || formalRunEligibility(channel, time) !== "eligible") {
        return pause("CHANNEL_UNVERIFIED", "verify-channel");
      }
      const probe = transport.probe(channel, time);
      if (!probe.open) return probe.code === "CHANNEL_UNVERIFIED"
        ? pause("CHANNEL_UNVERIFIED", "verify-channel") : denied("REAL_CHANNEL_CLOSED", "await-channel");
      if (!transport.priced(channel.modelVersion, run.currency)) return pause("NO_TRUSTED_CEILING", "confirm-ceiling");
    }
    if (!(await monitoring.emailVerified(ownerId))) return pause("EMAIL_UNVERIFIED", "verify-email");
    const { currency, upperMinor } = run;
    if (currency === null || upperMinor === null || upperMinor === 0) return pause("NO_TRUSTED_CEILING", "confirm-ceiling");
    const grant = await quota.grant(run.brandId, "sampling");
    if (!grant || grantState(grant, time) !== "active" || grant.currency !== currency) return pause("NOT_ENTITLED", "request-quota");

    const protocolDao = new SamplingProtocolDao(transaction);
    const [prompt, pin, usage] = await Promise.all([
      new PromptDao(transaction, run.brandId).version(run.promptSetId),
      protocolDao.pinForRun(ownerId, run.id),
      monitoring.samplingUsage(run.brandId),
    ]);
    if (!prompt || prompt.version !== run.promptSetVersion) return denied("NOT_READY");
    const protocol = pin && await protocolDao.versionForOwner(ownerId, pin.protocolId, pin.version);
    if (pin && (!protocol || protocol.status !== "frozen" || protocol.brandId !== run.brandId)) return denied("NOT_READY");
    if (protocol?.searchRequired === 1 && run.requestedNetworkMode !== "on") return denied("NETWORK_REQUIRED");

    const questionText = new Map(prompt.content.questions.map((question) => [question.id, question.text.trim()]));
    for (const slot of candidates) {
      const channel = channelById.get(slot.channelId);
      const text = questionText.get(slot.questionId);
      if (!channel || !text) return denied("NOT_READY");
      const ordinal = (samplingBySlot.get(slot.id)?.length ?? 0) + 1;
      if (!slot.reservationId) return pause("NO_TRUSTED_CEILING", "confirm-ceiling");
      if (ordinal > 3) {
        const reservation = reservationScope(run.brandId, slot.reservationId);
        const totals = await quota.attemptTotals(reservation);
        if (!totals.unresolved) await quota.finalize(reservation, "released", time);
        await monitoring.setSlot(slot.id, "failed", null, slot.late);
        changed = true;
        continue;
      }

      // Retries reuse the slot count and must still fit the current monetary cap.
      const newSlotOverLimit = ordinal === 1 && usage.startedReservations >= grant.countLimit;
      if (newSlotOverLimit || usage.knownActual + usage.pendingUpper + upperMinor > grant.budgetMinor) {
        await monitoring.pauseQueued(run.id);
        return persist(monitoring, ownerId, run.id, false, true);
      }
      const attemptId = randomUUID();
      const started = await startQuota(quota, run.brandId, slot.reservationId, attemptId, upperMinor, currency, time);
      if (started === "unresolved") {
        await monitoring.setSlot(slot.id, "reconciliation_required", null, slot.late);
        changed = true;
        continue;
      }
      if (started !== "applied") {
        await monitoring.pauseQueued(run.id);
        return persist(monitoring, ownerId, run.id, false, true);
      }
      await monitoring.insertAttempt({
        id: attemptId, slotId: slot.id, runId: run.id, brandId: run.brandId, kind: "sampling", ordinal,
        transport: "official_api", synthetic: 0, disposition: "pending", rawText: null, currency, upperMinor,
        actualMinor: null, costState: "pending", quotaAttemptId: attemptId, late: 0, receipt: null, createdAt: time,
      });
      await monitoring.setSlot(slot.id, "running", null, slot.late);
      await monitoring.setRun(run.id, "running", 0);
      return {
        attemptId, slotId: slot.id,
        searchRequired: protocol?.searchRequired === 1 ? 1 : channel.searchRequired,
        request: {
          slotId: slot.id, questionId: slot.questionId, channelId: slot.channelId, ordinal,
          questionText: text, requestedNetworkMode: run.requestedNetworkMode, upperMinor, currency, now: time, capability: channel,
        },
      };
    }
    return persist(monitoring, ownerId, run.id, !changed && !recovered);
  });
}

function progressFields(slots: MonitoringSlotRow[]) {
  const progress = rollup(slots);
  return [progress.status, progress.samplingComplete] as const;
}

async function writeOfficialResult(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  claim: OfficialClaim,
  sample: OfficialSample,
  now: () => string,
) {
  return ownedRun(connection, ownerId, runId, async (transaction, monitoring, quota, run) => {
    const [current, slots] = await Promise.all([monitoring.attemptForOwner(ownerId, claim.attemptId), monitoring.slots([runId])]);
    const slot = slots.find((item) => item.id === claim.slotId);
    if (!current || !slot || !slot.reservationId || !current.quotaAttemptId) return denied("NOT_FOUND");
    // A manually reconciled or already recorded receipt wins over a later reply.
    if (current.costState === "known" || current.receipt) return null;

    const time = now();
    const late = current.disposition !== "pending" || slot.status !== "running"
      || attemptAge(current.createdAt, time) >= claimLeaseMs ? 1 : 0;
    if (slot.status === "cancelled" || (late && current.disposition !== "pending" && sample.disposition === "safe_failure")) {
      const actualMinor = sample.disposition === "safe_failure" ? 0
        : sample.disposition === "adopted" && canAdopt(sample, run) ? sample.actualMinor : null;
      await quota.updateAttempt(attemptScope(run.brandId, slot.reservationId, current.quotaAttemptId), actualMinor, time);
      if (actualMinor !== null) {
        await quota.finalize(reservationScope(run.brandId, slot.reservationId), actualMinor > 0 ? "settled" : "released", time);
      }
      await monitoring.updateAttempt({
        ...current, disposition: "late", rawText: officialRawText(sample.rawText) ?? current.rawText, actualMinor,
        costState: actualMinor === null ? "unknown" : "known", late: 1, receipt: sampleReceipt(sample),
      });
      await monitoring.setSlot(slot.id, slot.status === "cancelled" ? "cancelled" : "failed", null, 1);
    } else {
      await applySample(monitoring, quota, run, slot, current, sample, time, null, late);
    }
    if (sample.disposition !== "safe_failure") {
      await new CapabilityDao(transaction).insertAnswerNetwork({
        id: randomUUID(), brandId: run.brandId, channelId: slot.channelId, channelVersion: slot.channelVersion,
        requestedNetworkMode: run.requestedNetworkMode, ...officialNetworkFacts(sample.networkTrigger, claim.searchRequired), createdAt: time,
      }, ownerId);
    }
    await monitoring.setRun(run.id, ...progressFields(await monitoring.slots([run.id])));
    return null;
  });
}

async function executeOfficialMonitoringRun(
  connection: DatabaseConnection,
  ownerId: string,
  runId: string,
  transport: OfficialSamplingPort,
  now: () => string,
  options: { crashAfterClaim?: boolean },
) {
  const touched = new Set<string>();
  for (;;) {
    const claim = await claimOfficialSlot(connection, ownerId, runId, transport, now, touched, touched.size > 0);
    if ("error" in claim || "status" in claim) return claim;
    touched.add(claim.slotId);
    if (options.crashAfterClaim) throw new Error("official-claim-crash");
    let sample: OfficialSample;
    try {
      const value = await transport.sample(claim.request);
      sample = value.synthetic ? unknownOfficialSample() : value;
    } catch {
      sample = unknownOfficialSample();
    }
    const failure = await writeOfficialResult(connection, ownerId, runId, claim, sample, now);
    if (failure) return failure;
  }
}

export async function pauseMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string) {
  return ownedRun(connection, ownerId, runId, async (_transaction, monitoring, _quota, run) => {
    if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") return persist(monitoring, ownerId, run.id, true);
    const before = await monitoring.slots([run.id]);
    await monitoring.pauseWaiting(run.id);
    const replayed = before.every((slot) => slot.status !== "queued" && slot.status !== "running");
    return persist(monitoring, ownerId, run.id, replayed);
  });
}

export async function continueMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string) {
  return ownedRun(connection, ownerId, runId, async (_transaction, monitoring, _quota, run) => {
    if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") return persist(monitoring, ownerId, run.id, true);
    return persist(monitoring, ownerId, run.id, !(await monitoring.resumeWaiting(run.id)));
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
    if (attempt.transport === "official_api" && attempt.costState === "pending") return denied("OPERATION_CONFLICT");
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
