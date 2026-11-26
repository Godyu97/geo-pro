import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import {
  SOURCE_REASONS,
  SOURCE_RIGHTS,
  SOURCE_STATUSES,
  type SourceReason,
  type SourceRights,
  type SourceStatus,
} from "./contracts.ts";

const timeSchema = z.iso.datetime();

const sourceRowSchema = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  batchId: brandIdSchema,
  fileName: z.string().min(1).refine((value) => [...value].length <= 120 && !value.includes("/") && !value.includes("..")),
  byteSize: z.number().int().nonnegative(),
  storedObjectId: brandIdSchema.nullable(),
  status: z.enum(SOURCE_STATUSES),
  reason: z.enum(SOURCE_REASONS).nullable(),
  rightsStatus: z.enum(SOURCE_RIGHTS),
  createdAt: timeSchema,
}).refine((row) => (row.status === "failed" ? row.storedObjectId === null && row.reason !== null : row.storedObjectId !== null && row.reason === null));

export type SourceOriginalRow = z.infer<typeof sourceRowSchema>;

export type SourceOriginalInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  batchId: string;
  fileName: string;
  byteSize: number;
  storedObjectId: string | null;
  status: SourceStatus;
  reason: SourceReason | null;
  rightsStatus: SourceRights;
  createdAt: string;
};

const columns = `id, brand_id AS "brandId", batch_id AS "batchId", file_name AS "fileName",
  byte_size AS "byteSize", stored_object_id AS "storedObjectId", status, reason,
  rights_status AS "rightsStatus", created_at AS "createdAt"`;

export async function insertSourceOriginals(db: QueryConnection, rows: readonly SourceOriginalInsert[]) {
  if (rows.length === 0) return;
  const values: QueryValue[] = [];
  const groups = rows.map((row) => {
    values.push(
      row.id,
      row.brandId,
      row.ownerId,
      row.batchId,
      row.fileName,
      row.byteSize,
      row.storedObjectId,
      row.status,
      row.reason,
      row.rightsStatus,
      row.createdAt,
    );
    return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  });
  await queryWithParameters(
    db,
    `INSERT INTO source_original (
      id, brand_id, owner_id, batch_id, file_name, byte_size, stored_object_id, status, reason, rights_status, created_at
    ) VALUES ${groups.join(", ")}`,
    values,
  );
}

const approvedFactSchema = z.object({
  id: brandIdSchema,
  version: z.number().int().positive(),
  content: z.string(),
});

export async function listApprovedFactContents(db: QueryConnection, brandId: string) {
  const rows = await queryWithParameters(
    db,
    `SELECT id, version, content FROM brand_fact_version
     WHERE brand_id = ? AND state = 'approved' AND revoked_at IS NULL
     ORDER BY id`,
    [brandId],
  );
  return z.array(approvedFactSchema).parse(rows);
}

export async function listSourceOriginals(db: QueryConnection, ownerId: string, brandId: string, limit: number) {
  const rows = await queryWithParameters(
    db,
    `SELECT ${columns} FROM source_original
     WHERE owner_id = ? AND brand_id = ?
     ORDER BY created_at DESC, batch_id DESC, id DESC
     LIMIT ?`,
    [ownerId, brandId, limit],
  );
  return z.array(sourceRowSchema).parse(rows);
}

export async function listBrandSourceOriginals(db: QueryConnection, brandId: string, limit: number) {
  const rows = await queryWithParameters(
    db,
    `SELECT ${columns} FROM source_original
     WHERE brand_id = ?
     ORDER BY created_at DESC, batch_id DESC, id DESC
     LIMIT ?`,
    [brandId, limit],
  );
  return z.array(sourceRowSchema).parse(rows);
}

export async function loadSourceOriginal(db: QueryConnection, ownerId: string, brandId: string, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT ${columns} FROM source_original WHERE owner_id = ? AND brand_id = ? AND id = ?`,
    [ownerId, brandId, id],
  );
  return row ? sourceRowSchema.parse(row) : null;
}

export async function setSourceOriginalRights(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  id: string,
  rights: "revoked" | "expired",
) {
  const [row] = await queryWithParameters(
    db,
    `UPDATE source_original SET rights_status = ?
     WHERE owner_id = ? AND brand_id = ? AND id = ? AND stored_object_id IS NOT NULL
       AND status IN ('ready', 'partial')
     RETURNING ${columns}`,
    [rights, ownerId, brandId, id],
  );
  return row ? sourceRowSchema.parse(row) : null;
}

export async function sourceOriginalMayDownload(db: QueryConnection, actorId: string, objectId: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT owner_id AS "ownerId", brand_id AS "brandId" FROM source_original
     WHERE stored_object_id = ? AND rights_status = 'active'`,
    [objectId],
  );
  if (!row) return false;
  const parsed = z.object({ ownerId: z.string().min(1), brandId: brandIdSchema }).parse(row);
  if (parsed.ownerId === actorId) return true;
  const scope = await authorizeBrandActor(db, actorId, parsed.brandId, "download");
  return Boolean(scope && scope.ownerId === parsed.ownerId);
}

