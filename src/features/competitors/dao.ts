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
}
