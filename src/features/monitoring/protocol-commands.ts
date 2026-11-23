import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { samplingProtocolFingerprint } from "./protocol.ts";
import {
  type CreateSamplingProtocolInput,
  type FreezeSamplingProtocolInput,
  type PinSamplingProtocolInput,
  type SamplingProtocolError,
  type SamplingProtocolList,
  type SamplingProtocolPinView,
  type SamplingProtocolView,
} from "./protocol-contracts.ts";
import {
  SamplingProtocolDao,
  type SamplingProtocolPinRecord,
  type SamplingProtocolRecord,
} from "./protocol-dao.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

function failed(error: SamplingProtocolError): { error: SamplingProtocolError } {
  return { error };
}

function flag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function toView(row: SamplingProtocolRecord): SamplingProtocolView {
  return {
    id: row.id,
    protocolId: row.protocolId,
    brandId: row.brandId,
    version: row.version,
    status: row.status,
    newSessionRequired: row.newSessionRequired === 1,
    searchRequired: row.searchRequired === 1,
    targetRegion: row.targetRegion,
    timezone: row.timezone,
    createdAt: row.createdAt,
  };
}

function toPin(pin: SamplingProtocolPinRecord, protocol: SamplingProtocolRecord): SamplingProtocolPinView {
  return {
    runId: pin.runId,
    protocolId: pin.protocolId,
    version: pin.version,
    searchRequired: protocol.searchRequired === 1,
  };
}

function sameFields(left: SamplingProtocolRecord, right: SamplingProtocolRecord) {
  return left.version === right.version
    && left.status === right.status
    && left.fingerprint === right.fingerprint
    && left.operationId === right.operationId
    && left.newSessionRequired === right.newSessionRequired
    && left.searchRequired === right.searchRequired
    && left.targetRegion === right.targetRegion
    && left.timezone === right.timezone
    && left.protocolId === right.protocolId
    && left.brandId === right.brandId;
}

export async function listSamplingProtocols(db: DatabaseConnection, ownerId: string): Promise<SamplingProtocolList> {
  return db.transaction(async (tx) => {
    const dao = new SamplingProtocolDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const protocols = await dao.protocolsForOwner(ownerId);
    const pins = await dao.pinsForOwner(ownerId);
    const byVersion = new Map(protocols.map((row) => [`${row.protocolId}:${row.version}`, row]));
    return {
      brands,
      protocols: protocols.map(toView),
      pins: pins.flatMap((pin) => {
        const protocol = byVersion.get(`${pin.protocolId}:${pin.version}`);
        return protocol ? [toPin(pin, protocol)] : [];
      }),
    };
  });
}

export async function createSamplingProtocol(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateSamplingProtocolInput,
  clock: Clock = systemClock,
): Promise<{ protocol: SamplingProtocolView } | { error: SamplingProtocolError }> {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return failed("NOT_FOUND");
    const owned = await brands.owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return failed("NOT_FOUND");
    const dao = new SamplingProtocolDao(tx);
    const fingerprint = samplingProtocolFingerprint(input);
    const existing = await dao.byOperation(ownerId, input.operationId);
    if (existing) {
      if (existing.brandId !== input.brandId || existing.fingerprint !== fingerprint) return failed("OPERATION_CONFLICT");
      return { protocol: toView(existing) };
    }
    const id = randomUUID();
    const createdAt = clock();
    await dao.insert({
      id,
      protocolId: id,
      brandId: input.brandId,
      ownerId,
      version: 1,
      newSessionRequired: flag(input.newSessionRequired),
      searchRequired: flag(input.searchRequired),
      targetRegion: input.targetRegion,
      timezone: input.timezone,
      status: "draft",
      fingerprint,
      operationId: input.operationId,
      createdAt,
    });
    const stored = await dao.rowForOwner(ownerId, id);
    if (!stored || stored.status !== "draft" || stored.version !== 1 || stored.fingerprint !== fingerprint || stored.protocolId !== id) {
      throw new Error("sampling-protocol-missing");
    }
    return { protocol: toView(stored) };
  });
}

