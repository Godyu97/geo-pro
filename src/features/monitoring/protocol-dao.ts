import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import {
  samplingProtocolFamilyLimit,
  samplingProtocolListLimit,
  samplingProtocolPinListLimit,
  samplingRegionSchema,
  samplingTimezoneSchema,
} from "./protocol-contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });
const flag = z.union([z.literal(0), z.literal(1)]);

const protocolRow = z.object({
  id: brandIdSchema,
  protocolId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  newSessionRequired: flag,
  searchRequired: flag,
  targetRegion: samplingRegionSchema,
  timezone: samplingTimezoneSchema,
  status: z.enum(["draft", "frozen"]),
  fingerprint: z.string().length(64),
  operationId: brandIdSchema,
  createdAt: timestampSchema,
});

const pinRow = z.object({
  runId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  protocolId: brandIdSchema,
  version: z.number().int().positive(),
  createdAt: timestampSchema,
});

const runRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  requestedNetworkMode: z.enum(networkModes),
  customerPayableMinor: z.literal(0),
});

export type SamplingProtocolRecord = z.infer<typeof protocolRow>;
export type SamplingProtocolPinRecord = z.infer<typeof pinRow>;
export type SamplingProtocolRunRecord = z.infer<typeof runRow>;

export type SamplingProtocolInsert = {
  id: string;
  protocolId: string;
  brandId: string;
  ownerId: string;
  version: number;
  newSessionRequired: 0 | 1;
  searchRequired: 0 | 1;
  targetRegion: string;
  timezone: string;
  status: "draft" | "frozen";
  fingerprint: string;
  operationId: string;
  createdAt: string;
};

const protocolColumns = `id, protocol_id AS "protocolId", brand_id AS "brandId", owner_id AS "ownerId",
  version, new_session_required AS "newSessionRequired", search_required AS "searchRequired",
  target_region AS "targetRegion", timezone, status, fingerprint, operation_id AS "operationId",
  created_at AS "createdAt"`;

const pinColumns = `run_id AS "runId", brand_id AS "brandId", owner_id AS "ownerId",
  protocol_id AS "protocolId", version, created_at AS "createdAt"`;

export function samplingProtocolsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${protocolColumns} FROM sampling_protocol
      WHERE owner_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    values: [ownerId, samplingProtocolListLimit] as QueryValue[],
  };
}

export function samplingProtocolFamilyQuery(ownerId: string, protocolId: string) {
  return {
    sql: `SELECT ${protocolColumns} FROM sampling_protocol
      WHERE owner_id = ? AND protocol_id = ?
      ORDER BY version ASC
      LIMIT ?`,
    values: [ownerId, protocolId, samplingProtocolFamilyLimit] as QueryValue[],
  };
}

export function samplingProtocolPinsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${pinColumns} FROM run_protocol_pin
      WHERE owner_id = ?
      ORDER BY created_at ASC, run_id ASC
      LIMIT ?`,
    values: [ownerId, samplingProtocolPinListLimit] as QueryValue[],
  };
}

export class SamplingProtocolDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id FROM brand
        WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [ownerId, 20],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async protocolsForOwner(ownerId: string) {
    const query = samplingProtocolsForOwnerQuery(ownerId);
    return z.array(protocolRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async latestFrozenForBrand(ownerId: string, brandId: string) {
    const [row] = await queryWithParameters(this.db,
      `SELECT ${protocolColumns} FROM sampling_protocol
        WHERE owner_id = ? AND brand_id = ? AND status = 'frozen'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [ownerId, brandId]);
    return row ? protocolRow.parse(row) : null;
  }

  async family(ownerId: string, protocolId: string) {
    const query = samplingProtocolFamilyQuery(ownerId, protocolId);
    return z.array(protocolRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async byOperation(ownerId: string, operationId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${protocolColumns} FROM sampling_protocol
        WHERE owner_id = ? AND operation_id = ?
        LIMIT 1`,
      [ownerId, operationId],
    );
    return z.array(protocolRow).parse(rows)[0] ?? null;
  }

  async rowForOwner(ownerId: string, id: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${protocolColumns} FROM sampling_protocol
        WHERE owner_id = ? AND id = ?
        LIMIT 1`,
      [ownerId, id],
    );
    return z.array(protocolRow).parse(rows)[0] ?? null;
  }

  async versionForOwner(ownerId: string, protocolId: string, version: number) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${protocolColumns} FROM sampling_protocol
        WHERE owner_id = ? AND protocol_id = ? AND version = ?
        LIMIT 1`,
      [ownerId, protocolId, version],
    );
    return z.array(protocolRow).parse(rows)[0] ?? null;
  }

  async insert(row: SamplingProtocolInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_protocol (
        id, protocol_id, brand_id, owner_id, version, new_session_required, search_required,
        target_region, timezone, status, fingerprint, operation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.protocolId, row.brandId, row.ownerId, row.version, row.newSessionRequired, row.searchRequired,
        row.targetRegion, row.timezone, row.status, row.fingerprint, row.operationId, row.createdAt],
    );
  }

  async markFrozen(row: SamplingProtocolRecord, operationId: string) {
    await queryWithParameters(
      this.db,
      `UPDATE sampling_protocol
        SET status = 'frozen', operation_id = ?
        WHERE id = ? AND owner_id = ? AND protocol_id = ? AND status = 'draft' AND version = ?
          AND fingerprint = ? AND new_session_required = ? AND search_required = ?
          AND target_region = ? AND timezone = ?`,
      [operationId, row.id, row.ownerId, row.protocolId, row.version, row.fingerprint, row.newSessionRequired,
        row.searchRequired, row.targetRegion, row.timezone],
    );
  }

  async runForOwner(ownerId: string, runId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", requested_network_mode AS "requestedNetworkMode",
        customer_payable_minor AS "customerPayableMinor"
        FROM monitoring_run WHERE id = ? AND owner_id = ? LIMIT 1`,
      [runId, ownerId],
    );
    return z.array(runRow).parse(rows)[0] ?? null;
  }

  async pinsForOwner(ownerId: string) {
    const query = samplingProtocolPinsForOwnerQuery(ownerId);
    return z.array(pinRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async pinForRun(ownerId: string, runId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${pinColumns} FROM run_protocol_pin WHERE owner_id = ? AND run_id = ? LIMIT 1`,
      [ownerId, runId],
    );
    return z.array(pinRow).parse(rows)[0] ?? null;
  }

  async insertPin(row: SamplingProtocolPinRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO run_protocol_pin (run_id, brand_id, owner_id, protocol_id, version, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [row.runId, row.brandId, row.ownerId, row.protocolId, row.version, row.createdAt],
    );
  }
}
