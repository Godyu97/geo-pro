import "server-only";

import { z } from "zod";
import { isEmailVerificationMocked } from "../../lib/auth/verified-email.ts";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema } from "../quotas/contracts.ts";
import { attemptDispositions, attemptKinds, monitoringTrackSchema, runStatuses, slotStatuses } from "./contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const runRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  operationId: brandIdSchema,
  fingerprint: z.string().length(64),
  track: monitoringTrackSchema,
  promptSetId: brandIdSchema,
  promptSetVersion: z.int().positive(),
  repeatCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  questionCount: z.int().positive(),
  naturalCount: z.int().nonnegative(),
  channelCount: z.int().positive(),
  slotCount: z.int().positive(),
  region: z.string(),
  language: z.string(),
  requestedNetworkMode: z.enum(networkModes),
  currency: quotaCurrencySchema.nullable(),
  upperMinor: minorAmountSchema.nullable(),
  estimateHighMinor: minorAmountSchema.nullable(),
  customerPayableMinor: z.literal(0),
  status: z.enum(runStatuses),
  samplingComplete: flag,
  createdAt: z.iso.datetime({ precision: 3 }),
});
const slotRow = z.object({
  id: brandIdSchema,
  runId: brandIdSchema,
  brandId: brandIdSchema,
  questionId: brandIdSchema,
  natural: flag,
  channelId: brandIdSchema,
  channelVersion: z.int().positive(),
  repeatIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reservationId: brandIdSchema.nullable(),
  status: z.enum(slotStatuses),
  adoptedAttemptId: brandIdSchema.nullable(),
  late: flag,
  createdAt: z.iso.datetime({ precision: 3 }),
});
const attemptRow = z.object({
  id: brandIdSchema,
  slotId: brandIdSchema,
  runId: brandIdSchema,
  brandId: brandIdSchema,
  kind: z.enum(attemptKinds),
  ordinal: z.int().min(1).max(20),
  transport: z.enum(["isolated", "official_api"]),
  synthetic: flag,
  disposition: z.enum(attemptDispositions),
  rawText: z.string().nullable(),
  currency: quotaCurrencySchema.nullable(),
  upperMinor: minorAmountSchema.nullable(),
  actualMinor: minorAmountSchema.nullable(),
  costState: z.enum(["none", "pending", "known", "unknown"]),
  quotaAttemptId: brandIdSchema.nullable(),
  late: flag,
  receipt: z.string().min(2).max(8000).nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type MonitoringRunRow = z.infer<typeof runRow>;
export type MonitoringSlotRow = z.infer<typeof slotRow>;
export type MonitoringAttemptRow = z.infer<typeof attemptRow>;

const runColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", operation_id AS "operationId", fingerprint,
  track, prompt_set_id AS "promptSetId", prompt_set_version AS "promptSetVersion", repeat_count AS "repeatCount",
  question_count AS "questionCount", natural_count AS "naturalCount", channel_count AS "channelCount",
  slot_count AS "slotCount", region, language, requested_network_mode AS "requestedNetworkMode", currency,
  upper_minor AS "upperMinor", estimate_high_minor AS "estimateHighMinor",
  customer_payable_minor AS "customerPayableMinor", status, sampling_complete AS "samplingComplete",
  created_at AS "createdAt"`;
const slotColumns = `id, run_id AS "runId", brand_id AS "brandId", question_id AS "questionId", natural_question AS "natural",
  channel_id AS "channelId", channel_version AS "channelVersion", repeat_index AS "repeatIndex",
  reservation_id AS "reservationId", status, adopted_attempt_id AS "adoptedAttemptId", late, created_at AS "createdAt"`;
const attemptColumns = `id, slot_id AS "slotId", run_id AS "runId", brand_id AS "brandId", kind, ordinal, transport,
  synthetic, disposition, raw_text AS "rawText", currency, upper_minor AS "upperMinor", actual_minor AS "actualMinor",
  cost_state AS "costState", quota_attempt_id AS "quotaAttemptId", late, receipt, created_at AS "createdAt"`;

export class MonitoringDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async emailVerified(ownerId: string) {
    const [row] = await this.query('SELECT email_verified AS "emailVerified" FROM "user" WHERE id = ?', [ownerId]);
    if (!row) return false;
    return row.emailVerified === true || row.emailVerified === 1 || isEmailVerificationMocked();
  }

  async runByOperation(brandId: string, operationId: string) {
    const [row] = await this.query(`SELECT ${runColumns} FROM monitoring_run WHERE brand_id = ? AND operation_id = ?`,
      [brandId, operationId]);
    return row ? runRow.parse(row) : null;
  }

  async runForOwner(ownerId: string, runId: string) {
    const [row] = await this.query(`SELECT ${runColumns} FROM monitoring_run WHERE id = ? AND owner_id = ?`, [runId, ownerId]);
    return row ? runRow.parse(row) : null;
  }

  async recent(brandId: string, limit: number) {
    const rows = await this.query(`SELECT ${runColumns} FROM monitoring_run
      WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, [brandId, limit]);
    return z.array(runRow).parse(rows);
  }

  async slots(runIds: string[]) {
    if (!runIds.length) return [];
    const rows = await this.query(`SELECT ${slotColumns} FROM monitoring_slot
      WHERE run_id IN (${runIds.map(() => "?").join(", ")})
      ORDER BY run_id, question_id, channel_id, repeat_index`, runIds);
    return z.array(slotRow).parse(rows);
  }

  async insertRun(row: MonitoringRunRow) {
    await this.query(`INSERT INTO monitoring_run
      (id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version, repeat_count,
       question_count, natural_count, channel_count, slot_count, region, language, requested_network_mode, currency,
       upper_minor, estimate_high_minor, customer_payable_minor, status, sampling_complete, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'queued', 0, ?)`,
    [row.id, row.brandId, row.ownerId, row.operationId, row.fingerprint, row.track, row.promptSetId,
      row.promptSetVersion, row.repeatCount, row.questionCount, row.naturalCount, row.channelCount, row.slotCount,
      row.region, row.language, row.requestedNetworkMode, row.currency, row.upperMinor, row.estimateHighMinor, row.createdAt]);
  }

  async insertSlots(rows: MonitoringSlotRow[]) {
    if (!rows.length) return;
    await this.query(`INSERT INTO monitoring_slot
      (id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index, reservation_id, status, adopted_attempt_id, late, created_at)
      VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, 0, ?)").join(", ")}`,
    rows.flatMap((row) => [row.id, row.runId, row.brandId, row.questionId, row.natural, row.channelId,
      row.channelVersion, row.repeatIndex, row.reservationId, row.createdAt]));
  }

  async attempts(runIds: string[]) {
    if (!runIds.length) return [];
    const rows = await this.query(`SELECT ${attemptColumns} FROM monitoring_attempt
      WHERE run_id IN (${runIds.map(() => "?").join(", ")})
      ORDER BY run_id, slot_id, kind, ordinal`, runIds);
    return z.array(attemptRow).parse(rows);
  }

  async attemptForOwner(ownerId: string, attemptId: string) {
    const columns = attemptColumns.split(",").map((column) => `a.${column.trim()}`).join(", ");
    const [row] = await this.query(`SELECT ${columns} FROM monitoring_attempt a
      JOIN monitoring_run r ON r.id = a.run_id AND r.owner_id = ?
      WHERE a.id = ?`, [ownerId, attemptId]);
    return row ? attemptRow.parse(row) : null;
  }

  async insertAttempt(row: MonitoringAttemptRow) {
    await this.query(`INSERT INTO monitoring_attempt
      (id, slot_id, run_id, brand_id, kind, ordinal, transport, synthetic, disposition, raw_text, currency,
       upper_minor, actual_minor, cost_state, quota_attempt_id, late, receipt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.slotId, row.runId, row.brandId, row.kind, row.ordinal, row.transport, row.synthetic,
      row.disposition, row.rawText, row.currency, row.upperMinor, row.actualMinor, row.costState,
      row.quotaAttemptId, row.late, row.receipt, row.createdAt]);
  }

  async updateAttempt(row: Pick<MonitoringAttemptRow, "id" | "disposition" | "rawText" | "actualMinor" | "costState" | "late"> & { receipt?: string | null }) {
    await this.query(`UPDATE monitoring_attempt
      SET disposition = ?, raw_text = ?, actual_minor = ?, cost_state = ?, late = ?, receipt = COALESCE(?, receipt) WHERE id = ?`,
    [row.disposition, row.rawText, row.actualMinor, row.costState, row.late, row.receipt ?? null, row.id]);
  }

  async setRun(runId: string, status: MonitoringRunRow["status"], samplingComplete: 0 | 1) {
    await this.query("UPDATE monitoring_run SET status = ?, sampling_complete = ? WHERE id = ?", [status, samplingComplete, runId]);
  }

  async setSlot(slotId: string, status: MonitoringSlotRow["status"], adoptedAttemptId: string | null, late: 0 | 1) {
    await this.query("UPDATE monitoring_slot SET status = ?, adopted_attempt_id = ?, late = ? WHERE id = ?",
      [status, adoptedAttemptId, late, slotId]);
  }

  async pauseQueued(runId: string) {
    await this.query("UPDATE monitoring_slot SET status = 'paused' WHERE run_id = ? AND status = 'queued'", [runId]);
  }

  async cancelWaiting(runId: string) {
    await this.query("UPDATE monitoring_slot SET status = 'cancelled' WHERE run_id = ? AND status IN ('queued', 'paused')", [runId]);
  }

  async samplingUsage(brandId: string) {
    const [row] = await this.query(`SELECT COUNT(DISTINCT reservation_id) AS "startedReservations",
      COALESCE(SUM(CASE WHEN state = 'known' THEN actual_minor ELSE 0 END), 0) AS "knownActual",
      COALESCE(SUM(CASE WHEN state <> 'known' THEN upper_minor ELSE 0 END), 0) AS "pendingUpper"
      FROM quota_attempt WHERE brand_id = ? AND kind = 'sampling'`, [brandId]);
    return z.object({
      startedReservations: z.coerce.number().int().nonnegative(),
      knownActual: z.coerce.number().int().nonnegative(),
      pendingUpper: z.coerce.number().int().nonnegative(),
    }).parse(row);
  }

  async insertReservations(brandId: string, grantVersion: number, rows: Array<{ id: string; upperMinor: number }>, time: string) {
    if (!rows.length) return;
    await this.query(`INSERT INTO quota_reservation
      (brand_id, kind, id, grant_version, upper_minor, state, created_at)
      VALUES ${rows.map(() => "(?, 'sampling', ?, ?, ?, 'reserved', ?)").join(", ")}`,
    rows.flatMap((row) => [brandId, row.id, grantVersion, row.upperMinor, time]));
  }
}
