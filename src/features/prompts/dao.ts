import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { draftContent, suggestionCandidate, timestamp, type DraftContent, type PromptCursor, type PromptSuggestion, type SuggestionCandidate } from "./contracts.ts";
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

  async latestVersion() {
    const [row] = await this.query(`SELECT id, set_id AS "setId", version, entity_version AS "entityVersion",
      region, language, content, created_at AS "createdAt"
      FROM prompt_set WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [this.brandId]);
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

  async suggestions(ownerId: string): Promise<PromptSuggestion[]> {
    const rows = await this.query(`SELECT id, prompt_set_id AS "promptSetId", candidate, created_at AS "createdAt"
      FROM prompt_ai_suggestion WHERE brand_id = ? AND owner_id = ? AND status = 'draft'
      ORDER BY created_at DESC, id DESC LIMIT 20`, [this.brandId, ownerId]);
    const suggestions: PromptSuggestion[] = [];
    for (const row of z.array(z.object({
      id: brandIdSchema, promptSetId: brandIdSchema.nullable(), candidate: z.string(), createdAt: timestamp,
    })).parse(rows)) {
      const candidate = parseSuggestionCandidate(row.candidate);
      if (candidate) suggestions.push({ id: row.id, promptSetId: row.promptSetId, createdAt: row.createdAt, candidate });
    }
    return suggestions;
  }

  async suggestion(ownerId: string, id: string) {
    const [row] = await this.query(`SELECT id, prompt_set_id AS "promptSetId", status, candidate, created_at AS "createdAt"
      FROM prompt_ai_suggestion WHERE brand_id = ? AND owner_id = ? AND id = ?`, [this.brandId, ownerId, id]);
    if (!row) return null;
    const parsed = z.object({
      id: brandIdSchema, promptSetId: brandIdSchema.nullable(),
      status: z.enum(["draft", "accepted", "dismissed"]), candidate: z.string(), createdAt: timestamp,
    }).parse(row);
    const candidate = parseSuggestionCandidate(parsed.candidate);
    return candidate ? { ...parsed, candidate } : null;
  }

  async insertSuggestions(ownerId: string, rows: Array<{
    id: string; promptSetId: string | null; modelName: string; candidate: SuggestionCandidate; createdAt: string;
  }>) {
    if (!rows.length) return;
    await this.query(`INSERT INTO prompt_ai_suggestion
      (id, brand_id, owner_id, prompt_set_id, status, model_name, candidate, created_at)
      VALUES ${rows.map(() => "(?, ?, ?, ?, 'draft', ?, ?, ?)").join(", ")}`,
    rows.flatMap((row) => [row.id, this.brandId, ownerId, row.promptSetId, row.modelName, JSON.stringify(row.candidate), row.createdAt]));
  }

  async clusterSources(ids: string[]) {
    const found = new Map<string, PromptClusterSource>();
    const unique = [...new Set(ids)];
    for (let index = 0; index < unique.length; index += 100) {
      const part = unique.slice(index, index + 100);
      if (!part.length) continue;
      const query = promptSetBatchQuery(this.brandId, part);
      const rows = await this.query(query.sql, query.values);
      for (const row of z.array(z.object({ id: brandIdSchema, version: revision, content: z.string() })).parse(rows)) {
        const source = parseClusterSource(row);
        if (source) found.set(row.id, source);
      }
    }
    return found;
  }

  async latestClusterSource() {
    const query = latestPromptSetQuery(this.brandId);
    const [row] = await this.query(query.sql, query.values);
    if (!row) return null;
    return parseClusterSource(z.object({ id: brandIdSchema, version: revision, content: z.string() }).parse(row));
  }

  async markSuggestion(ownerId: string, id: string, status: "accepted" | "dismissed") {
    const rows = await this.query(`UPDATE prompt_ai_suggestion SET status = ?
      WHERE brand_id = ? AND owner_id = ? AND id = ? AND status = 'draft' RETURNING id`,
    [status, this.brandId, ownerId, id]);
    return rows.length === 1;
  }
}

export function latestPromptSetQuery(brandId: string) {
  return {
    sql: `SELECT id, version, content FROM prompt_set WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    values: [brandId] as QueryValue[],
  };
}

export function promptSetBatchQuery(brandId: string, ids: readonly string[]) {
  return {
    sql: `SELECT id, version, content FROM prompt_set WHERE brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    values: [brandId, ...ids] as QueryValue[],
  };
}

export type PromptClusterSource = {
  id: string;
  version: number;
  questions: Array<Pick<DraftContent["questions"][number], "id" | "text" | "clusterId" | "type">>;
  clusters: Array<{ id: string; audience: string; intent: string }>;
};

function parseClusterSource(row: { id: string; version: number; content: string }): PromptClusterSource | null {
  try {
    const content = draftContent.safeParse(JSON.parse(row.content));
    if (!content.success) return null;
    return {
      id: row.id,
      version: row.version,
      questions: content.data.questions.map((question) => ({
        id: question.id,
        text: question.text,
        clusterId: question.clusterId,
        type: question.type,
      })),
      clusters: content.data.clusters.map((cluster) => ({
        id: cluster.id,
        audience: cluster.audience,
        intent: cluster.intent,
      })),
    };
  } catch {
    return null;
  }
}

function parseSuggestionCandidate(value: string) {
  try {
    const candidate = suggestionCandidate.safeParse(JSON.parse(value));
    return candidate.success ? candidate.data : null;
  } catch {
    return null;
  }
}

export function cursorValue(cursor: PromptCursor) {
  return `${cursor.at},${cursor.id}`;
}
