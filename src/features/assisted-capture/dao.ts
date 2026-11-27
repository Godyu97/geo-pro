import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { citationSetStates, evidenceStates, observedRegionSchema, triStateSchema } from "../evidence/contracts.ts";
import { captureCitationMax, captureCitationUrlSchema, captureMinuteMax, promptIdsSchema } from "./contracts.ts";

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
  promptId: brandIdSchema.nullable(),
  questionText: z.string().nullable(),
  answerText: z.string().nullable(),
  citationsJson: z.string().nullable(),
  citationSetState: z.enum(citationSetStates).nullable(),
  locatorRef: z.string().nullable(),
  collectorId: z.string().nullable(),
  requestedNetworkMode: z.enum(networkModes).nullable(),
  targetRegion: z.string().length(2).nullable(),
  observedRegion: observedRegionSchema.nullable(),
  newSession: triStateSchema.nullable(),
  productMode: triStateSchema.nullable(),
  observationId: brandIdSchema.nullable(),
});

const scopeRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
});

const observationStateRow = z.object({
  id: brandIdSchema,
  evidenceState: z.enum(evidenceStates),
  citationSetState: z.enum(citationSetStates),
});

export type CaptureSheetRecord = z.infer<typeof sheetRow> & { promptIds: string[] };
export type CaptureAttemptRecord = z.infer<typeof attemptRow> & { citations: string[] };
export type CaptureObservationSummary = z.infer<typeof observationStateRow>;

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
  promptId?: string | null;
  questionText?: string | null;
  answerText?: string | null;
  citationsJson?: string | null;
  citationSetState?: CaptureAttemptRecord["citationSetState"];
  locatorRef?: string | null;
  collectorId?: string | null;
  requestedNetworkMode?: CaptureAttemptRecord["requestedNetworkMode"];
  targetRegion?: string | null;
  observedRegion?: CaptureAttemptRecord["observedRegion"];
  newSession?: CaptureAttemptRecord["newSession"];
  productMode?: CaptureAttemptRecord["productMode"];
  observationId?: string | null;
};

export type CaptureConfirmPatch = {
  citationCount?: number;
  status?: "partial" | "preview";
  promptId?: string | null;
  questionText?: string | null;
  answerText?: string | null;
  citationsJson?: string | null;
  citationSetState?: CaptureAttemptRecord["citationSetState"];
  locatorRef?: string | null;
  collectorId?: string | null;
  requestedNetworkMode?: CaptureAttemptRecord["requestedNetworkMode"];
  targetRegion?: string | null;
  observedRegion?: CaptureAttemptRecord["observedRegion"];
  newSession?: CaptureAttemptRecord["newSession"];
  productMode?: CaptureAttemptRecord["productMode"];
  observationId?: string | null;
};

const sheetColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", prompt_ids_json AS "promptIdsJson",
  mode, assisted_minutes AS "assistedMinutes", manual_minutes AS "manualMinutes",
  citations_complete AS "citationsComplete", created_at AS "createdAt", updated_at AS "updatedAt"`;

const attemptColumns = `id, sheet_id AS "sheetId", brand_id AS "brandId", owner_id AS "ownerId",
  blocked_by AS "blockedBy", citation_count AS "citationCount", status, confirmed,
  created_at AS "createdAt", updated_at AS "updatedAt",
  prompt_id AS "promptId", question_text AS "questionText", answer_text AS "answerText",
  citations_json AS "citationsJson", citation_set_state AS "citationSetState",
  locator_ref AS "locatorRef", collector_id AS "collectorId",
  requested_network_mode AS "requestedNetworkMode", target_region AS "targetRegion",
  observed_region AS "observedRegion", new_session AS "newSession",
  product_mode AS "productMode", observation_id AS "observationId"`;

function parseSheet(row: unknown): CaptureSheetRecord {
  const parsed = sheetRow.parse(row);
  return { ...parsed, promptIds: promptIdsSchema.parse(JSON.parse(parsed.promptIdsJson)) };
}

function parseAttempt(row: unknown): CaptureAttemptRecord {
  const parsed = attemptRow.parse(row);
  const citations = parsed.citationsJson
    ? z.array(captureCitationUrlSchema).parse(JSON.parse(parsed.citationsJson))
    : [];
  return { ...parsed, citations };
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

  async sheetScope(sheetId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId" FROM capture_sheet WHERE id = ? LIMIT 1`,
      [sheetId],
    );
    return row ? scopeRow.parse(row) : null;
  }

  async attemptScope(attemptId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId" FROM capture_attempt WHERE id = ? LIMIT 1`,
      [attemptId],
    );
    return row ? scopeRow.parse(row) : null;
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
        id, sheet_id, brand_id, owner_id, blocked_by, citation_count, status, confirmed, created_at, updated_at,
        prompt_id, question_text, answer_text, citations_json, citation_set_state,
        locator_ref, collector_id, requested_network_mode, target_region, observed_region,
        new_session, product_mode, observation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.sheetId, row.brandId, row.ownerId, row.blockedBy, row.citationCount, row.status, row.confirmed,
        row.createdAt, row.updatedAt,
        row.promptId ?? null, row.questionText ?? null, row.answerText ?? null, row.citationsJson ?? null,
        row.citationSetState ?? null, row.locatorRef ?? null, row.collectorId ?? null,
        row.requestedNetworkMode ?? null, row.targetRegion ?? null, row.observedRegion ?? null,
        row.newSession ?? null, row.productMode ?? null, row.observationId ?? null,
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
    return row ? parseAttempt(row) : null;
  }

  async attemptsForSheet(ownerId: string, sheetId: string) {
    const query = captureAttemptListQuery(ownerId, sheetId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return rows.map((row) => parseAttempt(row));
  }

  async attemptsForSheets(ownerId: string, sheetIds: readonly string[]) {
    const query = captureAttemptsQuery(ownerId, sheetIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return rows.map((row) => parseAttempt(row));
  }

  async observationSummaries(ownerId: string, brandId: string, ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, CaptureObservationSummary>();
    const unique = [...new Set(ids)];
    const rows = await queryWithParameters(
      this.db,
      `SELECT id, evidence_state AS "evidenceState", citation_set_state AS "citationSetState"
       FROM answer_observation
       WHERE owner_id = ? AND brand_id = ? AND id IN (${unique.map(() => "?").join(", ")})`,
      [ownerId, brandId, ...unique],
    );
    const parsed = z.array(observationStateRow).parse(rows);
    return new Map(parsed.map((item) => [item.id, item]));
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

  async markConfirmed(ownerId: string, attemptId: string, updatedAt: string, patch?: CaptureConfirmPatch) {
    if (!patch) {
      const rows = await queryWithParameters(
        this.db,
        `UPDATE capture_attempt SET confirmed = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND confirmed = 0 AND status IN ('partial', 'preview')
         RETURNING id`,
        [1, updatedAt, attemptId, ownerId],
      );
      return rows.length === 1;
    }

    const sets = ["confirmed = ?", "updated_at = ?"];
    const values: QueryValue[] = [1, updatedAt];
    const mappings: Array<[keyof CaptureConfirmPatch, string]> = [
      ["citationCount", "citation_count"],
      ["status", "status"],
      ["promptId", "prompt_id"],
      ["questionText", "question_text"],
      ["answerText", "answer_text"],
      ["citationsJson", "citations_json"],
      ["citationSetState", "citation_set_state"],
      ["locatorRef", "locator_ref"],
      ["collectorId", "collector_id"],
      ["requestedNetworkMode", "requested_network_mode"],
      ["targetRegion", "target_region"],
      ["observedRegion", "observed_region"],
      ["newSession", "new_session"],
      ["productMode", "product_mode"],
      ["observationId", "observation_id"],
    ];
    for (const [key, column] of mappings) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key] ?? null);
      }
    }
    const rows = await queryWithParameters(
      this.db,
      `UPDATE capture_attempt SET ${sets.join(", ")}
       WHERE id = ? AND owner_id = ? AND confirmed = 0 AND status IN ('partial', 'preview')
       RETURNING id`,
      [...values, attemptId, ownerId],
    );
    return rows.length === 1;
  }
}
