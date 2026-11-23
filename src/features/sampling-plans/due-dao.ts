import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";

const dueStatusSchema = z.enum(["reserved", "accepted", "sheet"]);

const dueRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  planVersion: z.int().positive(),
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  channelId: z.string().min(1).max(64),
  windowId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotId: brandIdSchema,
  timezone: z.string().min(1).max(64),
  kind: z.enum(["official", "manual"]),
  status: dueStatusSchema,
  monitoringRunId: brandIdSchema.nullable(),
  chargedMinor: z.int().min(0),
  promptIdsJson: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const readingRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  windowId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).max(64),
  plannedCount: z.int().min(0),
  eligibleCount: z.int().min(0),
  recommendedCount: z.int().min(0),
  judgedCount: z.int().min(0),
  coverageSufficient: z.union([z.literal(0), z.literal(1)]),
  comparableWindows: z.int().min(0),
  waitingForTrend: z.union([z.literal(0), z.literal(1)]),
  alertId: brandIdSchema.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const observationRow = z.object({
  id: brandIdSchema,
  slotId: brandIdSchema.nullable(),
  capturedAt: z.iso.datetime({ precision: 3 }),
  evidenceState: z.string(),
  citationSetState: z.string(),
  requestedNetworkMode: z.string(),
  networkTrigger: z.string(),
});

const analysisRow = z.object({
  observationId: brandIdSchema,
  version: z.int().positive(),
  recommended: z.enum(["true", "false", "unknown"]),
});

const runSlotRow = z.object({
  id: brandIdSchema,
  runId: brandIdSchema,
});

export type SamplingDueRunRecord = z.infer<typeof dueRow>;
export type SamplingWindowReadingRecord = z.infer<typeof readingRow>;

const dueColumns = `id, plan_id AS "planId", plan_version AS "planVersion", brand_id AS "brandId",
  owner_id AS "ownerId", channel_id AS "channelId", window_id AS "windowId", slot_id AS "slotId",
  timezone, kind, status, monitoring_run_id AS "monitoringRunId", charged_minor AS "chargedMinor",
  prompt_ids_json AS "promptIdsJson", created_at AS "createdAt"`;

const readingColumns = `id, plan_id AS "planId", brand_id AS "brandId", owner_id AS "ownerId", window_id AS "windowId", timezone,
  planned_count AS "plannedCount", eligible_count AS "eligibleCount", recommended_count AS "recommendedCount",
  judged_count AS "judgedCount", coverage_sufficient AS "coverageSufficient",
  comparable_windows AS "comparableWindows", waiting_for_trend AS "waitingForTrend",
  alert_id AS "alertId", created_at AS "createdAt", updated_at AS "updatedAt"`;

export function samplingDueRunLookupQuery(ownerId: string, planId: string) {
  return {
    sql: `SELECT ${dueColumns} FROM sampling_due_run
      WHERE owner_id = ? AND plan_id = ?
      ORDER BY window_id ASC, id ASC`,
    values: [ownerId, planId] as QueryValue[],
  };
}

export class SamplingDueDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async runsForPlan(ownerId: string, planId: string) {
    const query = samplingDueRunLookupQuery(ownerId, planId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(dueRow).parse(rows);
  }

  async runsForPlans(ownerId: string, planIds: readonly string[]) {
    if (planIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${dueColumns} FROM sampling_due_run
       WHERE owner_id = ? AND plan_id IN (${planIds.map(() => "?").join(", ")})
       ORDER BY plan_id ASC, window_id ASC, id ASC`,
      [ownerId, ...planIds],
    );
    return z.array(dueRow).parse(rows);
  }

  async insertRun(row: SamplingDueRunRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_due_run (
        id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
        kind, status, monitoring_run_id, charged_minor, prompt_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.planId, row.planVersion, row.brandId, row.ownerId, row.channelId, row.windowId,
        row.slotId, row.timezone, row.kind, row.status, row.monitoringRunId, row.chargedMinor,
        row.promptIdsJson, row.createdAt,
      ],
    );
  }

  async acceptRun(ownerId: string, id: string, monitoringRunId: string, chargedMinor: number) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sampling_due_run
       SET status = 'accepted', monitoring_run_id = ?, charged_minor = ?
       WHERE id = ? AND owner_id = ? AND status = 'reserved' AND kind = 'official'
       RETURNING id`,
      [monitoringRunId, chargedMinor, id, ownerId],
    );
    return rows.length === 1;
  }

