import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { citationOrigins } from "../evidence/contracts.ts";

const setRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  version: z.number().int().positive(),
  labelsJson: z.string(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const mentionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  setId: brandIdSchema,
  observationId: brandIdSchema,
  competitorLabel: z.string().min(1),
  mentionState: z.enum(["true", "false", "unknown"]),
  ordered: z.union([z.literal(0), z.literal(1)]),
  position: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const mentionDetailRow = mentionRow.extend({
  questionId: z.string().min(1).nullable(),
  questionText: z.string(),
});

export type CompetitorSetRow = z.infer<typeof setRow>;
export type CompetitorMentionRow = z.infer<typeof mentionRow>;
export type CompetitorMentionDetailRow = z.infer<typeof mentionDetailRow>;

const flag = z.union([z.literal(0), z.literal(1)]);
const inspectionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  citationId: brandIdSchema,
  state: z.enum(["observed", "resolved", "limited", "unknown"]),
  support: z.enum(["supports", "does_not_support", "unknown"]),
  pageLive: flag,
  readable: flag,
  authorKnown: flag,
  supportsBrand: flag,
  supportedClaim: z.string().nullable(),
  factVersionId: brandIdSchema.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});
const citationViewRow = z.object({
  citationId: brandIdSchema,
  observationId: brandIdSchema,
  rawUrl: z.string(),
  normalizedUrl: z.string(),
  citationOrigin: z.enum(citationOrigins),
  ownership: z.string(),
  pageStatus: z.string(),
  state: z.enum(["observed", "resolved", "limited", "unknown"]).nullable(),
  support: z.enum(["supports", "does_not_support", "unknown"]).nullable(),
  pageLive: flag.nullable(),
  readable: flag.nullable(),
  authorKnown: flag.nullable(),
  supportsBrand: flag.nullable(),
  supportedClaim: z.string().nullable(),
  factVersionId: brandIdSchema.nullable(),
});

export type SourceInspectionRow = z.infer<typeof inspectionRow>;
export type CitationSourceRow = z.infer<typeof citationViewRow>;

const setColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", version, labels_json AS "labelsJson", created_at AS "createdAt"`;
const inspectionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", citation_id AS "citationId",
  state, support, page_live AS "pageLive", readable, author_known AS "authorKnown",
  supports_brand AS "supportsBrand", supported_claim AS "supportedClaim", fact_version_id AS "factVersionId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const briefColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", question_cluster AS "questionCluster",
  gap, facts_json AS "factsJson", source_ids_json AS "sourceIdsJson", status,
  content_brief_id AS "contentBriefId", optimization_task_id AS "optimizationTaskId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const briefRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  questionCluster: z.string(),
  gap: z.string(),
  factsJson: z.string(),
  sourceIdsJson: z.string(),
  status: z.enum(["proposed", "accepted", "dismissed"]),
  contentBriefId: brandIdSchema.nullable(),
  optimizationTaskId: brandIdSchema.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});