const fragmentRowSchema = z.object({
  id: brandIdSchema,
  sourceId: brandIdSchema,
  ordinal: z.number().int().nonnegative().max(199),
  page: z.number().int().positive().max(100_000).nullable(),
  excerpt: z.string().min(1).max(50_000).nullable(),
  candidateState: z.literal("unapproved"),
});

const conflictRowSchema = z.object({
  fragmentId: brandIdSchema,
  factVersionId: brandIdSchema,
  factVersion: z.number().int().positive(),
});

export type SourceFragmentRow = z.infer<typeof fragmentRowSchema>;
export type SourceFragmentConflictRow = z.infer<typeof conflictRowSchema>;

export type SourceFragmentInsert = {
  id: string;
  sourceOriginalId: string;
  brandId: string;
  ownerId: string;
  ordinal: number;
  page: number | null;
  excerpt: string | null;
  createdAt: string;
};

export type SourceFragmentConflictInsert = {
  fragmentId: string;
  brandId: string;
  factVersionId: string;
  factVersion: number;
};

const fragmentColumns = `id, source_original_id AS "sourceId", ordinal, page, excerpt, candidate_state AS "candidateState"`;
const conflictColumns = `fragment_id AS "fragmentId", fact_version_id AS "factVersionId", fact_version AS "factVersion"`;
const insertChunk = 80;

function chunk<T>(items: readonly T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export async function insertSourceFragments(db: QueryConnection, rows: readonly SourceFragmentInsert[]) {
  for (const group of chunk(rows, insertChunk)) {
    const values: QueryValue[] = [];
    const groups = group.map((row) => {
      values.push(row.id, row.sourceOriginalId, row.brandId, row.ownerId, row.ordinal, row.page, row.excerpt, "unapproved", row.createdAt);
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      db,
      `INSERT INTO source_original_fragment (
        id, source_original_id, brand_id, owner_id, ordinal, page, excerpt, candidate_state, created_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }
}

export async function insertSourceFragmentConflicts(db: QueryConnection, rows: readonly SourceFragmentConflictInsert[]) {
  for (const group of chunk(rows, insertChunk)) {
    const values: QueryValue[] = [];
    const groups = group.map((row) => {
      values.push(row.fragmentId, row.brandId, row.factVersionId, row.factVersion);
      return "(?, ?, ?, ?)";
    });
    await queryWithParameters(
      db,
      `INSERT INTO source_original_fragment_conflict (fragment_id, brand_id, fact_version_id, fact_version)
       VALUES ${groups.join(", ")}`,
      values,
    );
  }
}

export async function listSourceFragments(db: QueryConnection, brandId: string, sourceIds: readonly string[]) {
  const rows: unknown[] = [];
  for (const ids of chunk(sourceIds, 100)) {
    const found = await queryWithParameters(
      db,
      `SELECT ${fragmentColumns} FROM source_original_fragment
       WHERE brand_id = ? AND source_original_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY source_original_id, ordinal`,
      [brandId, ...ids],
    );
    rows.push(...found);
  }
  return z.array(fragmentRowSchema).parse(rows).sort((left, right) => (
    left.sourceId === right.sourceId ? left.ordinal - right.ordinal : left.sourceId < right.sourceId ? -1 : 1
  ));
}

export async function listSourceFragmentConflicts(db: QueryConnection, brandId: string, fragmentIds: readonly string[]) {
  const rows: unknown[] = [];
  for (const ids of chunk(fragmentIds, 100)) {
    const found = await queryWithParameters(
      db,
      `SELECT ${conflictColumns} FROM source_original_fragment_conflict
       WHERE brand_id = ? AND fragment_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY fragment_id, fact_version, fact_version_id`,
      [brandId, ...ids],
    );
    rows.push(...found);
  }
  return z.array(conflictRowSchema).parse(rows);
}

export async function sourceAccessFor(db: QueryConnection, userId: string, brandId: string, now: string) {
  const owned = await brandOwnedBy(db, userId, brandId);
  if (owned) return { viewer: "owner", owned, role: "owner" as const } as const;
  const scope = await authorizeBrandActor(db, userId, brandId, "read", now);
  if (!scope) return null;
  return { viewer: "member", owned: null, role: scope.role } as const;
}

export async function brandOwnedBy(db: QueryConnection, ownerId: string, brandId: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT status, frozen_at AS "frozenAt" FROM brand WHERE id = ? AND owner_id = ?`,
    [brandId, ownerId],
  );
  if (!row) return null;
  const parsed = z.object({
    status: z.enum(["active", "archived"]),
    frozenAt: z.string().nullable(),
  }).parse(row);
  return parsed;
}