  async readingsForPlans(ownerId: string, planIds: readonly string[]) {
    if (planIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${readingColumns} FROM sampling_window_reading
       WHERE owner_id = ? AND plan_id IN (${planIds.map(() => "?").join(", ")})
       ORDER BY plan_id ASC, window_id ASC`,
      [ownerId, ...planIds],
    );
    return z.array(readingRow).parse(rows);
  }

  async upsertReading(row: SamplingWindowReadingRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_window_reading (
        id, plan_id, brand_id, owner_id, window_id, timezone, planned_count, eligible_count,
        recommended_count, judged_count, coverage_sufficient, comparable_windows, waiting_for_trend,
        alert_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (plan_id, window_id) DO UPDATE SET
        planned_count = excluded.planned_count,
        eligible_count = excluded.eligible_count,
        recommended_count = excluded.recommended_count,
        judged_count = excluded.judged_count,
        coverage_sufficient = excluded.coverage_sufficient,
        comparable_windows = excluded.comparable_windows,
        waiting_for_trend = excluded.waiting_for_trend,
        alert_id = COALESCE(sampling_window_reading.alert_id, excluded.alert_id),
        updated_at = excluded.updated_at`,
      [
        row.id, row.planId, row.brandId, row.ownerId, row.windowId, row.timezone, row.plannedCount,
        row.eligibleCount, row.recommendedCount, row.judgedCount, row.coverageSufficient,
        row.comparableWindows, row.waitingForTrend, row.alertId, row.createdAt, row.updatedAt,
      ],
    );
  }

  async setReadingAlert(ownerId: string, planId: string, windowId: string, alertId: string, updatedAt: string) {
    await queryWithParameters(
      this.db,
      `UPDATE sampling_window_reading SET alert_id = ?, updated_at = ?
       WHERE owner_id = ? AND plan_id = ? AND window_id = ? AND alert_id IS NULL`,
      [alertId, updatedAt, ownerId, planId, windowId],
    );
  }

  async runSlots(brandId: string, runIds: readonly string[]) {
    if (runIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, run_id AS "runId" FROM monitoring_slot
       WHERE brand_id = ? AND run_id IN (${runIds.map(() => "?").join(", ")})
       ORDER BY run_id ASC, id ASC`,
      [brandId, ...runIds],
    );
    return z.array(runSlotRow).parse(rows);
  }

  async observationsForSlots(ownerId: string, brandId: string, slotIds: readonly string[]) {
    if (slotIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, slot_id AS "slotId", captured_at AS "capturedAt", evidence_state AS "evidenceState",
        citation_set_state AS "citationSetState", requested_network_mode AS "requestedNetworkMode",
        network_trigger AS "networkTrigger"
       FROM answer_observation
       WHERE owner_id = ? AND brand_id = ? AND slot_id IN (${slotIds.map(() => "?").join(", ")})
       ORDER BY captured_at ASC, id ASC
       LIMIT 200`,
      [ownerId, brandId, ...slotIds],
    );
    return z.array(observationRow).parse(rows);
  }

  async observationsBetween(ownerId: string, brandId: string, start: string, end: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, slot_id AS "slotId", captured_at AS "capturedAt", evidence_state AS "evidenceState",
        citation_set_state AS "citationSetState", requested_network_mode AS "requestedNetworkMode",
        network_trigger AS "networkTrigger"
       FROM answer_observation
       WHERE owner_id = ? AND brand_id = ? AND captured_at >= ? AND captured_at < ?
       ORDER BY captured_at ASC, id ASC
       LIMIT 200`,
      [ownerId, brandId, start, end],
    );
    return z.array(observationRow).parse(rows);
  }

  async analysesFor(brandId: string, observationIds: readonly string[]) {
    if (observationIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT observation_id AS "observationId", version, recommended
       FROM answer_analysis_version
       WHERE brand_id = ? AND observation_id IN (${observationIds.map(() => "?").join(", ")})
       ORDER BY observation_id ASC, version ASC`,
      [brandId, ...observationIds],
    );
    return z.array(analysisRow).parse(rows);
  }
}