export type ResearchBriefRow = z.infer<typeof briefRow>;
const mentionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", set_id AS "setId",
  observation_id AS "observationId", competitor_label AS "competitorLabel", mention_state AS "mentionState", "ordered", position, created_at AS "createdAt"`;

export class CompetitorDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async ownedBrand(ownerId: string, brandId: string) {
    const [row] = await queryWithParameters(
      this.db,
      "SELECT id FROM brand WHERE id = ? AND owner_id = ? AND frozen_at IS NULL",
      [brandId, ownerId],
    );
    return Boolean(row);
  }

  async observationOwned(ownerId: string, brandId: string, observationId: string) {
    const [row] = await queryWithParameters(
      this.db,
      "SELECT id FROM answer_observation WHERE id = ? AND brand_id = ? AND owner_id = ?",
      [observationId, brandId, ownerId],
    );
    return Boolean(row);
  }

  async listSets(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${setColumns} FROM competitor_set WHERE owner_id = ? AND brand_id = ? ORDER BY version ASC, id ASC`,
      [ownerId, brandId],
    );
    return rows.map((row) => setRow.parse(row));
  }

  async insertSet(row: CompetitorSetRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO competitor_set (id, brand_id, owner_id, version, labels_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.version, row.labelsJson, row.createdAt],
    );
  }

  async findMention(setId: string, observationId: string, label: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${mentionColumns} FROM competitor_mention
       WHERE set_id = ? AND observation_id = ? AND competitor_label = ?`,
      [setId, observationId, label],
    );
    return row ? mentionRow.parse(row) : null;
  }

  async listObservationMentions(setId: string, observationId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${mentionColumns} FROM competitor_mention
       WHERE set_id = ? AND observation_id = ?`,
      [setId, observationId],
    );
    return rows.map((row) => mentionRow.parse(row));
  }

  async insertMention(row: CompetitorMentionRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO competitor_mention (
        id, brand_id, owner_id, set_id, observation_id, competitor_label, mention_state, "ordered", position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.setId, row.observationId, row.competitorLabel,
        row.mentionState, row.ordered, row.position, row.createdAt,
      ],
    );
  }

  async listMentions(ownerId: string, brandId: string, setId: string) {
    const countRows = await queryWithParameters(
      this.db,
      `SELECT COUNT(*) AS "count" FROM competitor_mention
       WHERE owner_id = ? AND brand_id = ? AND set_id = ?`,
      [ownerId, brandId, setId],
    );
    const count = z.object({ count: z.coerce.number().int().nonnegative() }).parse(countRows[0]).count;
    if (count > 5000) return { truncated: true as const, rows: [] as CompetitorMentionDetailRow[] };
    const rows = await queryWithParameters(
      this.db,
      `SELECT m.id, m.brand_id AS "brandId", m.owner_id AS "ownerId", m.set_id AS "setId",
              m.observation_id AS "observationId", m.competitor_label AS "competitorLabel",
              m.mention_state AS "mentionState", m."ordered", m.position, m.created_at AS "createdAt",
              CASE WHEN s.brand_id = o.brand_id THEN s.question_id ELSE NULL END AS "questionId",
              o.question_text AS "questionText"
       FROM competitor_mention m
       JOIN answer_observation o ON o.id = m.observation_id AND o.brand_id = m.brand_id AND o.owner_id = m.owner_id
       LEFT JOIN monitoring_slot s ON s.id = o.slot_id
       WHERE m.owner_id = ? AND m.brand_id = ? AND m.set_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [ownerId, brandId, setId],
    );
    return { truncated: false as const, rows: rows.map((row) => mentionDetailRow.parse(row)) };
  }

  async citationOwned(ownerId: string, brandId: string, citationId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT c.id FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       WHERE c.id = ? AND c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?`,
      [citationId, brandId, brandId, ownerId],
    );
    return Boolean(row);
  }

  async findInspection(citationId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${inspectionColumns} FROM source_inspection WHERE citation_id = ?`,
      [citationId],
    );
    return row ? inspectionRow.parse(row) : null;
  }

  async insertInspection(row: SourceInspectionRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO source_inspection (
        id, brand_id, owner_id, citation_id, state, support, page_live, readable,
        author_known, supports_brand, supported_claim, fact_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.citationId, row.state, row.support, row.pageLive,
        row.readable, row.authorKnown, row.supportsBrand, row.supportedClaim, row.factVersionId,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async updateInspection(row: SourceInspectionRow) {
    await queryWithParameters(
      this.db,
      `UPDATE source_inspection SET
        state = ?, support = ?, page_live = ?, readable = ?, author_known = ?, supports_brand = ?,
        supported_claim = ?, fact_version_id = ?, updated_at = ?
       WHERE id = ? AND brand_id = ? AND owner_id = ? AND citation_id = ?`,
      [
        row.state, row.support, row.pageLive, row.readable, row.authorKnown, row.supportsBrand,
        row.supportedClaim, row.factVersionId, row.updatedAt,
        row.id, row.brandId, row.ownerId, row.citationId,
      ],
    );
  }

  async approvedFact(ownerId: string, brandId: string, factVersionId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT f.id, f.content
       FROM brand_fact_version f
       JOIN brand b ON b.id = f.brand_id
       WHERE f.brand_id = ? AND f.id = ? AND b.owner_id = ? AND b.frozen_at IS NULL
         AND f.state = 'approved' AND f.revoked_at IS NULL`,
      [brandId, factVersionId, ownerId],
    );
    return row ? z.object({ id: brandIdSchema, content: z.string() }).parse(row) : null;
  }

  async listApprovedFacts(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT f.id, f.content
       FROM brand_fact_version f
       JOIN brand b ON b.id = f.brand_id
       WHERE f.brand_id = ? AND b.owner_id = ? AND b.frozen_at IS NULL
         AND f.state = 'approved' AND f.revoked_at IS NULL
         AND f.version = (
           SELECT MAX(v.version) FROM brand_fact_version v
           WHERE v.brand_id = f.brand_id AND v.fact_id = f.fact_id
         )
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 20`,
      [brandId, ownerId],
    );
    return rows.map((row) => z.object({ id: brandIdSchema, content: z.string() }).parse(row));
  }

  async listCitationSources(ownerId: string, brandId: string) {
    const countRows = await queryWithParameters(
      this.db,
      `SELECT COUNT(*) AS "count"
       FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       WHERE c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?`,
      [brandId, brandId, ownerId],
    );
    const count = z.object({ count: z.coerce.number().int().nonnegative() }).parse(countRows[0]).count;
    if (count > 200) return { truncated: true as const, rows: [] as CitationSourceRow[] };
    const rows = await queryWithParameters(
      this.db,
      `SELECT c.id AS "citationId", c.observation_id AS "observationId", c.raw_url AS "rawUrl",
              c.normalized_url AS "normalizedUrl", c.citation_origin AS "citationOrigin", c.ownership, c.page_status AS "pageStatus",
              i.state, i.support, i.page_live AS "pageLive", i.readable,
              i.author_known AS "authorKnown", i.supports_brand AS "supportsBrand",
              i.supported_claim AS "supportedClaim", i.fact_version_id AS "factVersionId"
       FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       LEFT JOIN source_inspection i ON i.citation_id = c.id AND i.brand_id = c.brand_id
       WHERE c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [brandId, brandId, ownerId],
    );
    return { truncated: false as const, rows: rows.map((row) => citationViewRow.parse(row)) };
  }

  async listRecentObservations(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT o.id, o.question_text AS "questionText",
              CASE WHEN s.brand_id = o.brand_id THEN s.question_id ELSE NULL END AS "questionId"
       FROM answer_observation o
       LEFT JOIN monitoring_slot s ON s.id = o.slot_id
       WHERE o.owner_id = ? AND o.brand_id = ?
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 20`,
      [ownerId, brandId],
    );
    return rows.map((row) => z.object({
      id: brandIdSchema,
      questionText: z.string(),
      questionId: z.string().min(1).nullable(),
    }).parse(row));
  }

  async citationIdsOwned(ownerId: string, brandId: string, citationIds: readonly string[]) {
    if (citationIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT c.id FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       WHERE c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?
         AND c.id IN (${citationIds.map(() => "?").join(", ")})`,
      [brandId, brandId, ownerId, ...citationIds],
    );
    return rows.map((row) => z.object({ id: brandIdSchema }).parse(row).id);
  }

  async insertBrief(row: {
    id: string;
    brandId: string;
    ownerId: string;
    questionCluster: string;
    gap: string;
    factsJson: string;
    sourceIdsJson: string;
    status: "proposed" | "accepted" | "dismissed";
    createdAt: string;
    updatedAt: string;
  }) {
    await queryWithParameters(
      this.db,
      `INSERT INTO research_brief (
        id, brand_id, owner_id, question_cluster, gap, facts_json, source_ids_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.questionCluster, row.gap, row.factsJson,
        row.sourceIdsJson, row.status, row.createdAt, row.updatedAt,
      ],
    );
  }

  async listBriefs(ownerId: string, brandId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${briefColumns}
       FROM research_brief
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [ownerId, brandId],
    );
    return rows.map((row) => briefRow.parse(row));
  }

  async lockBrief(ownerId: string, brandId: string, briefId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${briefColumns} FROM research_brief
       WHERE id = ? AND brand_id = ? AND owner_id = ?${lock}`,
      [briefId, brandId, ownerId],
    );
    return row ? briefRow.parse(row) : null;
  }

  async attachHandoff(
    ownerId: string,
    brandId: string,
    briefId: string,
    column: "content_brief_id" | "optimization_task_id",
    targetId: string,
    updatedAt: string,
  ) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE research_brief SET ${column} = ?, updated_at = ?
       WHERE id = ? AND brand_id = ? AND owner_id = ? AND status = 'accepted' AND ${column} IS NULL
       RETURNING id`,
      [targetId, updatedAt, briefId, brandId, ownerId],
    );
    return rows.length === 1;
  }

  async citationUrls(ownerId: string, brandId: string, citationIds: readonly string[]) {
    if (citationIds.length === 0) return [];
    const rows = await queryWithParameters(
      this.db,
      `SELECT c.id, c.normalized_url AS "normalizedUrl"
       FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       WHERE c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?
         AND c.id IN (${citationIds.map(() => "?").join(", ")})`,
      [brandId, brandId, ownerId, ...citationIds],
    );
    const byId = new Map(rows.map((row) => {
      const parsed = z.object({ id: brandIdSchema, normalizedUrl: z.string() }).parse(row);
      return [parsed.id, parsed.normalizedUrl] as const;
    }));
    return citationIds.flatMap((id) => {
      const url = byId.get(id);
      return url ? [url] : [];
    });
  }

  async updateBriefStatus(ownerId: string, brandId: string, briefId: string, status: "accepted" | "dismissed", updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE research_brief SET status = ?, updated_at = ?
       WHERE id = ? AND brand_id = ? AND owner_id = ? AND status = 'proposed'
       RETURNING id`,
      [status, updatedAt, briefId, brandId, ownerId],
    );
    return rows.length === 1;
  }
}
