import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  calendarDaySchema,
  checkpointModeSchema,
  checkpointSchema,
  confounderFactorSchema,
  frozenSetIdSchema,
  observationStatusSchema,
  questionIdSchema,
} from "./contracts.ts";

const observationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  frozenSetId: frozenSetIdSchema,
  effectiveOn: calendarDaySchema,
  frozenNonBrandCount: z.number().int().min(1).max(500),
  status: observationStatusSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const checkpointRow = z.object({
  id: brandIdSchema,
  observationId: brandIdSchema,
  brandId: brandIdSchema,
  checkpoint: checkpointSchema,
  mode: checkpointModeSchema,
  comparableCount: z.number().int().min(0).max(500),
  excludedJson: z.string().min(2).max(4000),
  conclusion: z.string().min(2).max(400).nullable(),
  evaluatedOn: calendarDaySchema,
  createdAt: z.iso.datetime({ precision: 3 }),
}).superRefine((row, ctx) => {
  const empty = row.conclusion === null;
  if ((row.mode === "progress") !== empty) {
    ctx.addIssue({ code: "custom", message: "conclusion" });
  }
  const excluded = z.array(questionIdSchema).max(40).safeParse(JSON.parse(row.excludedJson));
  if (!excluded.success) ctx.addIssue({ code: "custom", message: "excluded" });
});

const confounderRow = z.object({
  id: brandIdSchema,
  observationId: brandIdSchema,
  brandId: brandIdSchema,
  factor: confounderFactorSchema,
  note: z.string().trim().min(1).max(400),
  recordedAt: z.iso.datetime({ precision: 3 }),
});

export type FormalObservationRecord = z.infer<typeof observationRow>;
export type FormalCheckpointRecord = z.infer<typeof checkpointRow>;
export type FormalCheckpointInsert = FormalCheckpointRecord & { ownerId: string };
export type FormalConfounderRecord = z.infer<typeof confounderRow>;
export type FormalConfounderInsert = FormalConfounderRecord & { ownerId: string };

const observationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", frozen_set_id AS "frozenSetId",
  effective_on AS "effectiveOn", frozen_non_brand_count AS "frozenNonBrandCount", status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const checkpointColumns = `id, observation_id AS "observationId", brand_id AS "brandId", checkpoint, mode,
  comparable_count AS "comparableCount", excluded_json AS "excludedJson", conclusion,
  evaluated_on AS "evaluatedOn", created_at AS "createdAt"`;

const confounderColumns = `id, observation_id AS "observationId", brand_id AS "brandId", factor, note,
  recorded_at AS "recordedAt"`;

export function formalObservationListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${observationColumns} FROM formal_observation
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function formalCheckpointListQuery(ownerId: string, observationIds: readonly string[]) {
  if (observationIds.length === 0) return null;
  return {
    sql: `SELECT ${checkpointColumns} FROM formal_checkpoint
      WHERE owner_id = ? AND observation_id IN (${observationIds.map(() => "?").join(", ")})
      ORDER BY observation_id ASC, created_at ASC, id ASC`,
    values: [ownerId, ...observationIds] as QueryValue[],
  };
}

export function formalConfounderListQuery(ownerId: string, observationIds: readonly string[]) {
  if (observationIds.length === 0) return null;
  return {
    sql: `SELECT ${confounderColumns} FROM formal_confounder
      WHERE owner_id = ? AND observation_id IN (${observationIds.map(() => "?").join(", ")})
      ORDER BY recorded_at ASC, id ASC`,
    values: [ownerId, ...observationIds] as QueryValue[],
  };
}

export class FormalObservationDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertObservations(rows: readonly FormalObservationRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id, row.brandId, row.ownerId, row.frozenSetId, row.effectiveOn,
        row.frozenNonBrandCount, row.status, row.createdAt, row.updatedAt,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO formal_observation (
        id, brand_id, owner_id, frozen_set_id, effective_on, frozen_non_brand_count, status, created_at, updated_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async insertCheckpoints(rows: readonly FormalCheckpointInsert[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id, row.observationId, row.brandId, row.ownerId, row.checkpoint, row.mode,
        row.comparableCount, row.excludedJson, row.conclusion, row.evaluatedOn, row.createdAt,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO formal_checkpoint (
        id, observation_id, brand_id, owner_id, checkpoint, mode, comparable_count, excluded_json,
        conclusion, evaluated_on, created_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async observationForOwner(ownerId: string, observationId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${observationColumns} FROM formal_observation WHERE id = ? AND owner_id = ? LIMIT 1${lock}`,
      [observationId, ownerId],
    );
    return row ? observationRow.parse(row) : null;
  }

  async observationsForBrand(ownerId: string, brandId: string) {
    const query = formalObservationListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(observationRow).parse(rows);
  }

  async checkpointsFor(ownerId: string, observationIds: readonly string[]) {
    const query = formalCheckpointListQuery(ownerId, observationIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(checkpointRow).parse(rows);
  }

  async insertConfounders(rows: readonly FormalConfounderInsert[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(row.id, row.observationId, row.brandId, row.ownerId, row.factor, row.note, row.recordedAt);
      return "(?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO formal_confounder (
        id, observation_id, brand_id, owner_id, factor, note, recorded_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async confoundersFor(ownerId: string, observationIds: readonly string[]) {
    const query = formalConfounderListQuery(ownerId, observationIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(confounderRow).parse(rows);
  }

  async markCheckpointDue(ownerId: string, observationId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE formal_observation SET status = 'checkpoint_due', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'observing'
       RETURNING id`,
      [updatedAt, observationId, ownerId],
    );
    return rows.length === 1;
  }
}
