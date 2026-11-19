import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { draftContent, timestamp, type DraftContent, type PromptCursor } from "./contracts.ts";
import { brandIdSchema } from "../brands/contracts.ts";

const revision = z.number().int().positive();
const draftRow = z.object({
  revision, baseSetId: brandIdSchema.nullable(), content: z.string(), updatedAt: timestamp,
});
const setRow = z.object({
  id: brandIdSchema, setId: brandIdSchema, version: revision, entityVersion: revision,
  region: z.string(), language: z.string(), content: z.string(), createdAt: timestamp,
});
const exportDraftRow = draftRow.extend({ brandId: brandIdSchema });
const exportSetRow = setRow.extend({ brandId: brandIdSchema });

export const pageSize = 20;

function parseContent(content: string) {
  return draftContent.parse(JSON.parse(content));
}

export class PromptDao {
  private readonly connection: QueryConnection;
  private readonly brandId: string;

  constructor(connection: QueryConnection, brandId = "") {
    this.connection = connection;
    this.brandId = brandId;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async draft() {
    const [row] = await this.query(`SELECT revision, base_set_id AS "baseSetId", content, updated_at AS "updatedAt"
      FROM prompt_draft WHERE brand_id = ?`, [this.brandId]);
    if (!row) return null;
    const parsed = draftRow.parse(row);
    return { ...parsed, content: parseContent(parsed.content) };
  }

  async insertDraft(revisionNumber: number, baseSetId: string | null, content: DraftContent, updatedAt: string) {
    await this.query(`INSERT INTO prompt_draft (brand_id, revision, base_set_id, content, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [this.brandId, revisionNumber, baseSetId, JSON.stringify(content), updatedAt]);
  }

  async updateDraft(expected: number, revisionNumber: number, baseSetId: string | null, content: DraftContent, updatedAt: string) {
    const rows = await this.query(`UPDATE prompt_draft SET revision = ?, base_set_id = ?, content = ?, updated_at = ?
      WHERE brand_id = ? AND revision = ? RETURNING revision`,
    [revisionNumber, baseSetId, JSON.stringify(content), updatedAt, this.brandId, expected]);
    return rows.length === 1;
  }

  async versions(after?: PromptCursor) {
    const rows = await this.query(`SELECT id, set_id AS "setId", version, entity_version AS "entityVersion",
      region, language, content, created_at AS "createdAt"
      FROM prompt_set WHERE brand_id = ? ${after ? "AND (created_at, id) < (?, ?)" : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    after ? [this.brandId, after.at, after.id, pageSize + 1] : [this.brandId, pageSize + 1]);
    return z.array(setRow).parse(rows).map((row) => ({ ...row, content: parseContent(row.content) }));
  }

  async version(id: string) {
    const [row] = await this.query(`SELECT id, set_id AS "setId", version, entity_version AS "entityVersion",
      region, language, content, created_at AS "createdAt"
      FROM prompt_set WHERE brand_id = ? AND id = ?`, [this.brandId, id]);
    if (!row) return null;
    const parsed = setRow.parse(row);
    return { ...parsed, content: parseContent(parsed.content) };
  }

  async versionNumber(setId: string, version: number) {
    const [row] = await this.query(`SELECT id, set_id AS "setId", version, entity_version AS "entityVersion",
      region, language, content, created_at AS "createdAt"
      FROM prompt_set WHERE brand_id = ? AND set_id = ? AND version = ?`, [this.brandId, setId, version]);
    if (!row) return null;
    const parsed = setRow.parse(row);
    return { ...parsed, content: parseContent(parsed.content) };
  }

  async familyId() {
    const [row] = await this.query(`SELECT set_id AS "setId" FROM prompt_set WHERE brand_id = ? LIMIT 1`, [this.brandId]);
    return row ? brandIdSchema.parse(row.setId) : null;
  }

  async referencedIds() {
    const rows = await this.query(`SELECT DISTINCT question_id AS id FROM prompt_reference WHERE brand_id = ?`, [this.brandId]);
    return z.array(z.object({ id: brandIdSchema })).parse(rows).map((row) => row.id);
  }

  async insertSet(input: {
    id: string; setId: string; version: number; entityVersion: number; region: string; language: string;
    content: DraftContent; createdAt: string;
  }) {
    await this.query(`INSERT INTO prompt_set
      (brand_id, id, set_id, version, entity_version, region, language, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [this.brandId, input.id, input.setId, input.version, input.entityVersion, input.region, input.language,
      JSON.stringify(input.content), input.createdAt]);
  }

  async reference(setVersionId: string, questionIds: string[], consumerId: string) {
    if (!questionIds.length) return;
    await this.query(`INSERT INTO prompt_reference (brand_id, set_version_id, question_id, consumer_id) VALUES
      ${questionIds.map(() => "(?, ?, ?, ?)").join(", ")}
      ON CONFLICT (brand_id, set_version_id, question_id, consumer_id) DO NOTHING`,
    questionIds.flatMap((questionId) => [this.brandId, setVersionId, questionId, consumerId]));
  }

  async exportDrafts(ownerId: string, limit: number, after: string) {
    const rows = await this.query(`SELECT d.brand_id AS "brandId", d.revision, d.base_set_id AS "baseSetId", d.content, d.updated_at AS "updatedAt"
      FROM prompt_draft d JOIN brand b ON b.id = d.brand_id
      WHERE b.owner_id = ? AND b.frozen_at IS NULL AND d.brand_id > ?
      ORDER BY d.brand_id LIMIT ?`, [ownerId, after, limit]);
    return z.array(exportDraftRow).parse(rows).map((row) => ({ ...row, content: parseContent(row.content) }));
  }

  async exportSets(ownerId: string, limit: number, after?: { brandId: string; at: string; id: string }) {
    const rows = await this.query(`SELECT s.brand_id AS "brandId", s.id, s.set_id AS "setId", s.version, s.entity_version AS "entityVersion",
      s.region, s.language, s.content, s.created_at AS "createdAt"
      FROM prompt_set s JOIN brand b ON b.id = s.brand_id
      WHERE b.owner_id = ? AND b.frozen_at IS NULL
      ${after ? "AND (s.brand_id, s.created_at, s.id) > (?, ?, ?)" : ""}
      ORDER BY s.brand_id, s.created_at, s.id LIMIT ?`,
    after ? [ownerId, after.brandId, after.at, after.id, limit] : [ownerId, limit]);
    return z.array(exportSetRow).parse(rows).map((row) => ({ ...row, content: parseContent(row.content) }));
  }
}

export function cursorValue(cursor: PromptCursor) {
  return `${cursor.at},${cursor.id}`;
}
