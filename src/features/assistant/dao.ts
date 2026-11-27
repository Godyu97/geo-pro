import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { blockReasonSchema, itemStatusSchema, planStatusSchema, reviewNextStepSchema, type AssistantPlanReviewView } from "./contracts.ts";

const stamp = z.iso.datetime({ precision: 3 });
const flag = z.coerce.number().int().min(0).max(1);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const planRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  materialHash: hashSchema,
  status: planStatusSchema,
  controlsUnchanged: flag,
  ignored: flag,
  budgetMinor: z.coerce.number().int().min(0).max(1_000_000_000),
  strategyLabel: z.literal("observation"),
  guaranteed: z.coerce.number().int().min(0).max(0),
  successes: z.coerce.number().int().min(0).max(1_000_000),
  createdAt: stamp,
  updatedAt: stamp,
}).superRefine((row, ctx) => {
  if (row.controlsUnchanged !== 1 || row.guaranteed !== 0) {
    ctx.addIssue({ code: "custom", message: "controls" });
  }
});

const itemRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  position: z.coerce.number().int().min(1).max(5),
  actionText: z.string().min(1).max(200),
  factVersionId: brandIdSchema,
  factCurrent: flag,
  status: itemStatusSchema,
  blockReason: blockReasonSchema.nullable(),
  createdAt: stamp,
  updatedAt: stamp,
}).superRefine((row, ctx) => {
  const blocked = row.status === "blocked";
  if (blocked !== (row.blockReason === "fact_stale")) {
    ctx.addIssue({ code: "custom", message: "block" });
  }
});

const factRow = z.object({
  id: brandIdSchema,
  factCurrent: flag,
});

const reviewRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  executedCount: z.coerce.number().int().min(0).max(5),
  staleBlockedCount: z.coerce.number().int().min(0).max(5),
  nextStep: reviewNextStepSchema,
  createdAt: stamp,
});

export type AssistantPlanRecord = z.infer<typeof planRow>;
export type AssistantPlanItemRecord = z.infer<typeof itemRow>;
export type FactCurrentRecord = z.infer<typeof factRow>;

const planColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", material_hash AS "materialHash",
  status, controls_unchanged AS "controlsUnchanged", ignored, budget_minor AS "budgetMinor",
  strategy_label AS "strategyLabel", guaranteed, successes, created_at AS "createdAt", updated_at AS "updatedAt"`;

const itemColumns = `id, plan_id AS "planId", brand_id AS "brandId", owner_id AS "ownerId", position,
  action_text AS "actionText", fact_version_id AS "factVersionId", fact_current AS "factCurrent",
  status, block_reason AS "blockReason", created_at AS "createdAt", updated_at AS "updatedAt"`;

function lockClause(db: QueryConnection) {
  return db.kind === "postgresql" ? " FOR UPDATE" : "";
}

export function assistantPlanListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${planColumns} FROM assistant_plan
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT 20`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function assistantPlanReviewsQuery(ownerId: string, planIds: readonly string[]) {
  return {
    sql: `SELECT r.id, r.plan_id AS "planId", r.executed_count AS "executedCount",
        r.stale_blocked_count AS "staleBlockedCount", r.next_step AS "nextStep", r.created_at AS "createdAt"
      FROM assistant_plan_review r
      JOIN assistant_plan p ON p.id = r.plan_id
      JOIN brand b ON b.id = p.brand_id
      WHERE p.owner_id = ? AND b.owner_id = ? AND b.frozen_at IS NULL AND p.status = 'settled'
        AND r.plan_id IN (${planIds.map(() => "?").join(", ")})`,
    values: [ownerId, ownerId, ...planIds] as QueryValue[],
  };
}

