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
  promptSetId: brandIdSchema.nullable(),
  promptSetVersion: z.int().positive().nullable(),
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

const runSlotSummaryRow = z.object({
  id: brandIdSchema,
  runId: brandIdSchema,
  status: z.string(),
});

const monitoringRunSummaryRow = z.object({
  id: brandIdSchema,
  status: z.string(),
  slotCount: z.int().positive(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const observationLinkRow = z.object({
  id: brandIdSchema,
  slotId: brandIdSchema.nullable(),
});

export type SamplingDueRunRecord = z.infer<typeof dueRow>;
export type SamplingWindowReadingRecord = z.infer<typeof readingRow>;
export type MonitoringRunSummaryRecord = z.infer<typeof monitoringRunSummaryRow>;
export type RunSlotSummaryRecord = z.infer<typeof runSlotSummaryRow>;

const dueColumns = `id, plan_id AS "planId", plan_version AS "planVersion", brand_id AS "brandId",
  owner_id AS "ownerId", channel_id AS "channelId", window_id AS "windowId", slot_id AS "slotId",
  timezone, kind, status, monitoring_run_id AS "monitoringRunId", charged_minor AS "chargedMinor",
  prompt_set_id AS "promptSetId", prompt_set_version AS "promptSetVersion",
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

export function samplingWindowReadingsForAlertsQuery(ownerId: string, brandId: string, alertIds: readonly string[]) {
  if (alertIds.length === 0) return null;
  return {
    sql: `SELECT ${readingColumns} FROM sampling_window_reading
      WHERE owner_id = ? AND brand_id = ? AND alert_id IN (${alertIds.map(() => "?").join(", ")})
      ORDER BY window_id DESC, updated_at DESC, plan_id ASC`,
    values: [ownerId, brandId, ...alertIds] as QueryValue[],
  };
}

export function samplingWindowReadingLookupQuery(ownerId: string, planId: string, windowId: string) {
  return {
    sql: `SELECT ${readingColumns} FROM sampling_window_reading
      WHERE owner_id = ? AND plan_id = ? AND window_id = ?
      LIMIT 1`,
    values: [ownerId, planId, windowId] as QueryValue[],
  };
}

export function samplingDueRunsForWindowQuery(ownerId: string, planId: string, windowId: string) {
  return {
    sql: `SELECT ${dueColumns} FROM sampling_due_run
      WHERE owner_id = ? AND plan_id = ? AND window_id = ?
      ORDER BY id ASC`,
    values: [ownerId, planId, windowId] as QueryValue[],
  };
}

export function samplingDueRunsForWindowsQuery(
  ownerId: string,
  planIds: readonly string[],
  windowIds: readonly string[],
) {
  if (planIds.length === 0 || windowIds.length === 0) return null;
  return {
    sql: `SELECT ${dueColumns} FROM sampling_due_run
      WHERE owner_id = ? AND plan_id IN (${planIds.map(() => "?").join(", ")}) AND window_id IN (${windowIds.map(() => "?").join(", ")})
      ORDER BY plan_id ASC, window_id ASC, id ASC`,
    values: [ownerId, ...planIds, ...windowIds] as QueryValue[],
  };
}

const attachableRunRow = z.object({
  id: brandIdSchema,
  status: z.literal("succeeded"),
  createdAt: z.iso.datetime({ precision: 3 }),
  currency: z.string().length(3),
  channelId: z.string().min(1).max(64),
  knownMinor: z.coerce.number().int().nonnegative(),
  slotCount: z.coerce.number().int().positive(),
});

const linkedDueRow = z.object({
  id: brandIdSchema,
  planId: brandIdSchema,
  slotId: brandIdSchema,
  status: dueStatusSchema,
});

export type AttachableOfficialRunRecord = z.infer<typeof attachableRunRow>;

/** Succeeded single-channel official runs whose sampling attempts all have a known charge. */
export function attachableOfficialRunsQuery(ownerId: string, brandId: string, runId?: string) {
  const values: QueryValue[] = [ownerId, brandId];
  const runFilter = runId ? " AND r.id = ?" : "";
  if (runId) values.push(runId);
  values.push(runId ? 1 : 20);
  return {
    sql: `SELECT r.id, r.status, r.created_at AS "createdAt", r.currency,
      MIN(s.channel_id) AS "channelId",
      SUM(CASE WHEN a.kind = 'sampling' AND a.disposition = 'adopted' AND a.cost_state = 'known' THEN a.actual_minor ELSE 0 END) AS "knownMinor",
      COUNT(DISTINCT s.id) AS "slotCount"
      FROM monitoring_run r
      INNER JOIN monitoring_slot s ON s.run_id = r.id AND s.brand_id = r.brand_id
      LEFT JOIN monitoring_attempt a ON a.run_id = r.id AND a.slot_id = s.id AND a.brand_id = r.brand_id
      WHERE r.owner_id = ? AND r.brand_id = ? AND r.track = 'model_api' AND r.status = 'succeeded' AND r.sampling_complete = 1${runFilter}
      GROUP BY r.id, r.status, r.created_at, r.currency
      HAVING COUNT(DISTINCT s.channel_id) = 1
        AND SUM(CASE WHEN a.kind = 'sampling' AND a.cost_state <> 'known' THEN 1 ELSE 0 END) = 0
        AND SUM(CASE WHEN a.kind = 'sampling' AND a.disposition = 'adopted' THEN 1 ELSE 0 END) = COUNT(DISTINCT s.id)
      ORDER BY r.created_at DESC, r.id ASC
      LIMIT ?`,
    values,
  };
}

export function samplingDueRunByMonitoringRunQuery(ownerId: string, brandId: string, monitoringRunId: string) {
  return {
    sql: `SELECT id, plan_id AS "planId", slot_id AS "slotId", status
      FROM sampling_due_run
      WHERE owner_id = ? AND brand_id = ? AND monitoring_run_id = ?
      LIMIT 2`,
    values: [ownerId, brandId, monitoringRunId] as QueryValue[],
  };
}

export class SamplingDueDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async attachableOfficialRuns(ownerId: string, brandId: string, runId?: string) {
    const query = attachableOfficialRunsQuery(ownerId, brandId, runId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(attachableRunRow).parse(rows);
  }

  async dueRunsForMonitoringRun(ownerId: string, brandId: string, monitoringRunId: string) {
    const query = samplingDueRunByMonitoringRunQuery(ownerId, brandId, monitoringRunId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(linkedDueRow).parse(rows);
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

  async runsForWindow(ownerId: string, planId: string, windowId: string) {
    const query = samplingDueRunsForWindowQuery(ownerId, planId, windowId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(dueRow).parse(rows);
  }

  async runsForWindows(ownerId: string, planIds: readonly string[], windowIds: readonly string[]) {
    const query = samplingDueRunsForWindowsQuery(ownerId, planIds, windowIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(dueRow).parse(rows);
  }

  async insertRun(row: SamplingDueRunRecord) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sampling_due_run (
        id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
        kind, status, monitoring_run_id, charged_minor, prompt_set_id, prompt_set_version, prompt_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.planId, row.planVersion, row.brandId, row.ownerId, row.channelId, row.windowId,
        row.slotId, row.timezone, row.kind, row.status, row.monitoringRunId, row.chargedMinor,
        row.promptSetId, row.promptSetVersion, row.promptIdsJson, row.createdAt,
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

  async readingsForAlerts(ownerId: string, brandId: string, alertIds: readonly string[]) {
    const query = samplingWindowReadingsForAlertsQuery(ownerId, brandId, alertIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(readingRow).parse(rows);
  }

  async readingForWindow(ownerId: string, planId: string, windowId: string) {
    const query = samplingWindowReadingLookupQuery(ownerId, planId, windowId);
    const [row] = await queryWithParameters(this.db, query.sql, query.values);
    return row ? readingRow.parse(row) : null;
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

  async monitoringRunsByIds(ownerId: string, brandId: string, runIds: readonly string[]) {
    if (runIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, status, slot_count AS "slotCount", created_at AS "createdAt" FROM monitoring_run
       WHERE owner_id = ? AND brand_id = ? AND id IN (${runIds.map(() => "?").join(", ")})
       ORDER BY id ASC`,
      [ownerId, brandId, ...runIds],
    );
    return z.array(monitoringRunSummaryRow).parse(rows);
  }

  async runSlotSummaries(brandId: string, runIds: readonly string[]) {
    if (runIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, run_id AS "runId", status FROM monitoring_slot
       WHERE brand_id = ? AND run_id IN (${runIds.map(() => "?").join(", ")})
       ORDER BY run_id ASC, id ASC`,
      [brandId, ...runIds],
    );
    return z.array(runSlotSummaryRow).parse(rows);
  }

  async observationLinksForSlots(ownerId: string, brandId: string, slotIds: readonly string[]) {
    if (slotIds.length === 0) return [];
    const results: z.infer<typeof observationLinkRow>[] = [];
    for (let index = 0; index < slotIds.length; index += 200) {
      const chunk = slotIds.slice(index, index + 200);
      const rows = await queryWithParameters(
        this.db,
        `SELECT id, slot_id AS "slotId" FROM answer_observation
         WHERE owner_id = ? AND brand_id = ? AND slot_id IN (${chunk.map(() => "?").join(", ")})
         ORDER BY id ASC`,
        [ownerId, brandId, ...chunk],
      );
      results.push(...z.array(observationLinkRow).parse(rows));
    }
    return results;
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
