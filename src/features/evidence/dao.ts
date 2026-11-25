import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import {
  analysisDraftStatuses, analysisStatuses, captureMethods, citationOrigins, citationSetStates, evidenceStates,
  nativeCitationOrigins,
  networkTriggers, ownershipStates, pageStatuses, sourceModes, triStateSchema,
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
  targetRegion: z.string().length(2),
  observedRegion: z.union([z.literal("unknown"), z.string().length(2)]),
  newSession: triStateSchema,
  productMode: triStateSchema,
  networkTrigger: z.enum(networkTriggers),
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

const analysisDraftRow = z.object({
  id: brandIdSchema,
  observationId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  mentioned: triStateSchema,
  recommended: triStateSchema,
  officialSiteCited: triStateSchema,
  status: z.enum(analysisDraftStatuses),
  modelName: z.string().min(1).max(128),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type ObservationRow = z.infer<typeof observationRow>;
export type CitationRow = z.infer<typeof citationRow>;
export type AnalysisRow = z.infer<typeof analysisRow>;
export type AnalysisDraftRow = z.infer<typeof analysisDraftRow>;

const observationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", slot_id AS "slotId", attempt_id AS "attemptId",
  source_mode AS "sourceMode", capture_method AS "captureMethod", question_text AS "questionText", answer_text AS "answerText",
  fingerprint, captured_at AS "capturedAt", region, language, requested_network_mode AS "requestedNetworkMode",
  entity_version AS "entityVersion", citation_set_state AS "citationSetState", evidence_state AS "evidenceState",
  locator_ref AS "locatorRef", collector_id AS "collectorId", missing_reason AS "missingReason", created_at AS "createdAt",
  target_region AS "targetRegion", observed_region AS "observedRegion", new_session AS "newSession",
  product_mode AS "productMode", network_trigger AS "networkTrigger"`;

const citationColumns = `id, observation_id AS "observationId", brand_id AS "brandId", raw_url AS "rawUrl",
  normalized_url AS "normalizedUrl", citation_origin AS "citationOrigin", position_label AS "positionLabel",
  ownership, page_status AS "pageStatus", created_at AS "createdAt"`;

const analysisDraftColumns = `id, observation_id AS "observationId", brand_id AS "brandId", owner_id AS "ownerId",
  mentioned, recommended, official_site_cited AS "officialSiteCited", status,
  model_name AS "modelName", created_at AS "createdAt"`;

const analysisColumns = `id, observation_id AS "observationId", brand_id AS "brandId", version,
  entity_version AS "entityVersion", rule_version AS "ruleVersion", mentioned, recommended,
  official_site_cited AS "officialSiteCited", evidence_span AS "evidenceSpan", status,
  revised_from AS "revisedFrom", reason, reviewer_id AS "reviewerId", created_at AS "createdAt"`;

const sqlCount = z.preprocess((value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}, z.number().int().nonnegative());

const sqlText = z.preprocess((value) => typeof value === "string" ? value : "", z.string());

const overviewContextSchema = z.object({
  name: z.string().nullable(),
  content: z.string().nullable(),
  entityVersion: z.coerce.number().int().positive(),
  revision: z.coerce.number().int().positive(),
  observations: sqlCount,
  observationAt: sqlText,
  analyses: sqlCount,
  analysisAt: sqlText,
  tasks: sqlCount,
  taskAt: sqlText,
  taskStamp: sqlCount,
  slots: sqlCount,
  slotAt: sqlText,
  slotStamp: sqlCount,
  citations: sqlCount,
  citationAt: sqlText,
  capabilityAt: sqlText,
  latestPromptSetId: sqlText,
});

const nullableMinor = z.preprocess(
  (value) => value == null ? null : value,
  z.int().nonnegative().nullable(),
);

const adoptedAttemptRow = z.object({
  attemptId: brandIdSchema,
  slotId: brandIdSchema,
  rawText: z.string(),
  transport: z.enum(["isolated", "official_api"]),
  receipt: z.string().nullable(),
  costState: z.enum(["none", "pending", "known", "unknown"]),
  actualMinor: nullableMinor,
  currency: z.string().length(3).nullable(),
  synthetic: z.coerce.number().int().min(0).max(1),
  questionId: brandIdSchema,
  runId: brandIdSchema,
  track: z.enum(["model_api", "consumer_ui"]),
  region: z.string(),
  language: z.string(),
  requestedNetworkMode: z.enum(networkModes),
  promptSetId: brandIdSchema,
  entityVersion: z.coerce.number().int().positive(),
});

const attemptCostRow = z.object({
  costState: z.enum(["none", "pending", "known", "unknown"]),
  actualMinor: nullableMinor,
  currency: z.string().length(3).nullable(),
});

const adoptedPromptSchema = z.object({
  slotId: brandIdSchema,
  questionId: brandIdSchema,
  promptSetId: brandIdSchema,
});

export const evidenceIdChunk = 100;

export type ScopedObservationInput = {
  ownerId: string;
  brandId: string;
  sourceMode: "model_api" | "consumer_ui";
  region?: string;
  requestedNetworkMode?: "on" | "off" | "unknown";
  from?: string;
  to?: string;
};

const scopedColumns = `o.id, o.brand_id AS "brandId", o.owner_id AS "ownerId", o.slot_id AS "slotId", o.attempt_id AS "attemptId",
  o.source_mode AS "sourceMode", o.capture_method AS "captureMethod", o.question_text AS "questionText", o.answer_text AS "answerText",
  o.fingerprint, o.captured_at AS "capturedAt", o.region, o.language, o.requested_network_mode AS "requestedNetworkMode",
  o.entity_version AS "entityVersion", o.citation_set_state AS "citationSetState", o.evidence_state AS "evidenceState",
  o.locator_ref AS "locatorRef", o.collector_id AS "collectorId", o.missing_reason AS "missingReason", o.created_at AS "createdAt",
  o.target_region AS "targetRegion", o.observed_region AS "observedRegion", o.new_session AS "newSession",
  o.product_mode AS "productMode", o.network_trigger AS "networkTrigger",
  s.run_id AS "runId", s.channel_id AS "channelId", s.channel_version AS "channelVersion"`;

function chunkIds(ids: string[]) {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += evidenceIdChunk) {
    chunks.push(unique.slice(index, index + evidenceIdChunk));
  }
  return chunks;
}

export function scopedObservationQuery(input: ScopedObservationInput) {
  const values: QueryValue[] = [input.ownerId, input.brandId, input.sourceMode];
  const filters = [
    `o.owner_id = ?`,
    `o.brand_id = ?`,
    `o.source_mode = ?`,
    `o.evidence_state IN ('complete', 'incomplete', 'contested', 'draft_evidence')`,
  ];
  if (input.region) {
    filters.push(`o.target_region = ?`);
    values.push(input.region);
  }
  if (input.requestedNetworkMode) {
    filters.push(`o.requested_network_mode = ?`);
    values.push(input.requestedNetworkMode);
  }
  if (input.from) {
    filters.push(`o.captured_at >= ?`);
    values.push(input.from);
  }
  if (input.to) {
    filters.push(`o.captured_at <= ?`);
    values.push(input.to);
  }
  return {
    sql: `SELECT ${scopedColumns}
         , s.question_id AS "questionId"
         , r.prompt_set_id AS "promptSetId"
         , s.natural_question AS "naturalQuestion"
         , a.mentioned AS "mentioned"
         , a.recommended AS "recommended"
         , a.official_site_cited AS "officialSiteCited"
         , a.version AS "analysisVersion"
       FROM answer_observation o
       LEFT JOIN monitoring_slot s ON s.id = o.slot_id
       LEFT JOIN monitoring_run r ON r.id = s.run_id
         AND s.brand_id = o.brand_id AND r.brand_id = o.brand_id AND r.owner_id = o.owner_id
       LEFT JOIN answer_analysis_version a ON a.observation_id = o.id
         AND a.version = (
           SELECT MAX(a2.version) FROM answer_analysis_version a2 WHERE a2.observation_id = o.id
         )
       WHERE ${filters.join(" AND ")}
       ORDER BY o.captured_at DESC, o.id DESC`,
    values,
  };
}

export function adoptedPromptQuery(brandId: string, ownerId: string, slotIds: string[]) {
  return {
    sql: `SELECT a.slot_id AS "slotId", s.question_id AS "questionId", r.prompt_set_id AS "promptSetId"
       FROM monitoring_attempt a
       JOIN monitoring_slot s ON s.id = a.slot_id AND s.adopted_attempt_id = a.id
       JOIN monitoring_run r ON r.id = a.run_id
       WHERE a.brand_id = ? AND a.disposition = 'adopted' AND r.owner_id = ?
         AND a.slot_id IN (${slotIds.map(() => "?").join(", ")})`,
    values: [brandId, ownerId, ...slotIds],
  };
}

const answerListContextRow = z.object({
  observationId: brandIdSchema,
  answerText: z.string(),
  questionId: brandIdSchema.nullable(),
  promptSetId: brandIdSchema.nullable(),
});

export function answerListContextQuery(ownerId: string, brandId: string, observationIds: readonly string[]) {
  return {
    sql: `SELECT o.id AS "observationId", o.answer_text AS "answerText",
            CASE WHEN s.brand_id = o.brand_id THEN s.question_id ELSE NULL END AS "questionId",
            CASE WHEN s.brand_id = o.brand_id AND r.brand_id = o.brand_id AND r.owner_id = o.owner_id
              THEN r.prompt_set_id ELSE NULL END AS "promptSetId"
          FROM answer_observation o
          LEFT JOIN monitoring_slot s ON s.id = o.slot_id
          LEFT JOIN monitoring_run r ON r.id = s.run_id
          WHERE o.owner_id = ? AND o.brand_id = ? AND o.id IN (${observationIds.map(() => "?").join(", ")})
          ORDER BY o.id ASC`,
    values: [ownerId, brandId, ...observationIds] as QueryValue[],
  };
}

export function overviewPlanLinkQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT d.slot_id AS "planSlotId", d.monitoring_run_id AS "runId",
            r.region AS "region", r.requested_network_mode AS "requestedNetworkMode",
            p.search_required AS "searchRequired", p.new_session_required AS "newSessionRequired"
          FROM sampling_due_run d
          LEFT JOIN monitoring_run r ON r.id = d.monitoring_run_id AND r.owner_id = d.owner_id
          LEFT JOIN run_protocol_pin pin ON pin.run_id = r.id
          LEFT JOIN sampling_protocol p ON p.protocol_id = pin.protocol_id AND p.version = pin.version
          WHERE d.owner_id = ? AND d.brand_id = ?
          ORDER BY d.slot_id ASC, d.id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function citationOwnershipQuery(brandId: string, observationIds: readonly string[]) {
  const origins = nativeCitationOrigins.map((origin) => `'${origin}'`).join(", ");
  return {
    sql: `SELECT observation_id AS "observationId", ownership
          FROM answer_citation
          WHERE brand_id = ? AND observation_id IN (${observationIds.map(() => "?").join(", ")})
            AND citation_origin IN (${origins})
          ORDER BY observation_id ASC, id ASC`,
    values: [brandId, ...observationIds] as QueryValue[],
  };
}

export function channelKindQuery(channelIds: readonly string[]) {
  return {
    sql: `SELECT id, kind FROM capability_channel
          WHERE id IN (${channelIds.map(() => "?").join(", ")})
          ORDER BY id ASC`,
    values: [...channelIds] as QueryValue[],
  };
}

export function capabilityExpiryQuery(channelIds: readonly string[]) {
  return {
    sql: `SELECT channel_id AS "channelId", version, expires_at AS "expiresAt"
          FROM capability_version
          WHERE channel_id IN (${channelIds.map(() => "?").join(", ")})
          ORDER BY channel_id ASC, version ASC`,
    values: [...channelIds] as QueryValue[],
  };
}

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
              a.receipt, a.cost_state AS "costState", a.actual_minor AS "actualMinor", a.currency,
              a.synthetic, s.question_id AS "questionId", r.id AS "runId", r.track, r.region, r.language,
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
    return adoptedAttemptRow.parse(row);
  }

  async attemptCost(ownerId: string, attemptId: string) {
    const [row] = await this.query(
      `SELECT a.cost_state AS "costState", a.actual_minor AS "actualMinor", a.currency
       FROM monitoring_attempt a
       JOIN monitoring_run r ON r.id = a.run_id AND r.owner_id = ?
       WHERE a.id = ?`,
      [ownerId, attemptId],
    );
    return row ? attemptCostRow.parse(row) : null;
  }

  async updateDraftObservation(row: ObservationRow) {
    const rows = await this.query(
      `UPDATE answer_observation SET
        question_text = ?, answer_text = ?, fingerprint = ?, region = ?, language = ?,
        requested_network_mode = ?, entity_version = ?, citation_set_state = ?, evidence_state = ?,
        locator_ref = ?, collector_id = ?, missing_reason = ?,
        target_region = ?, observed_region = ?, new_session = ?, product_mode = ?
       WHERE id = ? AND owner_id = ? AND brand_id = ? AND evidence_state = 'draft_evidence'
       RETURNING id`,
      [
        row.questionText, row.answerText, row.fingerprint, row.region, row.language,
        row.requestedNetworkMode, row.entityVersion, row.citationSetState, row.evidenceState,
        row.locatorRef, row.collectorId, row.missingReason,
        row.targetRegion, row.observedRegion, row.newSession, row.productMode,
        row.id, row.ownerId, row.brandId,
      ],
    );
    return rows.length === 1;
  }

  async replaceCitations(observationId: string, brandId: string, rows: CitationRow[]) {
    await this.query(
      `DELETE FROM answer_citation WHERE observation_id = ? AND brand_id = ?`,
      [observationId, brandId],
    );
    await this.insertCitations(rows);
  }

  async insertObservation(row: ObservationRow) {
    await this.query(
      `INSERT INTO answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
        evidence_state, locator_ref, collector_id, missing_reason, created_at,
        target_region, observed_region, new_session, product_mode, network_trigger
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.slotId, row.attemptId, row.sourceMode, row.captureMethod,
        row.questionText, row.answerText, row.fingerprint, row.capturedAt, row.region, row.language,
        row.requestedNetworkMode, row.entityVersion, row.citationSetState, row.evidenceState,
        row.locatorRef, row.collectorId, row.missingReason, row.createdAt,
        row.targetRegion, row.observedRegion, row.newSession, row.productMode, row.networkTrigger,
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

  async observationIdentity(observationId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM answer_observation WHERE id = ?`,
      [observationId],
    );
    return row ? z.object({ brandId: brandIdSchema, ownerId: z.string().min(1) }).parse(row) : null;
  }

  async observationForOwner(ownerId: string, observationId: string) {
    const [row] = await this.query(
      `SELECT ${observationColumns} FROM answer_observation WHERE id = ? AND owner_id = ?`,
      [observationId, ownerId],
    );
    return row ? observationRow.parse(row) : null;
  }

  async lockObservation(ownerId: string, observationId: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await this.query(
      `SELECT ${observationColumns} FROM answer_observation WHERE id = ? AND owner_id = ?${lock}`,
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

  async insertAnalysisDraft(row: AnalysisDraftRow) {
    await this.query(
      `INSERT INTO answer_analysis_draft (
        id, observation_id, brand_id, owner_id, mentioned, recommended, official_site_cited,
        status, model_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.observationId, row.brandId, row.ownerId, row.mentioned, row.recommended,
        row.officialSiteCited, row.status, row.modelName, row.createdAt,
      ],
    );
  }

  async openAnalysisDrafts(ownerId: string, observationId: string) {
    const rows = await this.query(
      `SELECT ${analysisDraftColumns} FROM answer_analysis_draft
       WHERE observation_id = ? AND owner_id = ? AND status = 'draft'
       ORDER BY created_at DESC, id DESC LIMIT 20`,
      [observationId, ownerId],
    );
    return rows.map((row) => analysisDraftRow.parse(row));
  }

  async analysisDraftForOwner(ownerId: string, observationId: string, draftId: string) {
    const [row] = await this.query(
      `SELECT ${analysisDraftColumns} FROM answer_analysis_draft
       WHERE id = ? AND observation_id = ? AND owner_id = ?`,
      [draftId, observationId, ownerId],
    );
    return row ? analysisDraftRow.parse(row) : null;
  }

  async markAnalysisDraft(id: string, ownerId: string, observationId: string, status: "applied" | "dismissed") {
    const rows = await this.query(
      `UPDATE answer_analysis_draft SET status = ?
       WHERE id = ? AND owner_id = ? AND observation_id = ? AND status = 'draft'
       RETURNING id`,
      [status, id, ownerId, observationId],
    );
    return rows.length === 1;
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

  async overviewReadContext(ownerId: string, brandId: string) {
    const [row] = await this.query(
      `SELECT v.name AS "name", v.content AS "content",
              b.entity_version AS "entityVersion", b.revision AS "revision",
              (SELECT COUNT(*) FROM answer_observation o WHERE o.brand_id = b.id AND o.owner_id = b.owner_id) AS "observations",
              (SELECT COALESCE(MAX(o.created_at), '') FROM answer_observation o WHERE o.brand_id = b.id AND o.owner_id = b.owner_id) AS "observationAt",
              (SELECT COUNT(*) FROM answer_analysis_version a WHERE a.brand_id = b.id) AS "analyses",
              (SELECT COALESCE(MAX(a.created_at), '') FROM answer_analysis_version a WHERE a.brand_id = b.id) AS "analysisAt",
              (SELECT COUNT(*) FROM optimization_task t WHERE t.brand_id = b.id AND t.owner_id = b.owner_id) AS "tasks",
              (SELECT COALESCE(MAX(t.updated_at), '') FROM optimization_task t WHERE t.brand_id = b.id AND t.owner_id = b.owner_id) AS "taskAt",
              (SELECT COALESCE(SUM(length(t.status) * 1000 + COALESCE(t.manual_rank, 0)), 0)
                 FROM optimization_task t WHERE t.brand_id = b.id AND t.owner_id = b.owner_id) AS "taskStamp",
              (SELECT COUNT(*) FROM sampling_slot s WHERE s.brand_id = b.id AND s.owner_id = b.owner_id) AS "slots",
              (SELECT COALESCE(MAX(s.at), '') FROM sampling_slot s WHERE s.brand_id = b.id AND s.owner_id = b.owner_id) AS "slotAt",
              (SELECT COALESCE(SUM(CASE s.status
                 WHEN 'scheduled' THEN 1 WHEN 'completed' THEN 2 WHEN 'failed' THEN 4 WHEN 'paused' THEN 8 ELSE 16 END), 0)
                 FROM sampling_slot s WHERE s.brand_id = b.id AND s.owner_id = b.owner_id) AS "slotStamp",
              (SELECT COUNT(*) FROM answer_citation c WHERE c.brand_id = b.id) AS "citations",
              (SELECT COALESCE(MAX(c.created_at), '') FROM answer_citation c WHERE c.brand_id = b.id) AS "citationAt",
              (SELECT COALESCE(MAX(v.changed_at), '') FROM capability_version v) AS "capabilityAt",
              (SELECT p.id FROM prompt_set p WHERE p.brand_id = b.id
                 ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS "latestPromptSetId"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`,
      [ownerId, brandId],
    );
    if (!row) return null;
    const parsed = overviewContextSchema.parse(row);
    let hasOfficialWebsite = false;
    if (parsed.content) {
      try {
        const raw = z.looseObject({ website: z.string().optional() }).safeParse(JSON.parse(parsed.content));
        hasOfficialWebsite = Boolean(raw.success && raw.data.website?.trim());
      } catch {
        hasOfficialWebsite = false;
      }
    }
    const token = [
      parsed.entityVersion,
      parsed.revision,
      parsed.observations,
      parsed.observationAt,
      parsed.analyses,
      parsed.analysisAt,
      parsed.tasks,
      parsed.taskAt,
      parsed.taskStamp,
      parsed.slots,
      parsed.slotAt,
      parsed.slotStamp,
      parsed.citations,
      parsed.citationAt,
      parsed.capabilityAt,
      parsed.latestPromptSetId,
    ].join("|");
    return {
      name: parsed.name ?? brandId,
      hasOfficialWebsite,
      entityVersion: parsed.entityVersion,
      revision: parsed.revision,
      token,
    };
  }

  async overviewPlanLinks(ownerId: string, brandId: string) {
    const built = overviewPlanLinkQuery(ownerId, brandId);
    const rows = await this.query(built.sql, built.values);
    return z.array(z.object({
      planSlotId: brandIdSchema,
      runId: brandIdSchema.nullable(),
      region: z.string().nullable(),
      requestedNetworkMode: z.enum(networkModes).nullable(),
      searchRequired: z.union([z.coerce.number(), z.null()]).transform((value) => value === 1),
      newSessionRequired: z.union([z.coerce.number(), z.null()]).transform((value) => value === 1),
    })).parse(rows);
  }

  async citationOwnership(brandId: string, observationIds: readonly string[]) {
    const owned = new Map<string, string[]>();
    for (const ids of chunkIds([...observationIds])) {
      const built = citationOwnershipQuery(brandId, ids);
      const rows = await this.query(built.sql, built.values);
      for (const row of z.array(z.object({
        observationId: brandIdSchema,
        ownership: z.enum(ownershipStates),
      })).parse(rows)) {
        const list = owned.get(row.observationId) ?? [];
        list.push(row.ownership);
        owned.set(row.observationId, list);
      }
    }
    return owned;
  }

  async channelKinds(channelIds: readonly string[]) {
    if (channelIds.length === 0) return new Map<string, string>();
    const built = channelKindQuery(channelIds);
    const rows = await this.query(built.sql, built.values);
    const kinds = new Map<string, string>();
    for (const row of z.array(z.object({
      id: z.string().min(1).max(64),
      kind: z.enum(["consumer_ui", "model_api", "custom_pipeline"]),
    })).parse(rows)) {
      kinds.set(row.id, row.kind);
    }
    return kinds;
  }

  async capabilityExpiries(channelIds: readonly string[]) {
    const expiry = new Map<string, string | null>();
    if (channelIds.length === 0) return expiry;
    const built = capabilityExpiryQuery(channelIds);
    const rows = await this.query(built.sql, built.values);
    for (const row of z.array(z.object({
      channelId: z.string().min(1).max(64),
      version: z.coerce.number().int().positive(),
      expiresAt: z.string().nullable(),
    })).parse(rows)) {
      expiry.set(row.channelId, row.expiresAt);
    }
    return expiry;
  }

  async adoptedPromptRefs(ownerId: string, brandId: string, slotIds: string[]) {
    const refs = new Map<string, { promptSetId: string; questionId: string }>();
    for (const ids of chunkIds(slotIds)) {
      const built = adoptedPromptQuery(brandId, ownerId, ids);
      const rows = await this.query(built.sql, built.values);
      for (const row of z.array(adoptedPromptSchema).parse(rows)) {
        refs.set(row.slotId, { promptSetId: row.promptSetId, questionId: row.questionId });
      }
    }
    return refs;
  }

  async listScopedObservations(input: ScopedObservationInput) {
    const built = scopedObservationQuery(input);
    const rows = await this.query(built.sql, built.values);

    return rows.map((row) => ({
      observation: observationRow.parse(row),
      questionId: row.questionId == null ? null : brandIdSchema.parse(row.questionId),
      promptSetId: row.promptSetId == null ? null : brandIdSchema.parse(row.promptSetId),
      naturalQuestion: row.naturalQuestion == null ? null : z.coerce.number().int().min(0).max(1).parse(row.naturalQuestion),
      mentioned: row.mentioned == null ? null : triStateSchema.parse(row.mentioned),
      recommended: row.recommended == null ? null : triStateSchema.parse(row.recommended),
      officialSiteCited: row.officialSiteCited == null ? null : triStateSchema.parse(row.officialSiteCited),
      analysisVersion: row.analysisVersion == null ? null : z.coerce.number().int().positive().parse(row.analysisVersion),
      runId: row.runId == null ? null : brandIdSchema.parse(row.runId),
      channelId: typeof row.channelId === "string" && row.channelId.length > 0 ? row.channelId : null,
      channelVersion: row.channelVersion == null ? null : z.coerce.number().int().positive().parse(row.channelVersion),
    }));
  }

  async listAnswerContexts(ownerId: string, brandId: string, observationIds: readonly string[]) {
    const found = new Map<string, z.infer<typeof answerListContextRow>>();
    for (const ids of chunkIds([...observationIds])) {
      const built = answerListContextQuery(ownerId, brandId, ids);
      const rows = await this.query(built.sql, built.values);
      for (const row of z.array(answerListContextRow).parse(rows)) found.set(row.observationId, row);
    }
    return found;
  }
}
