import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { costGroupRow, samplingCostGroupsQuery, type CostWindows } from "./cost.ts";
import {
  reportGradeSchema,
  reportIntentSchema,
  retestKindSchema,
  retestStatusSchema,
  snapshotStatusSchema,
} from "./contracts.ts";

const retestRow = z.object({
  id: z.string(),
  brandId: z.string(),
  ownerId: z.string(),
  kind: retestKindSchema,
  status: retestStatusSchema,
  intent: reportIntentSchema,
  track: z.enum(["model_api", "consumer_ui"]),
  timezone: z.string(),
  entityVersion: z.number().int(),
  beforeRunId: z.string().nullable(),
  afterRunId: z.string().nullable(),
  publicationId: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  operationId: z.string(),
  comparisonJson: z.string().nullable(),
  blockReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReportRetestRow = z.infer<typeof retestRow>;

const todoRow = z.object({
  id: z.string(),
  brandId: z.string(),
  ownerId: z.string(),
  retestId: z.string(),
  kind: z.literal("d7_reminder"),
  status: z.enum(["scheduled", "due", "done", "cancelled"]),
  dueAt: z.string(),
  progressJson: z.string(),
  autoCharge: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReportTodoRow = z.infer<typeof todoRow>;

const snapshotRow = z.object({
  id: z.string(),
  brandId: z.string(),
  ownerId: z.string(),
  retestId: z.string(),
  status: snapshotStatusSchema,
  grade: reportGradeSchema,
  intent: reportIntentSchema,
  loopCompleted: z.number().int(),
  predecessorId: z.string().nullable(),
  entityVersion: z.number().int(),
  timezone: z.string(),
  locale: z.string(),
  sourceMissing: z.number().int(),
  jsonBytes: z.string(),
  htmlBytes: z.string(),
  jsonSha256: z.string(),
  htmlSha256: z.string(),
  operationId: z.string(),
  createdAt: z.string(),
  htmlObjectId: z.string().min(1).nullable(),
  jsonObjectId: z.string().min(1).nullable(),
});
export type ReportSnapshotRow = z.infer<typeof snapshotRow>;

const retestColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", kind, status, intent, track,
  timezone, entity_version AS "entityVersion", before_run_id AS "beforeRunId", after_run_id AS "afterRunId",
  publication_id AS "publicationId", effective_at AS "effectiveAt", operation_id AS "operationId",
  comparison_json AS "comparisonJson", block_reason AS "blockReason", created_at AS "createdAt", updated_at AS "updatedAt"`;

const todoColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", retest_id AS "retestId", kind, status,
  due_at AS "dueAt", progress_json AS "progressJson", auto_charge AS "autoCharge",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const observationLookupChunk = 100;
const observationPresenceRow = z.object({ id: z.string() });

const snapshotColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", retest_id AS "retestId", status, grade, intent,
  loop_completed AS "loopCompleted", predecessor_id AS "predecessorId", entity_version AS "entityVersion",
  timezone, locale, source_missing AS "sourceMissing", json_bytes AS "jsonBytes", html_bytes AS "htmlBytes",
  json_sha256 AS "jsonSha256", html_sha256 AS "htmlSha256", operation_id AS "operationId", created_at AS "createdAt",
  html_object_id AS "htmlObjectId", json_object_id AS "jsonObjectId"`;

export class ReportDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, params: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, params);
  }

  async findRetestByOperation(brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${retestColumns} FROM report_retest WHERE brand_id = ? AND operation_id = ?`,
      [brandId, operationId],
    );
    return row ? retestRow.parse(row) : null;
  }

  async findRetest(ownerId: string, retestId: string) {
    const [row] = await this.query(
      `SELECT ${retestColumns} FROM report_retest WHERE id = ? AND owner_id = ?`,
      [retestId, ownerId],
    );
    return row ? retestRow.parse(row) : null;
  }

  async insertRetest(row: ReportRetestRow) {
    await this.query(
      `INSERT INTO report_retest (
        id, brand_id, owner_id, kind, status, intent, track, timezone, entity_version,
        before_run_id, after_run_id, publication_id, effective_at, operation_id,
        comparison_json, block_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.kind, row.status, row.intent, row.track, row.timezone,
        row.entityVersion, row.beforeRunId, row.afterRunId, row.publicationId, row.effectiveAt,
        row.operationId, row.comparisonJson, row.blockReason, row.createdAt, row.updatedAt,
      ],
    );
  }

  async updateRetest(row: Pick<ReportRetestRow, "id" | "ownerId" | "status" | "intent" | "comparisonJson" | "blockReason" | "updatedAt" | "effectiveAt" | "publicationId">) {
    await this.query(
      `UPDATE report_retest SET status = ?, intent = ?, comparison_json = ?, block_reason = ?,
        effective_at = ?, publication_id = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
      [
        row.status, row.intent, row.comparisonJson, row.blockReason, row.effectiveAt, row.publicationId,
        row.updatedAt, row.id, row.ownerId,
      ],
    );
  }

  async insertTodo(row: ReportTodoRow) {
    await this.query(
      `INSERT INTO report_todo (
        id, brand_id, owner_id, retest_id, kind, status, due_at, progress_json, auto_charge, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.retestId, row.kind, row.status, row.dueAt, row.progressJson,
        row.autoCharge, row.createdAt, row.updatedAt,
      ],
    );
  }

  async listTodos(ownerId: string, brandId: string, limit = 20) {
    const rows = await this.query(
      `SELECT ${todoColumns} FROM report_todo WHERE owner_id = ? AND brand_id = ?
       ORDER BY due_at ASC, id ASC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return z.array(todoRow).parse(rows);
  }

  async findSnapshotByOperation(brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${snapshotColumns} FROM report_snapshot WHERE brand_id = ? AND operation_id = ?`,
      [brandId, operationId],
    );
    return row ? snapshotRow.parse(row) : null;
  }

  async snapshotIdentity(snapshotId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM report_snapshot WHERE id = ?`,
      [snapshotId],
    );
    return row ? z.object({ brandId: z.string().min(1), ownerId: z.string().min(1) }).parse(row) : null;
  }

  async findSnapshot(ownerId: string, snapshotId: string) {
    const [row] = await this.query(
      `SELECT ${snapshotColumns} FROM report_snapshot WHERE id = ? AND owner_id = ?`,
      [snapshotId, ownerId],
    );
    return row ? snapshotRow.parse(row) : null;
  }

  async insertSnapshot(row: ReportSnapshotRow) {
    await this.query(
      `INSERT INTO report_snapshot (
        id, brand_id, owner_id, retest_id, status, grade, intent, loop_completed, predecessor_id,
        entity_version, timezone, locale, source_missing, json_bytes, html_bytes, json_sha256, html_sha256,
        operation_id, created_at, html_object_id, json_object_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.retestId, row.status, row.grade, row.intent, row.loopCompleted,
        row.predecessorId, row.entityVersion, row.timezone, row.locale, row.sourceMissing, row.jsonBytes,
        row.htmlBytes, row.jsonSha256, row.htmlSha256, row.operationId, row.createdAt,
        row.htmlObjectId, row.jsonObjectId,
      ],
    );
  }

  async supersedeSnapshot(ownerId: string, snapshotId: string) {
    await this.query(
      `UPDATE report_snapshot SET status = 'superseded' WHERE id = ? AND owner_id = ? AND status = 'created'`,
      [snapshotId, ownerId],
    );
  }

  async listSnapshots(ownerId: string, brandId: string, limit = 20) {
    const rows = await this.query(
      `SELECT ${snapshotColumns} FROM report_snapshot WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return z.array(snapshotRow).parse(rows);
  }

  async samplingCostGroups(brandId: string, windows: CostWindows) {
    const query = samplingCostGroupsQuery(brandId, windows);
    const rows = await this.query(query.sql, query.values);
    return z.array(costGroupRow).parse(rows);
  }

  async findCreatedSnapshotForRetest(ownerId: string, retestId: string) {
    const [row] = await this.query(
      `SELECT ${snapshotColumns} FROM report_snapshot
       WHERE owner_id = ? AND retest_id = ? AND status = 'created'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [ownerId, retestId],
    );
    return row ? snapshotRow.parse(row) : null;
  }

  async listRetests(ownerId: string, brandId: string, limit = 20) {
    const rows = await this.query(
      `SELECT ${retestColumns} FROM report_retest WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return z.array(retestRow).parse(rows);
  }

  /** Existence only, inside the caller's brand. Other brands' rows stay invisible. */
  async existingObservationIds(ownerId: string, brandId: string, ids: readonly string[]) {
    const present = new Set<string>();
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }
    for (let offset = 0; offset < unique.length; offset += observationLookupChunk) {
      const group = unique.slice(offset, offset + observationLookupChunk);
      const rows = await this.query(
        `SELECT id FROM answer_observation WHERE owner_id = ? AND brand_id = ? AND id IN (${group.map(() => "?").join(", ")})`,
        [ownerId, brandId, ...group],
      );
      for (const row of z.array(observationPresenceRow).parse(rows)) present.add(row.id);
    }
    return present;
  }
}
