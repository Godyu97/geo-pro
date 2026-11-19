import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import {
  analysisStatuses, captureMethods, citationOrigins, citationSetStates, evidenceStates,
  ownershipStates, pageStatuses, sourceModes, triStateSchema,
} from "./contracts.ts";

const observationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  slotId: brandIdSchema.nullable(),
  attemptId: brandIdSchema.nullable(),
  sourceMode: z.enum(sourceModes),
  captureMethod: z.enum(captureMethods),
  questionText: z.string(),
  answerText: z.string(),
  fingerprint: z.string().length(64),
  capturedAt: z.iso.datetime({ precision: 3 }),
  region: z.string(),
  language: z.string(),
  requestedNetworkMode: z.enum(networkModes),
  entityVersion: z.int().positive(),
  citationSetState: z.enum(citationSetStates),
  evidenceState: z.enum(evidenceStates),
  locatorRef: z.string().nullable(),
  collectorId: z.string().nullable(),
  missingReason: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const citationRow = z.object({
  id: brandIdSchema,
  observationId: brandIdSchema,
  brandId: brandIdSchema,
  rawUrl: z.string(),
  normalizedUrl: z.string(),
  citationOrigin: z.enum(citationOrigins),
  positionLabel: z.string().nullable(),
  ownership: z.enum(ownershipStates),
  pageStatus: z.enum(pageStatuses),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const analysisRow = z.object({
  id: brandIdSchema,
  observationId: brandIdSchema,
  brandId: brandIdSchema,
  version: z.int().positive(),
  entityVersion: z.int().positive(),
  ruleVersion: z.string(),
  mentioned: triStateSchema,
  recommended: triStateSchema,
  officialSiteCited: triStateSchema,
  evidenceSpan: z.string().nullable(),
  status: z.enum(analysisStatuses),
  revisedFrom: brandIdSchema.nullable(),
  reason: z.string().nullable(),
  reviewerId: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type ObservationRow = z.infer<typeof observationRow>;
export type CitationRow = z.infer<typeof citationRow>;
export type AnalysisRow = z.infer<typeof analysisRow>;

const observationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", slot_id AS "slotId", attempt_id AS "attemptId",
  source_mode AS "sourceMode", capture_method AS "captureMethod", question_text AS "questionText", answer_text AS "answerText",
  fingerprint, captured_at AS "capturedAt", region, language, requested_network_mode AS "requestedNetworkMode",
  entity_version AS "entityVersion", citation_set_state AS "citationSetState", evidence_state AS "evidenceState",
  locator_ref AS "locatorRef", collector_id AS "collectorId", missing_reason AS "missingReason", created_at AS "createdAt"`;

const citationColumns = `id, observation_id AS "observationId", brand_id AS "brandId", raw_url AS "rawUrl",
  normalized_url AS "normalizedUrl", citation_origin AS "citationOrigin", position_label AS "positionLabel",
  ownership, page_status AS "pageStatus", created_at AS "createdAt"`;

const analysisColumns = `id, observation_id AS "observationId", brand_id AS "brandId", version,
  entity_version AS "entityVersion", rule_version AS "ruleVersion", mentioned, recommended,
  official_site_cited AS "officialSiteCited", evidence_span AS "evidenceSpan", status,
  revised_from AS "revisedFrom", reason, reviewer_id AS "reviewerId", created_at AS "createdAt"`;

export class EvidenceDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async lockBrand(brandId: string, ownerId: string) {
    const [row] = await this.query(
      `SELECT id, status, CASE WHEN frozen_at IS NULL THEN 0 ELSE 1 END AS frozen
       FROM brand WHERE id = ? AND owner_id = ?`,
      [brandId, ownerId],
    );
    if (!row) return null;
    return z.object({
      id: brandIdSchema,
      status: z.enum(["active", "archived"]),
      frozen: z.coerce.number().int().min(0).max(1),
    }).parse(row);
  }

  async operation(ownerId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT result FROM brand_operation WHERE owner_id = ? AND operation_id = ?`,
      [ownerId, operationId],
    );
    return row ? z.object({ result: z.string() }).parse(row).result : null;
  }

  async recordOperation(ownerId: string, operationId: string, fingerprint: string, result: unknown, time: string, scope: string) {
    await this.query(
      `INSERT INTO brand_operation (owner_id, operation_id, fingerprint, result, created_at, scope)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ownerId, operationId, fingerprint, JSON.stringify(result), time, scope],
    );
  }

  async adoptedAttempt(ownerId: string, brandId: string, slotId: string) {
    const [row] = await this.query(
      `SELECT a.id AS "attemptId", a.slot_id AS "slotId", a.raw_text AS "rawText", a.transport,
              s.question_id AS "questionId", r.id AS "runId", r.track, r.region, r.language,
              r.requested_network_mode AS "requestedNetworkMode", r.prompt_set_id AS "promptSetId",
              b.entity_version AS "entityVersion"
       FROM monitoring_attempt a
       JOIN monitoring_slot s ON s.id = a.slot_id AND s.adopted_attempt_id = a.id
       JOIN monitoring_run r ON r.id = a.run_id
       JOIN brand b ON b.id = a.brand_id
       WHERE a.brand_id = ? AND a.slot_id = ? AND a.disposition = 'adopted' AND r.owner_id = ?`,
      [brandId, slotId, ownerId],
    );
    if (!row) return null;
    return z.object({
      attemptId: brandIdSchema,
      slotId: brandIdSchema,
      rawText: z.string(),
      transport: z.enum(["isolated", "official_api"]),
      questionId: brandIdSchema,
      runId: brandIdSchema,
      track: z.enum(["model_api", "consumer_ui"]),
      region: z.string(),
      language: z.string(),
      requestedNetworkMode: z.enum(networkModes),
      promptSetId: brandIdSchema,
      entityVersion: z.coerce.number().int().positive(),
    }).parse(row);
  }

  async insertObservation(row: ObservationRow) {
    await this.query(
      `INSERT INTO answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
        evidence_state, locator_ref, collector_id, missing_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.slotId, row.attemptId, row.sourceMode, row.captureMethod,
        row.questionText, row.answerText, row.fingerprint, row.capturedAt, row.region, row.language,
        row.requestedNetworkMode, row.entityVersion, row.citationSetState, row.evidenceState,
        row.locatorRef, row.collectorId, row.missingReason, row.createdAt,
      ],
    );
  }

  async insertCitations(rows: CitationRow[]) {
    for (const row of rows) {
      await this.query(
        `INSERT INTO answer_citation (
          id, observation_id, brand_id, raw_url, normalized_url, citation_origin, position_label, ownership, page_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.observationId, row.brandId, row.rawUrl, row.normalizedUrl, row.citationOrigin,
          row.positionLabel, row.ownership, row.pageStatus, row.createdAt,
        ],
      );
    }
  }

  async insertAnalysis(row: AnalysisRow) {
    await this.query(
      `INSERT INTO answer_analysis_version (
        id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
        official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.observationId, row.brandId, row.version, row.entityVersion, row.ruleVersion,
        row.mentioned, row.recommended, row.officialSiteCited, row.evidenceSpan, row.status,
        row.revisedFrom, row.reason, row.reviewerId, row.createdAt,
      ],
    );
  }

  async markAnalysisRevised(id: string, brandId: string) {
    await this.query(
      `UPDATE answer_analysis_version SET status = 'revised' WHERE id = ? AND brand_id = ? AND status <> 'revised'`,
      [id, brandId],
    );
  }

  async observationForOwner(ownerId: string, observationId: string) {
    const [row] = await this.query(
      `SELECT ${observationColumns} FROM answer_observation WHERE id = ? AND owner_id = ?`,
      [observationId, ownerId],
    );
    return row ? observationRow.parse(row) : null;
  }

  async observationBySlot(ownerId: string, brandId: string, slotId: string) {
    const [row] = await this.query(
      `SELECT ${observationColumns} FROM answer_observation
       WHERE owner_id = ? AND brand_id = ? AND slot_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [ownerId, brandId, slotId],
    );
    return row ? observationRow.parse(row) : null;
  }

  async citationsFor(observationId: string) {
    const rows = await this.query(
      `SELECT ${citationColumns} FROM answer_citation WHERE observation_id = ? ORDER BY id`,
      [observationId],
    );
    return rows.map((row) => citationRow.parse(row));
  }

  async analysesFor(observationId: string) {
    const rows = await this.query(
      `SELECT ${analysisColumns} FROM answer_analysis_version WHERE observation_id = ? ORDER BY version`,
      [observationId],
    );
    return rows.map((row) => analysisRow.parse(row));
  }

  async latestAnalysis(observationId: string) {
    const [row] = await this.query(
      `SELECT ${analysisColumns} FROM answer_analysis_version
       WHERE observation_id = ? ORDER BY version DESC LIMIT 1`,
      [observationId],
    );
    return row ? analysisRow.parse(row) : null;
  }

  async clearBrandEvidence(brandId: string) {
    await this.query(`DELETE FROM answer_citation WHERE brand_id = ?`, [brandId]);
    await this.query(`DELETE FROM answer_analysis_version WHERE brand_id = ?`, [brandId]);
    await this.query(`DELETE FROM answer_observation WHERE brand_id = ?`, [brandId]);
  }
}
