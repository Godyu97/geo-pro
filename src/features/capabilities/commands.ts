import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { runMaintenanceAction } from "../maintenance/core.ts";
import {
  answerNetworkInputSchema,
  capabilityChangeSchema,
  capabilityValues,
  formalRunSchema,
  type AnswerNetworkInput,
  type AnswerNetworkRecord,
  type CapabilityChange,
  type CapabilityError,
  type CapabilitySnapshot,
  type FormalRunRequest,
} from "./contracts.ts";
import { CapabilityDao } from "./dao.ts";
import { defaultExpiresAt, deriveNetworkEvidence, formalRunEligibility } from "./rules.ts";

type ChangeResult =
  | { before: CapabilitySnapshot | null; after: CapabilitySnapshot }
  | { error: CapabilityError; current?: CapabilitySnapshot | null };

function snapshotFrom(command: CapabilityChange, channelId: string, version: number, changedAt: string): CapabilitySnapshot | null {
  const values = capabilityValues.parse(command);
  if (command.reason === "significant-change" && command.status === "verified") return null;
  if (command.status === "verified") {
    const verifiedAt = values.verifiedAt ?? changedAt;
    const expiresAt = values.expiresAt ?? defaultExpiresAt(verifiedAt);
    if (expiresAt <= changedAt || expiresAt <= verifiedAt) return null;
    return {
      ...values, channelId, vendorId: command.vendorId, kind: command.kind, version,
      status: command.status, reason: command.reason, verifiedAt, expiresAt,
      publicVisible: values.publicVisible, changedAt,
    };
  }
  if (values.publicVisible === 1) return null;
  return {
    ...values, channelId, vendorId: command.vendorId, kind: command.kind, version,
    status: command.status, reason: command.reason, publicVisible: 0, changedAt,
  };
}

export async function recordCapability(
  connection: DatabaseConnection,
  actorId: string,
  command: CapabilityChange,
  now = () => new Date().toISOString(),
) {
  const parsed = capabilityChangeSchema.parse(command);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  return runMaintenanceAction(connection, actorId, "capability.write", async (transaction): Promise<ChangeResult> => {
    if (parsed.actorId !== actorId) return { error: "SESSION_CHANGED" };
    const dao = new CapabilityDao(transaction);
    const existing = await dao.previousChange(parsed.operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { error: "OPERATION_CONFLICT" };
      const before = existing.after.version > 1
        ? await dao.snapshot(existing.after.channelId, existing.after.version - 1)
        : null;
      return { before, after: existing.after };
    }

    const changedAt = now();
    if (parsed.expectedVersion === null) {
      if (parsed.channelId) return { error: "INVALID_INPUT" };
      const after = snapshotFrom(parsed, randomUUID(), 1, changedAt);
      if (!after) return { error: "INVALID_INPUT" };
      await dao.insertChannel(after.channelId, parsed.vendorId, parsed.kind, changedAt);
      await dao.appendVersion(parsed, after, fingerprint);
      return { before: null, after };
    }

    if (!parsed.channelId) return { error: "INVALID_INPUT" };
    const channel = await dao.lockChannel(parsed.channelId);
    if (!channel) return { error: "NOT_FOUND" };
    if (channel.vendorId !== parsed.vendorId || channel.kind !== parsed.kind) return { error: "INVALID_INPUT" };
    const before = await dao.snapshot(parsed.channelId);
    if ((before?.version ?? null) !== parsed.expectedVersion) {
      return { error: "VERSION_CONFLICT", current: before ?? null };
    }
    const after = snapshotFrom(parsed, parsed.channelId, parsed.expectedVersion + 1, changedAt);
    if (!after) return { error: "INVALID_INPUT" };
    await dao.appendVersion(parsed, after, fingerprint);
    return { before, after };
  });
}

export async function confirmFormalRun(
  connection: DatabaseConnection,
  actorId: string,
  input: FormalRunRequest,
  now = () => new Date().toISOString(),
) {
  const parsed = formalRunSchema.parse(input);
  try {
    const dao = new CapabilityDao(connection);
    const uniqueIds = [...new Set(parsed.channelIds)];
    const snapshots = await dao.latestByIds(uniqueIds);
    const denials = uniqueIds.map((channelId) => {
      const snapshot = snapshots.find((item) => item.channelId === channelId) ?? null;
      const eligibility = formalRunEligibility(snapshot, now());
      return { channelId, eligibility, kind: snapshot?.kind ?? null, vendorId: snapshot?.vendorId ?? null };
    });
    if (parsed.space === "demo") {
      return { status: "allowed" as const, eligible: false, space: "demo" as const, denials, reason: "demo-not-formal" as const };
    }
    const blocked = denials.filter((item) => item.eligibility !== "eligible");
    if (blocked.length) {
      return { status: "allowed" as const, eligible: false, space: "formal" as const, denials: blocked, reason: "CHANNEL_UNVERIFIED" as const };
    }
    return { status: "allowed" as const, eligible: true, space: "formal" as const, denials, reason: "RUN_NOT_OPEN" as const };
  } catch {
    return { status: "unavailable" as const, actorId };
  }
}

export async function saveAnswerNetwork(
  connection: DatabaseConnection,
  actorId: string,
  input: AnswerNetworkInput,
  now = () => new Date().toISOString(),
): Promise<{ status: "allowed"; record: AnswerNetworkRecord } | { status: "denied"; error: CapabilityError } | { status: "unavailable" }> {
  const parsed = answerNetworkInputSchema.parse(input);
  try {
    return await connection.transaction(async (transaction) => {
      const dao = new CapabilityDao(transaction);
      if (!(await dao.lockBrand(parsed.brandId, actorId))) return { status: "denied" as const, error: "NOT_FOUND" };
      const [channel] = await dao.latest(parsed.channelId);
      if (!channel) return { status: "denied" as const, error: "NOT_FOUND" };
      const derived = deriveNetworkEvidence({
        requestedNetworkMode: parsed.requestedNetworkMode,
        triggerEvidence: parsed.triggerEvidence,
        searchRequired: channel.searchRequired,
      });
      const record: AnswerNetworkRecord = {
        id: randomUUID(),
        brandId: parsed.brandId,
        channelId: parsed.channelId,
        channelVersion: channel.version,
        requestedNetworkMode: parsed.requestedNetworkMode,
        actualNetwork: derived.actualNetwork,
        triggerEvidence: parsed.triggerEvidence,
        qualifiesRequiredSearch: derived.qualifiesRequiredSearch,
        createdAt: now(),
      };
      await dao.insertAnswerNetwork(record, actorId);
      return { status: "allowed" as const, record };
    });
  } catch {
    return { status: "unavailable" };
  }
}
