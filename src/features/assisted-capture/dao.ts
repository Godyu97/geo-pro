import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { captureCitationMax, captureMinuteMax, promptIdsSchema } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ precision: 3 });
const bit = z.union([z.literal(0), z.literal(1)]);
const minutes = z.number().int().min(0).max(captureMinuteMax).nullable();

const sheetRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  promptIdsJson: z.string().min(40).max(8000),
  mode: z.enum(["assisted", "manual"]),
  assistedMinutes: minutes,
  manualMinutes: minutes,
  citationsComplete: bit,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const attemptRow = z.object({
  id: brandIdSchema,
  sheetId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  blockedBy: z.enum(["captcha", "login"]).nullable(),
  citationCount: z.number().int().min(0).max(captureCitationMax),
  status: z.enum(["handoff", "partial", "preview"]),
  confirmed: bit,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CaptureSheetRecord = z.infer<typeof sheetRow> & { promptIds: string[] };
export type CaptureAttemptRecord = z.infer<typeof attemptRow>;

export type CaptureSheetInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  promptIdsJson: string;
  mode: "assisted" | "manual";
  assistedMinutes: number | null;
  manualMinutes: number | null;
  citationsComplete: 0 | 1;
  createdAt: string;
  updatedAt: string;
};

export type CaptureAttemptInsert = {
  id: string;
  sheetId: string;
  brandId: string;
  ownerId: string;
  blockedBy: "captcha" | "login" | null;
  citationCount: number;
  status: CaptureAttemptRecord["status"];
  confirmed: 0;
  createdAt: string;
  updatedAt: string;
};

const sheetColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", prompt_ids_json AS "promptIdsJson",
  mode, assisted_minutes AS "assistedMinutes", manual_minutes AS "manualMinutes",
  citations_complete AS "citationsComplete", created_at AS "createdAt", updated_at AS "updatedAt"`;

const attemptColumns = `id, sheet_id AS "sheetId", brand_id AS "brandId", owner_id AS "ownerId",
  blocked_by AS "blockedBy", citation_count AS "citationCount", status, confirmed,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

function parseSheet(row: unknown): CaptureSheetRecord {
  const parsed = sheetRow.parse(row);
  return { ...parsed, promptIds: promptIdsSchema.parse(JSON.parse(parsed.promptIdsJson)) };
}

export function captureSheetListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${sheetColumns} FROM capture_sheet
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at DESC, id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function captureAttemptListQuery(ownerId: string, sheetId: string) {
  return {
    sql: `SELECT ${attemptColumns} FROM capture_attempt
      WHERE owner_id = ? AND sheet_id = ?
      ORDER BY created_at ASC, id ASC`,
    values: [ownerId, sheetId] as QueryValue[],
  };
}

export function captureAttemptsQuery(ownerId: string, sheetIds: readonly string[]) {
  if (sheetIds.length === 0) return null;
  return {
    sql: `SELECT ${attemptColumns} FROM capture_attempt
      WHERE owner_id = ? AND sheet_id IN (${sheetIds.map(() => "?").join(", ")})
      ORDER BY sheet_id ASC, created_at ASC, id ASC`,
    values: [ownerId, ...sheetIds] as QueryValue[],
  };
}

export class CaptureDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertSheet(row: CaptureSheetInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO capture_sheet (
        id, brand_id, owner_id, prompt_ids_json, mode, assisted_minutes, manual_minutes,
        citations_complete, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.promptIdsJson, row.mode, row.assistedMinutes, row.manualMinutes,
        row.citationsComplete, row.createdAt, row.updatedAt,
      ],
    );
  }

  async insertAttempt(row: CaptureAttemptInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO capture_attempt (
        id, sheet_id, brand_id, owner_id, blocked_by, citation_count, status, confirmed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.sheetId, row.brandId, row.ownerId, row.blockedBy, row.citationCount, row.status, row.confirmed,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async sheetForOwner(ownerId: string, sheetId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${sheetColumns} FROM capture_sheet WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [sheetId, ownerId],
    );
    return row ? parseSheet(row) : null;
  }

  async sheetsForBrand(ownerId: string, brandId: string) {
    const query = captureSheetListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return rows.map((row) => parseSheet(row));
  }

  async attemptForOwner(ownerId: string, attemptId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${attemptColumns} FROM capture_attempt WHERE id = ? AND owner_id = ? LIMIT 1${clause}`,
      [attemptId, ownerId],
    );
    return row ? attemptRow.parse(row) : null;
  }

  async attemptsForSheet(ownerId: string, sheetId: string) {
    const query = captureAttemptListQuery(ownerId, sheetId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(attemptRow).parse(rows);
  }

  async attemptsForSheets(ownerId: string, sheetIds: readonly string[]) {
    const query = captureAttemptsQuery(ownerId, sheetIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(attemptRow).parse(rows);
  }

  async writeMode(ownerId: string, sheetId: string, mode: "manual", updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE capture_sheet SET mode = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND mode = 'assisted'
       RETURNING id`,
      [mode, updatedAt, sheetId, ownerId],
    );
    return rows.length === 1;
  }

  async markConfirmed(ownerId: string, attemptId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE capture_attempt SET confirmed = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND confirmed = 0 AND status IN ('partial', 'preview')
       RETURNING id`,
      [1, updatedAt, attemptId, ownerId],
    );
    return rows.length === 1;
  }
}
