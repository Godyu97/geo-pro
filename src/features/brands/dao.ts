import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import {
  brandDraftFieldsSchema, brandFieldsSchema, brandIdSchema, brandMutationSchema,
  brandStatusSchema, brandStepSchema,
  type ArchiveCursor, type BrandFields, type BrandMutation, type BrandStep,
} from "./contracts.ts";

const brandRowSchema = z.object({
  id: brandIdSchema,
  status: brandStatusSchema,
  revision: z.number().int().positive(),
  entityVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
const draftRowSchema = z.object({
  version: brandIdSchema,
  baseRevision: z.number().int().positive().nullable(),
  step: brandStepSchema,
  content: z.string(),
});
const versionRowSchema = brandRowSchema.extend({
  name: z.string(),
  content: z.string(),
  version: z.number().int().positive(),
  versionCreatedAt: z.iso.datetime(),
});
const exportDraftRowSchema = draftRowSchema.extend({
  scope: z.union([z.literal("new"), brandIdSchema]),
  updatedAt: z.iso.datetime(),
});
const summarySchema = brandRowSchema.extend({ name: z.string() });
const operationRowSchema = z.object({ fingerprint: z.string(), result: z.string() });
const frozenBrandSchema = z.object({
  id: brandIdSchema,
  revision: z.number().int().positive(),
  frozenAt: z.iso.datetime(),
  restoreUntil: z.iso.datetime(),
});
const deletionStateSchema = brandRowSchema.extend({
  frozenAt: z.iso.datetime().nullable(),
  restoreUntil: z.iso.datetime().nullable(),
}).refine(({ frozenAt, restoreUntil }) => (frozenAt === null) === (restoreUntil === null));
const deletionImpactSchema = z.object({
  id: brandIdSchema,
  revision: z.number().int().positive(),
  name: z.string(),
  versions: z.coerce.number().int().nonnegative(),
  drafts: z.coerce.number().int().nonnegative(),
  facts: z.coerce.number().int().nonnegative(),
  materials: z.coerce.number().int().nonnegative(),
  reservations: z.coerce.number().int().nonnegative(),
  unresolvedAttempts: z.coerce.number().int().nonnegative(),
});
const brandColumns = 'b.id, b.status, b.revision, b.entity_version AS "entityVersion", b.created_at AS "createdAt"';

export const brandPageSize = 20;
export type BrandRecord = z.infer<typeof brandRowSchema>;
type VersionCursor = Pick<z.infer<typeof versionRowSchema>, "status" | "createdAt" | "id" | "version">;

function parseVersion(row: unknown) {
  const { name, content, ...rest } = versionRowSchema.parse(row);
  return { ...rest, fields: brandFieldsSchema.parse({ ...JSON.parse(content), name }) };
}

export class BrandDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async lockOwner(ownerId: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR NO KEY UPDATE" : "";
    const rows = await this.query('SELECT id FROM "user" WHERE id = ?' + lock, [ownerId]);
    return rows.length === 1;
  }

  async active(ownerId: string) {
    const [row] = await this.query(`SELECT ${brandColumns}, v.name
      FROM brand b JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
      WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL`, [ownerId]);
    return row ? summarySchema.parse(row) : null;
  }

  async archived(ownerId: string, cursor?: ArchiveCursor) {
    const before = cursor ? "AND (b.created_at, b.id) < (?, ?)" : "";
    const rows = await this.query(`SELECT ${brandColumns},
      (SELECT v.name FROM brand_version v WHERE v.brand_id = b.id AND v.version = b.entity_version) AS name
      FROM brand b WHERE b.owner_id = ? AND b.status = 'archived' AND b.frozen_at IS NULL ${before}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
    cursor ? [ownerId, cursor.at, cursor.id, brandPageSize + 1] : [ownerId, brandPageSize + 1]);
    const items = z.array(summarySchema).parse(rows);
    const last = items[brandPageSize - 1];
    return {
      items: items.slice(0, brandPageSize),
      next: items.length > brandPageSize && last ? { at: last.createdAt, id: last.id } : null,
    };
  }

  async owned(ownerId: string, id: string) {
    const [row] = await this.query(`SELECT ${brandColumns} FROM brand b
      WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`, [ownerId, id]);
    return row ? brandRowSchema.parse(row) : null;
  }

  async deletionState(ownerId: string, id: string) {
    const [row] = await this.query(`SELECT ${brandColumns}, b.frozen_at AS "frozenAt", b.restore_until AS "restoreUntil"
      FROM brand b WHERE b.owner_id = ? AND b.id = ?`, [ownerId, id]);
    return row ? deletionStateSchema.parse(row) : null;
  }

  async deletionImpact(ownerId: string, id: string) {
    const [row] = await this.query(`SELECT b.id, b.revision, v.name,
      (SELECT count(*) FROM brand_version WHERE brand_id = b.id) AS versions,
      (SELECT count(*) FROM brand_draft WHERE owner_id = b.owner_id AND scope = b.id) AS drafts,
      (SELECT count(*) FROM brand_fact_version WHERE brand_id = b.id) AS facts,
      (SELECT count(*) FROM brand_fact_paste WHERE brand_id = b.id) AS materials,
      (SELECT count(*) FROM quota_reservation WHERE brand_id = b.id AND state = 'reserved') AS reservations,
      (SELECT count(*) FROM quota_attempt WHERE brand_id = b.id AND state <> 'known') AS "unresolvedAttempts"
      FROM brand b JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
      WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`, [ownerId, id]);
    return row ? deletionImpactSchema.parse(row) : null;
  }

  async frozen(ownerId: string, cursor?: ArchiveCursor) {
    const before = cursor ? "AND (frozen_at, id) < (?, ?)" : "";
    const rows = await this.query(`SELECT id, revision, frozen_at AS "frozenAt", restore_until AS "restoreUntil"
      FROM brand WHERE owner_id = ? AND frozen_at IS NOT NULL ${before}
      ORDER BY frozen_at DESC, id DESC LIMIT ?`,
    cursor ? [ownerId, cursor.at, cursor.id, brandPageSize + 1] : [ownerId, brandPageSize + 1]);
    const items = z.array(frozenBrandSchema).parse(rows);
    const last = items[brandPageSize - 1];
    return {
      items: items.slice(0, brandPageSize),
      next: items.length > brandPageSize && last ? { at: last.frozenAt, id: last.id } : null,
    };
  }

  async updateDeletion(ownerId: string, current: BrandRecord, frozenAt: string | null, restoreUntil: string | null) {
    const [row] = await this.query(`UPDATE brand SET frozen_at = ?, restore_until = ?, revision = revision + 1
      WHERE owner_id = ? AND id = ? AND revision = ? RETURNING revision`,
    [frozenAt, restoreUntil, ownerId, current.id, current.revision]);
    return row ? z.number().int().positive().parse(row.revision) : null;
  }

  async rebaseDraft(ownerId: string, id: string, fromRevision: number, toRevision: number) {
    await this.query("UPDATE brand_draft SET base_revision = ? WHERE owner_id = ? AND scope = ? AND base_revision = ?",
      [toRevision, ownerId, id, fromRevision]);
  }

  async version(ownerId: string, id: string, version?: number) {
    const [row] = await this.query(`SELECT ${brandColumns}, v.name, v.content, v.version, v.created_at AS "versionCreatedAt"
      FROM brand b JOIN brand_version v ON v.brand_id = b.id AND v.version = coalesce(?, b.entity_version)
      WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`, [version ?? null, ownerId, id]);
    return row ? parseVersion(row) : null;
  }

  async exportVersions(ownerId: string, limit: number, cursor?: VersionCursor) {
    const after = cursor ? "AND (b.status, b.created_at, b.id, v.version) > (?, ?, ?, ?)" : "";
    const rows = await this.query(`SELECT ${brandColumns}, v.name, v.content, v.version, v.created_at AS "versionCreatedAt"
      FROM brand b JOIN brand_version v ON v.brand_id = b.id
      WHERE b.owner_id = ? AND b.status IN ('active', 'archived') AND b.frozen_at IS NULL ${after}
      ORDER BY b.status, b.created_at, b.id, v.version LIMIT ?`,
    cursor ? [ownerId, cursor.status, cursor.createdAt, cursor.id, cursor.version, limit] : [ownerId, limit]);
    return rows.map(parseVersion);
  }

  async exportDrafts(ownerId: string, limit: number, after: string) {
    const rows = await this.query(`SELECT d.scope, d.version, d.base_revision AS "baseRevision", d.step, d.content, d.updated_at AS "updatedAt"
      FROM brand_draft d LEFT JOIN brand b ON b.id = d.scope AND b.owner_id = ? AND b.frozen_at IS NULL
      WHERE d.owner_id = ? AND d.scope > ? AND (d.scope = 'new' OR b.id IS NOT NULL)
      ORDER BY d.scope LIMIT ?`, [ownerId, ownerId, after, limit]);
    return rows.map((row) => {
      const { content, ...draft } = exportDraftRowSchema.parse(row);
      return { ...draft, fields: brandDraftFieldsSchema.parse(JSON.parse(content)) };
    });
  }

  async draft(ownerId: string, scope: string) {
    const [row] = await this.query(`SELECT version, base_revision AS "baseRevision", step, content
      FROM brand_draft d WHERE d.owner_id = ? AND d.scope = ? AND (d.scope = 'new' OR EXISTS (
        SELECT 1 FROM brand b WHERE b.id = d.scope AND b.owner_id = d.owner_id AND b.frozen_at IS NULL
      ))`, [ownerId, scope]);
    if (!row) return null;
    const { content, ...rest } = draftRowSchema.parse(row);
    return { ...rest, fields: brandDraftFieldsSchema.parse(JSON.parse(content)) };
  }

  async saveDraft(ownerId: string, scope: string, version: string, baseRevision: number | null, step: BrandStep, fields: BrandFields, time: string) {
    await this.query(`INSERT INTO brand_draft (owner_id, scope, version, base_revision, step, content, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, scope) DO UPDATE SET version = excluded.version, base_revision = excluded.base_revision,
        step = excluded.step, content = excluded.content, updated_at = excluded.updated_at`,
    [ownerId, scope, version, baseRevision, step, JSON.stringify(fields), time]);
  }

  async deleteDraft(ownerId: string, scope: string) {
    await this.query("DELETE FROM brand_draft WHERE owner_id = ? AND scope = ?", [ownerId, scope]);
  }

  async insertBrand(ownerId: string, id: string, time: string) {
    await this.query(`INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
      VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  }

  async updateBrand(ownerId: string, current: BrandRecord, status: BrandRecord["status"], entityVersion: number) {
    const [row] = await this.query(`UPDATE brand SET status = ?, entity_version = ?, revision = revision + 1
      WHERE owner_id = ? AND id = ? AND revision = ? AND frozen_at IS NULL
      RETURNING id, status, revision, entity_version AS "entityVersion", created_at AS "createdAt"`,
    [status, entityVersion, ownerId, current.id, current.revision]);
    return row ? brandRowSchema.parse(row) : null;
  }

  async insertVersion(brandId: string, version: number, fields: BrandFields, time: string) {
    const { name, ...content } = fields;
    await this.query(`INSERT INTO brand_version (brand_id, version, name, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    [brandId, version, name, JSON.stringify(content), time]);
  }

  async operation(ownerId: string, id: string) {
    const [row] = await this.query("SELECT fingerprint, result FROM brand_operation WHERE owner_id = ? AND operation_id = ?", [ownerId, id]);
    if (!row) return null;
    const { fingerprint, result } = operationRowSchema.parse(row);
    return { fingerprint, mutation: brandMutationSchema.parse(JSON.parse(result)) };
  }

  async recordOperation(ownerId: string, id: string, fingerprint: string, result: BrandMutation, time: string, scope: string) {
    await this.query(`INSERT INTO brand_operation (owner_id, operation_id, fingerprint, result, created_at, scope)
      VALUES (?, ?, ?, ?, ?, ?)`, [ownerId, id, fingerprint, JSON.stringify(result), time, scope]);
  }
}

export type BrandDraft = NonNullable<Awaited<ReturnType<BrandDao["draft"]>>>;
export type BrandVersion = NonNullable<Awaited<ReturnType<BrandDao["version"]>>>;
