import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";

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
  ordered: z.union([z.literal(0), z.literal(1)]),
  position: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export type CompetitorSetRow = z.infer<typeof setRow>;
export type CompetitorMentionRow = z.infer<typeof mentionRow>;

const flag = z.union([z.literal(0), z.literal(1)]);
const inspectionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  citationId: brandIdSchema,
  state: z.enum(["observed", "resolved", "limited", "unknown"]),
  support: z.enum(["supports", "unknown"]),
  pageLive: flag,
  readable: flag,
  authorKnown: flag,
  supportsBrand: flag,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});
const citationViewRow = z.object({
  citationId: brandIdSchema,
  observationId: brandIdSchema,
  rawUrl: z.string(),
  normalizedUrl: z.string(),
  ownership: z.string(),
  pageStatus: z.string(),
  state: z.enum(["observed", "resolved", "limited", "unknown"]).nullable(),
  support: z.enum(["supports", "unknown"]).nullable(),
  pageLive: flag.nullable(),
  readable: flag.nullable(),
  authorKnown: flag.nullable(),
  supportsBrand: flag.nullable(),
});

export type SourceInspectionRow = z.infer<typeof inspectionRow>;
export type CitationSourceRow = z.infer<typeof citationViewRow>;

const setColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", version, labels_json AS "labelsJson", created_at AS "createdAt"`;
const mentionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", set_id AS "setId",
  observation_id AS "observationId", competitor_label AS "competitorLabel", "ordered", position, created_at AS "createdAt"`;

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

  async insertMention(row: CompetitorMentionRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO competitor_mention (
        id, brand_id, owner_id, set_id, observation_id, competitor_label, "ordered", position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.setId, row.observationId, row.competitorLabel,
        row.ordered, row.position, row.createdAt,
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
    if (count > 5000) return { truncated: true as const, rows: [] as CompetitorMentionRow[] };
    const rows = await queryWithParameters(
      this.db,
      `SELECT ${mentionColumns} FROM competitor_mention
       WHERE owner_id = ? AND brand_id = ? AND set_id = ?
       ORDER BY created_at ASC, id ASC`,
      [ownerId, brandId, setId],
    );
    return { truncated: false as const, rows: rows.map((row) => mentionRow.parse(row)) };
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
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId", citation_id AS "citationId",
              state, support, page_live AS "pageLive", readable, author_known AS "authorKnown",
              supports_brand AS "supportsBrand", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM source_inspection WHERE citation_id = ?`,
      [citationId],
    );
    return row ? inspectionRow.parse(row) : null;
  }

  async insertInspection(row: SourceInspectionRow) {
    await queryWithParameters(
      this.db,
      `INSERT INTO source_inspection (
        id, brand_id, owner_id, citation_id, state, support, page_live, readable,
        author_known, supports_brand, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.citationId, row.state, row.support, row.pageLive,
        row.readable, row.authorKnown, row.supportsBrand, row.createdAt, row.updatedAt,
      ],
    );
  }

  async updateInspection(row: SourceInspectionRow) {
    await queryWithParameters(
      this.db,
      `UPDATE source_inspection SET
        state = ?, support = ?, page_live = ?, readable = ?, author_known = ?, supports_brand = ?, updated_at = ?
       WHERE id = ? AND brand_id = ? AND owner_id = ? AND citation_id = ?`,
      [
        row.state, row.support, row.pageLive, row.readable, row.authorKnown, row.supportsBrand, row.updatedAt,
        row.id, row.brandId, row.ownerId, row.citationId,
      ],
    );
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
              c.normalized_url AS "normalizedUrl", c.ownership, c.page_status AS "pageStatus",
              i.state, i.support, i.page_live AS "pageLive", i.readable,
              i.author_known AS "authorKnown", i.supports_brand AS "supportsBrand"
       FROM answer_citation c
       JOIN answer_observation o ON o.id = c.observation_id
       LEFT JOIN source_inspection i ON i.citation_id = c.id AND i.brand_id = c.brand_id
       WHERE c.brand_id = ? AND o.brand_id = ? AND o.owner_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [brandId, brandId, ownerId],
    );
    return { truncated: false as const, rows: rows.map((row) => citationViewRow.parse(row)) };
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
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId", question_cluster AS "questionCluster",
              gap, facts_json AS "factsJson", source_ids_json AS "sourceIdsJson", status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM research_brief
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [ownerId, brandId],
    );
    return rows.map((row) => z.object({
      id: brandIdSchema,
      brandId: brandIdSchema,
      ownerId: z.string().min(1),
      questionCluster: z.string(),
      gap: z.string(),
      factsJson: z.string(),
      sourceIdsJson: z.string(),
      status: z.enum(["proposed", "accepted", "dismissed"]),
      createdAt: z.iso.datetime({ precision: 3 }),
      updatedAt: z.iso.datetime({ precision: 3 }),
    }).parse(row));
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
