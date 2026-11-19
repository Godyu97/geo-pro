import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema } from "../quotas/contracts.ts";
import { monitoringTrackSchema } from "./contracts.ts";

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
  status: z.literal("queued"),
  samplingComplete: z.literal(0),
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
  status: z.literal("queued"),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type MonitoringRunRow = z.infer<typeof runRow>;
export type MonitoringSlotRow = z.infer<typeof slotRow>;

const runColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", operation_id AS "operationId", fingerprint,
  track, prompt_set_id AS "promptSetId", prompt_set_version AS "promptSetVersion", repeat_count AS "repeatCount",
  question_count AS "questionCount", natural_count AS "naturalCount", channel_count AS "channelCount",
  slot_count AS "slotCount", region, language, requested_network_mode AS "requestedNetworkMode", currency,
  upper_minor AS "upperMinor", estimate_high_minor AS "estimateHighMinor",
  customer_payable_minor AS "customerPayableMinor", status, sampling_complete AS "samplingComplete",
  created_at AS "createdAt"`;
const slotColumns = `id, run_id AS "runId", brand_id AS "brandId", question_id AS "questionId", natural_question AS "natural",
  channel_id AS "channelId", channel_version AS "channelVersion", repeat_index AS "repeatIndex",
  reservation_id AS "reservationId", status, created_at AS "createdAt"`;

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
    return row.emailVerified === true || row.emailVerified === 1;
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
      (id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index, reservation_id, status, created_at)
      VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)").join(", ")}`,
    rows.flatMap((row) => [row.id, row.runId, row.brandId, row.questionId, row.natural, row.channelId,
      row.channelVersion, row.repeatIndex, row.reservationId, row.createdAt]));
  }

  async insertReservations(brandId: string, grantVersion: number, rows: Array<{ id: string; upperMinor: number }>, time: string) {
    if (!rows.length) return;
    await this.query(`INSERT INTO quota_reservation
      (brand_id, kind, id, grant_version, upper_minor, state, created_at)
      VALUES ${rows.map(() => "(?, 'sampling', ?, ?, ?, 'reserved', ?)").join(", ")}`,
    rows.flatMap((row) => [brandId, row.id, grantVersion, row.upperMinor, time]));
  }
}
