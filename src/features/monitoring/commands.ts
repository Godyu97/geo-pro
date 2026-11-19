import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { CapabilityDao } from "../capabilities/dao.ts";
import { formalRunEligibility } from "../capabilities/rules.ts";
import { PromptDao } from "../prompts/dao.ts";
import { QuotaDao } from "../quotas/dao.ts";
import { grantState } from "../quotas/ledger.ts";
import {
  acceptRequestSchema,
  previewRequestSchema,
  previewSnapshotSchema,
  type AcceptRequest,
  type MonitoringError,
  type MonitoringNextStep,
  type PreviewRequest,
  type PreviewSnapshot,
} from "./contracts.ts";
import { MonitoringDao, type MonitoringRunRow, type MonitoringSlotRow } from "./dao.ts";
import { expiresAtFor, previewToken, previewTokenMatches, runFingerprint, scaleMinor } from "./rules.ts";

type Denied = { error: MonitoringError; next: MonitoringNextStep | null };
type Prepared = {
  snapshot: PreviewSnapshot;
  questions: Array<{ id: string; natural: 0 | 1 }>;
  upperMinor: number | null;
  estimateHighMinor: number | null;
};

export type StoredRun = MonitoringRunRow & { slots: MonitoringSlotRow[]; replayed?: boolean };

function denied(error: MonitoringError, next: MonitoringNextStep | null = null): Denied {
  return { error, next };
}

function isDenied(value: Prepared | Denied | StoredRun): value is Denied {
  return "error" in value;
}

function sameScope(left: PreviewSnapshot, right: PreviewSnapshot) {
  const channels = (items: PreviewSnapshot["channels"]) => [...items]
    .sort((a, b) => a.channelId.localeCompare(b.channelId))
    .map((item) => `${item.channelId}.${item.version}`).join(",");
  return left.brandId === right.brandId && left.track === right.track && left.promptSetId === right.promptSetId
    && left.promptSetVersion === right.promptSetVersion && left.repeats === right.repeats
    && left.requestedNetworkMode === right.requestedNetworkMode && channels(left.channels) === channels(right.channels)
    && left.grantVersion === right.grantVersion
    && left.ceiling?.currency === right.ceiling?.currency && left.ceiling?.upperMinor === right.ceiling?.upperMinor
    && left.questionCount === right.questionCount && left.naturalCount === right.naturalCount
    && left.region === right.region && left.language === right.language;
}

async function loadScope(connection: QueryConnection, ownerId: string, input: PreviewRequest, now: string): Promise<Prepared | Denied> {
  const monitoring = new MonitoringDao(connection);
  if (input.track === "model_api" && !(await monitoring.emailVerified(ownerId))) return denied("EMAIL_UNVERIFIED", "verify-email");
  if (input.track === "model_api" && !input.ceiling) return denied("NO_TRUSTED_CEILING", "confirm-ceiling");
  if (input.track === "consumer_ui" && input.ceiling) return denied("INVALID_INPUT");
  if (new Set(input.channelIds).size !== input.channelIds.length) return denied("INVALID_INPUT");

  const prompt = await new PromptDao(connection, input.brandId).version(input.promptSetId);
  if (!prompt) return denied("NOT_FOUND");
  const confirmed = prompt.content.questions
    .filter((question) => question.status === "confirmed")
    .sort((left, right) => left.id.localeCompare(right.id));
  const naturalCount = confirmed.filter((question) => question.primary).length;
  if (confirmed.length === 0 || naturalCount < 3) return denied("NOT_READY", "add-primary");

  const channels = await new CapabilityDao(connection).latestByIds(input.channelIds);
  if (channels.length !== input.channelIds.length) return denied("CHANNEL_UNVERIFIED", "verify-channel");
  const ordered = [...channels].sort((left, right) => left.channelId.localeCompare(right.channelId));
  if (ordered.some((channel) => channel.kind !== input.track || formalRunEligibility(channel, now) !== "eligible")) {
    return denied("CHANNEL_UNVERIFIED", "verify-channel");
  }

  const slotCount = confirmed.length * ordered.length * input.repeats;
  let grantVersion: number | null = null;
  let upperMinor: number | null = null;
  let estimateHighMinor: number | null = null;
  if (input.track === "model_api" && input.ceiling) {
    const quota = new QuotaDao(connection);
    const grant = await quota.grant(input.brandId, "sampling");
    if (!grant || grantState(grant, now) !== "active") return denied("NOT_ENTITLED", "request-quota");
    if (grant.currency !== input.ceiling.currency) return denied("NOT_ENTITLED", "confirm-ceiling");
    const total = scaleMinor(input.ceiling.upperMinor, slotCount);
    if (total === null) return denied("INVALID_INPUT");
    const ledger = await quota.ledger(input.brandId, "sampling");
    if (ledger.reserved + ledger.settled + slotCount > grant.countLimit || ledger.committedMinor + total > grant.budgetMinor) {
      return denied("QUOTA_INSUFFICIENT", "adjust-scope");
    }
    grantVersion = grant.version;
    upperMinor = input.ceiling.upperMinor;
    estimateHighMinor = total;
  }

  return {
    snapshot: previewSnapshotSchema.parse({
      brandId: input.brandId,
      track: input.track,
      promptSetId: prompt.id,
      promptSetVersion: prompt.version,
      repeats: input.repeats,
      requestedNetworkMode: input.requestedNetworkMode,
      channels: ordered.map((channel) => ({ channelId: channel.channelId, version: channel.version })),
      grantVersion,
      ceiling: input.ceiling,
      questionCount: confirmed.length,
      naturalCount,
      region: prompt.region,
      language: prompt.language,
      previewedAt: now,
      expiresAt: expiresAtFor(now),
    }),
    questions: confirmed.map((question) => ({ id: question.id, natural: question.primary ? 1 as const : 0 as const })),
    upperMinor,
    estimateHighMinor,
  };
}