export async function freezeSamplingProtocol(
  db: DatabaseConnection,
  ownerId: string,
  protocolId: string,
  input: FreezeSamplingProtocolInput,
  clock: Clock = systemClock,
): Promise<{ protocol: SamplingProtocolView } | { error: SamplingProtocolError }> {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return failed("NOT_FOUND");
    const dao = new SamplingProtocolDao(tx);
    const fingerprint = samplingProtocolFingerprint(input);
    const byOperation = await dao.byOperation(ownerId, input.operationId);
    if (byOperation) {
      if (byOperation.fingerprint !== fingerprint || byOperation.protocolId !== protocolId) return failed("OPERATION_CONFLICT");
      if (byOperation.status === "draft") await dao.markFrozen(byOperation, input.operationId);
      const current = await dao.rowForOwner(ownerId, byOperation.id);
      if (!current || current.status !== "frozen" || current.fingerprint !== fingerprint || current.version !== byOperation.version) {
        throw new Error("sampling-protocol-freeze-missing");
      }
      return { protocol: toView(current) };
    }
    const versions = await dao.family(ownerId, protocolId);
    const head = versions[0];
    if (!head) return failed("NOT_FOUND");
    const owned = await brands.owned(ownerId, head.brandId);
    if (!owned || owned.status !== "active") return failed("NOT_FOUND");
    const frozen = versions.find((row) => row.status === "frozen" && row.fingerprint === fingerprint);
    if (frozen) return { protocol: toView(frozen) };
    const draft = versions.find((row) => row.status === "draft" && row.fingerprint === fingerprint);
    if (draft) {
      await dao.markFrozen(draft, input.operationId);
      const current = await dao.rowForOwner(ownerId, draft.id);
      if (!current || current.status !== "frozen" || current.version !== draft.version || current.fingerprint !== fingerprint
        || current.targetRegion !== draft.targetRegion || current.timezone !== draft.timezone
        || current.searchRequired !== draft.searchRequired || current.newSessionRequired !== draft.newSessionRequired) {
        throw new Error("sampling-protocol-freeze-missing");
      }
      return { protocol: toView(current) };
    }
    const version = Math.max(...versions.map((row) => row.version)) + 1;
    const id = randomUUID();
    await dao.insert({
      id,
      protocolId,
      brandId: head.brandId,
      ownerId,
      version,
      newSessionRequired: flag(input.newSessionRequired),
      searchRequired: flag(input.searchRequired),
      targetRegion: input.targetRegion,
      timezone: input.timezone,
      status: "frozen",
      fingerprint,
      operationId: input.operationId,
      createdAt: clock(),
    });
    const stored = await dao.rowForOwner(ownerId, id);
    const after = await dao.family(ownerId, protocolId);
    const unchanged = versions.every((row) => {
      const again = after.find((item) => item.id === row.id);
      return again ? sameFields(again, row) : false;
    });
    if (!stored || stored.version !== version || stored.status !== "frozen" || stored.fingerprint !== fingerprint || !unchanged) {
      throw new Error("sampling-protocol-version-missing");
    }
    return { protocol: toView(stored) };
  });
}

export async function pinSamplingProtocol(
  db: DatabaseConnection,
  ownerId: string,
  runId: string,
  input: PinSamplingProtocolInput,
  clock: Clock = systemClock,
): Promise<{ pin: SamplingProtocolPinView } | { error: SamplingProtocolError }> {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return failed("NOT_FOUND");
    const dao = new SamplingProtocolDao(tx);
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return failed("NOT_FOUND");
    const version = await dao.versionForOwner(ownerId, input.protocolId, input.version);
    if (!version || version.brandId !== run.brandId) return failed("NOT_FOUND");
    if (version.status !== "frozen") return failed("NOT_FROZEN");
    const existing = await dao.pinForRun(ownerId, runId);
    if (existing) {
      if (existing.protocolId === version.protocolId && existing.version === version.version) return { pin: toPin(existing, version) };
      return failed("PIN_CONFLICT");
    }
    const owned = await brands.owned(ownerId, run.brandId);
    if (!owned || owned.status !== "active") return failed("NOT_FOUND");
    await dao.insertPin({
      runId,
      brandId: run.brandId,
      ownerId,
      protocolId: version.protocolId,
      version: version.version,
      createdAt: clock(),
    });
    const stored = await dao.pinForRun(ownerId, runId);
    const runAfter = await dao.runForOwner(ownerId, runId);
    if (!stored || stored.protocolId !== version.protocolId || stored.version !== version.version
      || !runAfter || runAfter.requestedNetworkMode !== run.requestedNetworkMode || runAfter.customerPayableMinor !== 0) {
      throw new Error("sampling-protocol-pin-missing");
    }
    return { pin: toPin(stored, version) };
  });
}
