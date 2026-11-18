import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import {
  factFields, factStage, pasteRow, versionRow,
  type FactCursor, type FactFields, type FactScope, type FactStage, type FactVersion,
} from "./contracts.ts";
import { brandIdSchema } from "../brands/contracts.ts";

const versionColumns = `f.id, f.fact_id AS "factId", f.version, f.entity_version AS "entityVersion", f.revision, f.state,
  f.content, f.created_at AS "createdAt", f.confirmed_by AS "confirmedBy",
  f.confirmed_at AS "confirmedAt", f.revoked_at AS "revokedAt"`;
const pasteSummary = pasteRow.omit({ original: true });
const useRow = z.object({ contentVersionId: brandIdSchema, stage: factStage });
export const pageSize = 20;

function version(row: unknown): FactVersion {
  const { content, ...rest } = versionRow.parse(row);
  const fields = factFields.parse(JSON.parse(content));
  return { ...rest, fields };
}

export class FactDao {
  private readonly db: QueryConnection;
  private readonly scope: FactScope;

  constructor(db: QueryConnection, scope: FactScope) {
    this.db = db;
    this.scope = scope;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, [this.scope.brandId, this.scope.ownerId, ...values]);
  }

  // All reads include the live, owner-scoped brand even when resolving exact IDs.
  private read(columns: string, table: "brand_fact_version" | "brand_fact_paste" | "brand_fact_use", where = "", values: QueryValue[] = []) {
    return this.query(`SELECT ${columns} FROM ${table} f JOIN brand b ON b.id = f.brand_id
      WHERE f.brand_id = ? AND b.owner_id = ? AND b.frozen_at IS NULL ${where}`, values);
  }

  async versions(cursor?: FactCursor) {
    const before = cursor ? "AND (f.created_at, f.id) < (?, ?)" : "";
    const rows = await this.read(versionColumns, "brand_fact_version",
      `${before} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`, cursor ? [cursor.at, cursor.id, pageSize + 1] : [pageSize + 1]);
    return rows.map(version);
  }

  async version(id: string) {
    const [row] = await this.read(versionColumns, "brand_fact_version", "AND f.id = ?", [id]);
    return row ? version(row) : null;
  }

  async versionsById(ids: string[]) {
    const rows = await this.read(versionColumns, "brand_fact_version",
      `AND f.id IN (${ids.map(() => "?").join(", ")})`, ids);
    return rows.map(version);
  }

  async latest(factId: string) {
    const [row] = await this.read(versionColumns, "brand_fact_version",
      "AND f.fact_id = ? ORDER BY f.version DESC LIMIT 1", [factId]);
    return row ? version(row) : null;
  }

  async priorApproval(item: FactVersion) {
    const [row] = await this.read(versionColumns, "brand_fact_version",
      "AND f.fact_id = ? AND f.version < ? AND f.state = 'approved' ORDER BY f.version DESC LIMIT 1",
      [item.factId, item.version]);
    return row ? version(row) : null;
  }

  async pastes(cursor?: FactCursor) {
    const before = cursor ? "AND (f.created_at, f.id) < (?, ?)" : "";
    return z.array(pasteSummary).parse(await this.read('f.id, f.previous_id AS "previousId", f.created_at AS "createdAt"',
      "brand_fact_paste", `${before} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
      cursor ? [cursor.at, cursor.id, pageSize + 1] : [pageSize + 1]));
  }

  async paste(id: string) {
    const [row] = await this.read('f.id, f.previous_id AS "previousId", f.created_at AS "createdAt", f.original',
      "brand_fact_paste", "AND f.id = ?", [id]);
    return row ? pasteRow.parse(row) : null;
  }

  async pasteSuccessor(id: string) {
    const [row] = await this.read("f.id", "brand_fact_paste", "AND f.previous_id = ?", [id]);
    return row ? brandIdSchema.parse(row.id) : null;
  }

  async impact(factVersionId: string, after: string | undefined) {
    const cursor = after ? "AND f.content_version_id > ?" : "";
    const rows = await this.read('f.content_version_id AS "contentVersionId", f.stage', "brand_fact_use",
      `AND f.fact_version_id = ? ${cursor} ORDER BY f.content_version_id LIMIT ?`,
      after ? [factVersionId, after, pageSize + 1] : [factVersionId, pageSize + 1]);
    return z.array(useRow).parse(rows);
  }

  async savePaste(id: string, previousId: string | null, original: string, now: string) {
    await queryWithParameters(this.db, `INSERT INTO brand_fact_paste (brand_id, id, previous_id, original, created_at)
      SELECT id, ?, ?, ?, ? FROM brand WHERE id = ? AND owner_id = ? AND frozen_at IS NULL`,
    [id, previousId, original, now, this.scope.brandId, this.scope.ownerId]);
  }

  async insertVersion(item: FactVersion) {
    const { id, factId, version, entityVersion, fields, state, createdAt } = item;
    await queryWithParameters(this.db, `INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at)
      SELECT b.id, ?, ?, ?, ?, ?, 1, ?, ?, ? FROM brand b
      WHERE b.id = ? AND b.owner_id = ? AND b.frozen_at IS NULL`,
    [id, factId, version, entityVersion, fields.pasteId, state, JSON.stringify(fields), createdAt, this.scope.brandId, this.scope.ownerId]);
  }

  async edit(item: FactVersion, fields: FactFields) {
    await queryWithParameters(this.db, `UPDATE brand_fact_version SET content = ?, paste_id = ?, revision = revision + 1
      WHERE brand_id = ? AND id = ? AND EXISTS (SELECT 1 FROM brand WHERE id = ? AND owner_id = ? AND frozen_at IS NULL)`,
    [JSON.stringify(fields), fields.pasteId, this.scope.brandId, item.id, this.scope.brandId, this.scope.ownerId]);
  }

  async transition(item: FactVersion, state: FactVersion["state"], at: string) {
    await queryWithParameters(this.db, `UPDATE brand_fact_version SET state = ?, revision = revision + 1,
      confirmed_by = ?, confirmed_at = ?, revoked_at = ?
      WHERE brand_id = ? AND id = ? AND EXISTS (SELECT 1 FROM brand WHERE id = ? AND owner_id = ? AND frozen_at IS NULL)`,
    [state, state === "approved" ? this.scope.ownerId : item.confirmedBy, state === "approved" ? at : item.confirmedAt,
      state === "revoked" ? at : null, this.scope.brandId, item.id, this.scope.brandId, this.scope.ownerId]);
  }

  async usedVersionIds(contentVersionId: string) {
    const rows = await this.read('f.fact_version_id AS id', "brand_fact_use", "AND f.content_version_id = ?", [contentVersionId]);
    return rows.map(({ id }) => brandIdSchema.parse(id));
  }

  async recordUse(contentVersionId: string, stage: FactStage, ids: string[]) {
    await queryWithParameters(this.db, `INSERT INTO brand_fact_use (brand_id, fact_version_id, content_version_id, stage)
      VALUES ${ids.map(() => "(?, ?, ?, ?)").join(", ")}
      ON CONFLICT (brand_id, fact_version_id, content_version_id) DO UPDATE SET stage = excluded.stage`,
    ids.flatMap((id) => [this.scope.brandId, id, contentVersionId, stage]));
  }
}