export async function previewMonitoringRun(
  connection: DatabaseConnection,
  ownerId: string,
  input: PreviewRequest,
  secret: string,
  now = () => new Date().toISOString(),
) {
  const parsed = previewRequestSchema.parse(input);
  try {
    const result = await connection.transaction(async (transaction) => {
      const brand = await new QuotaDao(transaction).lockBrand(parsed.brandId, ownerId);
      if (!brand) return denied("NOT_FOUND");
      if (brand !== "active") return denied("NOT_ENTITLED");
      return loadScope(transaction, ownerId, parsed, now());
    });
    if (isDenied(result)) return result;
    return { snapshot: result.snapshot, token: previewToken(result.snapshot, secret) };
  } catch {
    return denied("SERVICE_UNAVAILABLE");
  }
}

async function withSlots(dao: MonitoringDao, run: MonitoringRunRow, replayed = false): Promise<StoredRun> {
  return { ...run, slots: await dao.slots([run.id]), replayed };
}

export async function acceptMonitoringRun(
  connection: DatabaseConnection,
  ownerId: string,
  input: AcceptRequest,
  secret: string,
  now = () => new Date().toISOString(),
) {
  const parsed = acceptRequestSchema.parse(input);
  const time = now();
  if (!previewTokenMatches(parsed, parsed.token, secret)) return denied("INVALID_INPUT");
  if (parsed.expiresAt !== expiresAtFor(parsed.previewedAt) || Date.parse(parsed.previewedAt) > Date.parse(time)) {
    return denied("INVALID_INPUT");
  }
  try {
    return await connection.transaction(async (transaction) => {
      const quota = new QuotaDao(transaction);
      const brand = await quota.lockBrand(parsed.brandId, ownerId);
      if (!brand) return denied("NOT_FOUND");
      const monitoring = new MonitoringDao(transaction);
      const existing = await monitoring.runByOperation(parsed.brandId, parsed.operationId);
      if (existing) {
        if (existing.fingerprint !== runFingerprint(parsed)) return denied("OPERATION_CONFLICT", "refresh-preview");
        return withSlots(monitoring, existing, true);
      }
      if (Date.parse(parsed.expiresAt) <= Date.parse(time)) return denied("PREVIEW_EXPIRED", "refresh-preview");
      if (brand !== "active") return denied("NOT_ENTITLED");
      const current = await loadScope(transaction, ownerId, {
        action: "preview",
        brandId: parsed.brandId,
        track: parsed.track,
        promptSetId: parsed.promptSetId,
        repeats: parsed.repeats,
        requestedNetworkMode: parsed.requestedNetworkMode,
        channelIds: parsed.channels.map((channel) => channel.channelId),
        ceiling: parsed.ceiling,
      }, time);
      if (isDenied(current)) return current;
      if (!sameScope(current.snapshot, parsed)) return denied("VERSION_CONFLICT", "refresh-preview");

      const runId = randomUUID();
      const slots: MonitoringSlotRow[] = [];
      for (const question of current.questions) {
        for (const channel of current.snapshot.channels) {
          for (let repeatIndex = 1; repeatIndex <= parsed.repeats; repeatIndex += 1) {
            const id = randomUUID();
            slots.push({
              id, runId, brandId: parsed.brandId, questionId: question.id, natural: question.natural,
              channelId: channel.channelId, channelVersion: channel.version,
              repeatIndex: repeatIndex as 1 | 2 | 3,
              reservationId: parsed.track === "model_api" ? id : null,
              status: "queued", createdAt: time,
            });
          }
        }
      }
      if (parsed.track === "model_api" && current.snapshot.grantVersion !== null && current.upperMinor !== null) {
        await monitoring.insertReservations(parsed.brandId, current.snapshot.grantVersion,
          slots.map((slot) => ({ id: slot.id, upperMinor: current.upperMinor ?? 0 })), time);
      }
      const run: MonitoringRunRow = {
        id: runId, brandId: parsed.brandId, ownerId, operationId: parsed.operationId,
        fingerprint: runFingerprint(parsed), track: parsed.track, promptSetId: parsed.promptSetId,
        promptSetVersion: parsed.promptSetVersion, repeatCount: parsed.repeats,
        questionCount: parsed.questionCount, naturalCount: parsed.naturalCount,
        channelCount: parsed.channels.length, slotCount: slots.length, region: parsed.region,
        language: parsed.language, requestedNetworkMode: parsed.requestedNetworkMode,
        currency: parsed.ceiling?.currency ?? null, upperMinor: current.upperMinor,
        estimateHighMinor: current.estimateHighMinor, customerPayableMinor: 0,
        status: "queued", samplingComplete: 0, createdAt: time,
      };
      await monitoring.insertRun(run);
      await monitoring.insertSlots(slots);
      await new PromptDao(transaction, parsed.brandId).reference(
        parsed.promptSetId, current.questions.map((question) => question.id), runId,
      );
      return { ...run, slots, replayed: false };
    });
  } catch {
    return denied("SERVICE_UNAVAILABLE");
  }
}

export async function readMonitoringRun(connection: DatabaseConnection, ownerId: string, runId: string) {
  try {
    const dao = new MonitoringDao(connection);
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return denied("NOT_FOUND");
    return withSlots(dao, run);
  } catch {
    return denied("SERVICE_UNAVAILABLE");
  }
}