export class AssistantPlanDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertPlan(row: AssistantPlanRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO assistant_plan (
        id, brand_id, owner_id, material_hash, status, controls_unchanged, ignored, budget_minor,
        strategy_label, guaranteed, successes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.materialHash, row.status, row.controlsUnchanged, row.ignored,
        row.budgetMinor, row.strategyLabel, row.guaranteed, row.successes, row.createdAt, row.updatedAt,
      ],
    );
  }

  async insertItems(rows: readonly AssistantPlanItemRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id, row.planId, row.brandId, row.ownerId, row.position, row.actionText, row.factVersionId,
        row.factCurrent, row.status, row.blockReason, row.createdAt, row.updatedAt,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO assistant_plan_item (
        id, plan_id, brand_id, owner_id, position, action_text, fact_version_id, fact_current,
        status, block_reason, created_at, updated_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async planIdentity(planId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId" FROM assistant_plan WHERE id = ? LIMIT 1`,
      [planId],
    );
    return row
      ? z.object({ id: brandIdSchema, brandId: brandIdSchema, ownerId: z.string().min(1).max(128) }).parse(row)
      : null;
  }

  async planForOwner(ownerId: string, planId: string, forUpdate = false) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${planColumns} FROM assistant_plan WHERE id = ? AND owner_id = ? LIMIT 1${forUpdate ? lockClause(this.db) : ""}`,
      [planId, ownerId],
    );
    return row ? planRow.parse(row) : null;
  }

  async plansForBrand(ownerId: string, brandId: string) {
    const query = assistantPlanListQuery(ownerId, brandId);
    return z.array(planRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async reviewsForPlans(ownerId: string, planIds: readonly string[]) {
    if (planIds.length === 0) return [];
    const query = assistantPlanReviewsQuery(ownerId, planIds);
    return z.array(reviewRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async insertReview(review: AssistantPlanReviewView) {
    await queryWithParameters(
      this.db,
      `INSERT INTO assistant_plan_review (id, plan_id, executed_count, stale_blocked_count, next_step, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [review.id, review.planId, review.executedCount, review.staleBlockedCount, review.nextStep, review.createdAt],
    );
  }

  async itemsForPlans(ownerId: string, planIds: readonly string[], forUpdate = false) {
    if (planIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${itemColumns} FROM assistant_plan_item
       WHERE owner_id = ? AND plan_id IN (${planIds.map(() => "?").join(", ")})
       ORDER BY plan_id ASC, position ASC${forUpdate ? lockClause(this.db) : ""}`,
      [ownerId, ...planIds],
    );
    return z.array(itemRow).parse(rows);
  }

  async currentFacts(brandId: string, factVersionIds: readonly string[], forUpdate = false) {
    if (factVersionIds.length === 0) return [];
    const marks = factVersionIds.map(() => "?").join(", ");
    if (forUpdate) {
      await queryWithParameters(
        this.db,
        `SELECT id FROM brand_fact_version WHERE brand_id = ? AND id IN (${marks})${lockClause(this.db)}`,
        [brandId, ...factVersionIds],
      );
    }
    const rows = await queryWithParameters(
      this.db,
      `SELECT id,
         CASE WHEN state = 'approved' AND revoked_at IS NULL AND version = (
           SELECT MAX(newer.version) FROM brand_fact_version newer
           WHERE newer.brand_id = brand_fact_version.brand_id
             AND newer.fact_id = brand_fact_version.fact_id
             AND newer.state = 'approved'
             AND newer.revoked_at IS NULL
         ) THEN 1 ELSE 0 END AS "factCurrent"
       FROM brand_fact_version
       WHERE brand_id = ? AND id IN (${marks})`,
      [brandId, ...factVersionIds],
    );
    return z.array(factRow).parse(rows);
  }

  async confirmItems(ownerId: string, planId: string, itemIds: readonly string[], updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE assistant_plan_item SET status = 'confirmed', updated_at = ?
       WHERE owner_id = ? AND plan_id = ? AND status = 'draft' AND id IN (${itemIds.map(() => "?").join(", ")})
       RETURNING id`,
      [updatedAt, ownerId, planId, ...itemIds],
    );
    return rows.length;
  }

  async settleItems(
    ownerId: string,
    planId: string,
    updates: readonly { id: string; status: "executed" | "blocked"; factCurrent: 0 | 1; blockReason: "fact_stale" | null }[],
    updatedAt: string,
  ) {
    if (updates.length === 0) return 0;
    const statusCase = updates.map(() => "WHEN ? THEN ?").join(" ");
    const factCase = updates.map(() => "WHEN ? THEN ?").join(" ");
    const reasonCase = updates.map(() => "WHEN ? THEN ?").join(" ");
    const values: QueryValue[] = [];
    for (const update of updates) values.push(update.id, update.status);
    for (const update of updates) values.push(update.id, update.factCurrent);
    for (const update of updates) values.push(update.id, update.blockReason);
    values.push(updatedAt, ownerId, planId, ...updates.map((update) => update.id));
    const rows = await queryWithParameters(
      this.db,
      `UPDATE assistant_plan_item
       SET status = CASE id ${statusCase} END,
           fact_current = CAST(CASE id ${factCase} END AS integer),
           block_reason = CASE id ${reasonCase} END,
           updated_at = ?
       WHERE owner_id = ? AND plan_id = ? AND status = 'confirmed'
         AND id IN (${updates.map(() => "?").join(", ")})
       RETURNING id`,
      values,
    );
    return rows.length;
  }

  async markSettled(ownerId: string, planId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE assistant_plan SET status = 'settled', updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'draft'
       RETURNING id`,
      [updatedAt, planId, ownerId],
    );
    return rows.length === 1;
  }
}
