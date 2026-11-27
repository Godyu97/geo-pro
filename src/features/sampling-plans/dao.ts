import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { planPhaseSchema, slotStatusSchema } from "./contracts.ts";

const planRow = z.object({
  id: brandIdSchema,
  version: z.int().positive(),
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  phase: planPhaseSchema,
  currency: z.string().length(3),
  budgetMinor: z.int().min(0),
  spentMinor: z.int().min(0),
  pendingMinor: z.int().min(0),
  createdAt: z.iso.datetime({ precision: 3 }),
  trendThresholdPp: z.number().finite().positive(),
});

const slotRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  channelId: z.string().min(1).max(64),
  at: z.iso.datetime({ precision: 3 }),
  status: slotStatusSchema,
  manual: z.union([z.literal(0), z.literal(1)]),
  costMinor: z.int().min(0),
});

const planIdentityRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
});

export type SamplingPlanRecord = z.infer<typeof planRow>;
export type SamplingSlotRecord = z.infer<typeof slotRow>;
export type SamplingPlanIdentity = z.infer<typeof planIdentityRow>;

const planColumns = `id, version, brand_id AS "brandId", owner_id AS "ownerId", phase, currency,
  budget_minor AS "budgetMinor", spent_minor AS "spentMinor", pending_minor AS "pendingMinor",
  created_at AS "createdAt", trend_threshold_pp AS "trendThresholdPp"`;

const slotColumns = `id, plan_id AS "planId", brand_id AS "brandId", owner_id AS "ownerId",
  channel_id AS "channelId", at, status, manual, cost_minor AS "costMinor"`;

export function samplingPlanListQuery(brandId: string, ownerId: string) {
  return {
    sql: `SELECT ${planColumns} FROM sampling_plan WHERE brand_id = ? AND owner_id = ? ORDER BY id ASC, version ASC`,
    values: [brandId, ownerId] as QueryValue[],
  };
}

export function samplingSlotListQuery(ownerId: string, planIds: readonly string[]) {
  if (planIds.length === 0) return null;
  if (planIds.length === 1) {
    return {
      sql: `SELECT ${slotColumns} FROM sampling_slot WHERE plan_id = ? AND owner_id = ? ORDER BY at ASC, id ASC`,
      values: [planIds[0], ownerId] as QueryValue[],
    };
  }
  return {
    sql: `SELECT ${slotColumns} FROM sampling_slot WHERE plan_id IN (${planIds.map(() => "?").join(", ")}) AND owner_id = ? ORDER BY plan_id ASC, at ASC, id ASC`,
    values: [...planIds, ownerId] as QueryValue[],
  };
}

export class SamplingPlanDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertPlan(row: SamplingPlanRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_plan (
        id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at,
        trend_threshold_pp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.version, row.brandId, row.ownerId, row.phase, row.currency,
        row.budgetMinor, row.spentMinor, row.pendingMinor, row.createdAt, row.trendThresholdPp,
      ],
    );
  }

  async insertSlots(rows: readonly SamplingSlotRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id, row.planId, row.brandId, row.ownerId, row.channelId, row.at, row.status, row.manual, row.costMinor,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_slot (
        id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async planIdentity(planId: string): Promise<SamplingPlanIdentity | null> {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId"
       FROM sampling_plan
       WHERE id = ?
       ORDER BY version DESC
       LIMIT 1`,
      [planId],
    );
    return row ? planIdentityRow.parse(row) : null;
  }

  async planIdentities(planIds: readonly string[]): Promise<SamplingPlanIdentity[]> {
    const unique = [...new Set(planIds)];
    if (unique.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT DISTINCT id, brand_id AS "brandId", owner_id AS "ownerId"
       FROM sampling_plan
       WHERE id IN (${unique.map(() => "?").join(", ")})`,
      unique,
    );
    return z.array(planIdentityRow).parse(rows);
  }

  async plansForBrand(brandId: string, ownerId: string) {
    const query = samplingPlanListQuery(brandId, ownerId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(planRow).parse(rows);
  }

  async versions(ownerId: string, planId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${planColumns} FROM sampling_plan WHERE id = ? AND owner_id = ? ORDER BY version ASC`,
      [planId, ownerId],
    );
    return z.array(planRow).parse(rows);
  }

  async version(ownerId: string, planId: string, version: number) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${planColumns} FROM sampling_plan WHERE id = ? AND owner_id = ? AND version = ?`,
      [planId, ownerId, version],
    );
    return row ? planRow.parse(row) : null;
  }

  async latest(ownerId: string, planId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${planColumns} FROM sampling_plan WHERE id = ? AND owner_id = ? ORDER BY version DESC LIMIT 1${lock}`,
      [planId, ownerId],
    );
    return row ? planRow.parse(row) : null;
  }

  async slotsForPlans(ownerId: string, planIds: readonly string[]) {
    const query = samplingSlotListQuery(ownerId, planIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(slotRow).parse(rows);
  }

  async setTrendThreshold(ownerId: string, planId: string, version: number, trendThresholdPp: number) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sampling_plan SET trend_threshold_pp = ?
       WHERE id = ? AND version = ? AND owner_id = ? AND phase = 'draft'
       RETURNING id`,
      [trendThresholdPp, planId, version, ownerId],
    );
    return rows.length === 1;
  }

  async setPhase(ownerId: string, planId: string, version: number, phase: SamplingPlanRecord["phase"]) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sampling_plan SET phase = ?
       WHERE id = ? AND version = ? AND owner_id = ?
       RETURNING id`,
      [phase, planId, version, ownerId],
    );
    return rows.length === 1;
  }

  async pauseSlots(ownerId: string, planId: string, ids: readonly string[], channelId?: string) {
    if (ids.length === 0) return [];
    const channelSql = channelId ? " AND channel_id = ?" : "";
    const values: QueryValue[] = channelId
      ? [ownerId, planId, channelId, ...ids]
      : [ownerId, planId, ...ids];
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sampling_slot SET status = 'paused'
       WHERE owner_id = ? AND plan_id = ?${channelSql} AND status = 'scheduled' AND id IN (${ids.map(() => "?").join(", ")})
       RETURNING id`,
      values,
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async completeSlots(ownerId: string, planId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sampling_slot SET status = 'completed'
       WHERE owner_id = ? AND plan_id = ? AND status = 'scheduled' AND id IN (${ids.map(() => "?").join(", ")})
       RETURNING id`,
      [ownerId, planId, ...ids],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }
}
