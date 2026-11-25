import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  OBJECT_CLASSES,
  OBJECT_STATUSES,
  objectClassSchema,
  objectVisibilitySchema,
  type ObjectClass,
} from "./contracts.ts";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const timeSchema = z.iso.datetime();
const flagSchema = z.union([z.literal(0), z.literal(1)]);

const storedObjectRowSchema = z.object({
  id: brandIdSchema,
  ownerId: z.string().min(1),
  brandId: brandIdSchema.nullable(),
  class: objectClassSchema,
  visibility: objectVisibilitySchema,
  status: z.enum(OBJECT_STATUSES),
  bucket: z.string().min(3),
  objectKey: z.string().nullable(),
  contentType: z.string().min(3),
  byteSize: z.number().int().positive(),
  sha256: sha256Schema,
  fileName: z.string().nullable(),
  immutable: flagSchema,
  createdAt: timeSchema,
  readyAt: timeSchema.nullable(),
  deletedAt: timeSchema.nullable(),
}).refine((row) => {
  if (row.status === "tombstoned") return row.fileName === null && row.objectKey === null && row.deletedAt !== null;
  if (row.status === "ready") return row.fileName !== null && row.objectKey !== null && row.readyAt !== null && row.deletedAt === null;
  return row.fileName !== null && row.objectKey !== null && row.readyAt === null && row.deletedAt === null;
});

const listedObjectSchema = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema.nullable(),
  class: objectClassSchema,
  visibility: objectVisibilitySchema,
  status: z.enum(OBJECT_STATUSES),
  contentType: z.string().min(3),
  byteSize: z.number().int().positive(),
  sha256: sha256Schema,
  fileName: z.string().nullable(),
  immutable: flagSchema,
  createdAt: timeSchema,
  readyAt: timeSchema.nullable(),
  deletedAt: timeSchema.nullable(),
}).refine((row) => {
  if (row.status === "tombstoned") return row.fileName === null && row.deletedAt !== null;
  if (row.status === "ready") return row.fileName !== null && row.readyAt !== null && row.deletedAt === null;
  return row.fileName !== null && row.readyAt === null && row.deletedAt === null;
});

export type StoredObjectRow = z.infer<typeof storedObjectRowSchema>;
export type ListedStoredObject = z.infer<typeof listedObjectSchema>;

export type PendingObjectInsert = {
  id: string;
  ownerId: string;
  brandId: string | null;
  class: ObjectClass;
  visibility: "internal" | "public";
  bucket: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  fileName: string;
  immutable: 0 | 1;
  createdAt: string;
};

const rowColumns = `id, owner_id AS "ownerId", brand_id AS "brandId", "class", visibility, status,
  bucket, object_key AS "objectKey", content_type AS "contentType", byte_size AS "byteSize",
  sha256, file_name AS "fileName", immutable, created_at AS "createdAt", ready_at AS "readyAt",
  deleted_at AS "deletedAt"`;

const listColumns = `id, brand_id AS "brandId", "class", visibility, status, content_type AS "contentType",
  byte_size AS "byteSize", sha256, file_name AS "fileName", immutable, created_at AS "createdAt",
  ready_at AS "readyAt", deleted_at AS "deletedAt"`;

function brandScope(brandId: string | null) {
  return brandId === null
    ? { sql: "brand_id IS NULL", values: [] as QueryValue[] }
    : { sql: "brand_id = ?", values: [brandId] };
}

export async function ownedExportIsCurrent(db: QueryConnection, ownerId: string, objectId: string) {
  const rows = await queryWithParameters(
    db,
    "SELECT id FROM user_data_export WHERE owner_id = ? AND object_id = ?",
    [ownerId, objectId],
  );
  return rows.length === 1;
}

export async function loadObjectIdentity(db: QueryConnection, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT owner_id AS "ownerId", brand_id AS "brandId", status FROM stored_object WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return z.object({
    ownerId: z.string().min(1),
    brandId: z.string().nullable(),
    status: z.enum(["pending", "ready", "failed", "tombstoned"]),
  }).parse(row);
}

export async function loadOwnedObject(db: QueryConnection, ownerId: string, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT ${rowColumns} FROM stored_object WHERE id = ? AND owner_id = ?`,
    [id, ownerId],
  );
  return row ? storedObjectRowSchema.parse(row) : null;
}

export async function loadBrandObjectsByIds(db: QueryConnection, ownerId: string, brandId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await queryWithParameters(
    db,
    `SELECT ${rowColumns} FROM stored_object
     WHERE owner_id = ? AND brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    [ownerId, brandId, ...ids],
  );
  return z.array(storedObjectRowSchema).parse(rows);
}

const maxBrandBytes = 2_147_483_647;

function byteCount(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export async function setBrandStorageLimit(db: QueryConnection, brandId: string, byteLimit: number) {
  if (!brandIdSchema.safeParse(brandId).success) return false;
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || byteLimit > maxBrandBytes) return false;
  await queryWithParameters(
    db,
    `INSERT INTO brand_storage_limit (brand_id, byte_limit) VALUES (?, ?)
     ON CONFLICT (brand_id) DO UPDATE SET byte_limit = excluded.byte_limit`,
    [brandId, byteLimit],
  );
  return true;
}

// Pending and ready rows still occupy the brand. Failed and tombstoned rows do not.
// A brand with no ceiling row is not capped here. Equality with the ceiling is allowed.
export async function sourceOriginalWithinBrandLimit(db: QueryConnection, brandId: string, incomingBytes: number) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 1) return false;
  const lock = db.kind === "postgresql" ? " FOR UPDATE" : "";
  const [limit] = await queryWithParameters(
    db,
    `SELECT byte_limit AS "byteLimit" FROM brand_storage_limit WHERE brand_id = ?${lock}`,
    [brandId],
  );
  if (!limit) return true;
  const byteLimit = byteCount(limit.byteLimit);
  if (byteLimit === null) return false;
  const [sum] = await queryWithParameters(
    db,
    `SELECT coalesce(sum(byte_size), 0) AS used FROM stored_object
     WHERE brand_id = ? AND status IN ('pending', 'ready') AND deleted_at IS NULL`,
    [brandId],
  );
  const used = byteCount(sum?.used);
  if (used === null || used > byteLimit) return false;
  return incomingBytes <= byteLimit - used;
}

export async function insertPendingObject(db: QueryConnection, row: PendingObjectInsert) {
  await queryWithParameters(
    db,
    `INSERT INTO stored_object (
      id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
      byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      row.id, row.ownerId, row.brandId, row.class, row.visibility, row.bucket, row.objectKey,
      row.contentType, row.byteSize, row.sha256, row.fileName, row.immutable, row.createdAt,
    ],
  );
}

export async function claimMutableObject(db: QueryConnection, row: PendingObjectInsert) {
  const scope = brandScope(row.brandId);
  const updated = await queryWithParameters(
    db,
    `UPDATE stored_object
     SET status = 'pending', ready_at = NULL, bucket = ?, content_type = ?, byte_size = ?, sha256 = ?
     WHERE id = ? AND owner_id = ? AND ${scope.sql} AND "class" = ? AND immutable = 0
       AND status IN ('pending', 'ready', 'failed')
       AND object_key = ? AND file_name = ?
     RETURNING id`,
    [
      row.bucket, row.contentType, row.byteSize, row.sha256, row.id, row.ownerId, ...scope.values,
      row.class, row.objectKey, row.fileName,
    ],
  );
  return updated.length === 1;
}

export async function markObjectReady(db: QueryConnection, input: {
  id: string;
  ownerId: string;
  byteSize: number;
  sha256: string;
  readyAt: string;
}) {
  const updated = await queryWithParameters(
    db,
    `UPDATE stored_object
     SET status = 'ready', ready_at = ?, byte_size = ?, sha256 = ?
     WHERE id = ? AND owner_id = ? AND status = 'pending'
     RETURNING id`,
    [input.readyAt, input.byteSize, input.sha256, input.id, input.ownerId],
  );
  return updated.length === 1;
}

export async function markObjectFailed(db: QueryConnection, id: string, ownerId: string, from: "pending" | "ready") {
  const updated = await queryWithParameters(
    db,
    `UPDATE stored_object SET status = 'failed', ready_at = NULL
     WHERE id = ? AND owner_id = ? AND status = ?
     RETURNING id`,
    [id, ownerId, from],
  );
  return updated.length === 1;
}

export async function listFailedObjectKeys(db: QueryConnection, ownerId: string, brandId: string | null, limit: number) {
  const scope = brandScope(brandId);
  const rows = await queryWithParameters(
    db,
    `SELECT object_key AS "objectKey" FROM stored_object
     WHERE owner_id = ? AND ${scope.sql} AND status = 'failed' AND object_key IS NOT NULL
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [ownerId, ...scope.values, limit],
  );
  return z.array(z.object({ objectKey: z.string().min(1) })).parse(rows).map((row) => row.objectKey);
}

export async function listStoredObjectsForOwner(db: QueryConnection, input: {
  ownerId: string;
  brandId: string | null;
  class: ObjectClass;
  limit: number;
}) {
  if (!OBJECT_CLASSES.includes(input.class)) return [];
  const scope = brandScope(input.brandId);
  const rows = await queryWithParameters(
    db,
    `SELECT ${listColumns} FROM stored_object
     WHERE owner_id = ? AND ${scope.sql} AND "class" = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [input.ownerId, ...scope.values, input.class, input.limit],
  );
  return z.array(listedObjectSchema).parse(rows);
}

const purgeKeySchema = z.object({
  id: brandIdSchema,
  objectKey: z.string().min(1),
});

const purgedObjectAuditSchema = z.object({
  id: brandIdSchema,
  class: objectClassSchema,
  byteSize: z.number().int().positive(),
  sha256: sha256Schema,
  createdAt: timeSchema,
  deletedAt: timeSchema,
}).strict();

export type PurgedObjectAudit = z.infer<typeof purgedObjectAuditSchema>;

// Pending rows still store a file name and key. They are cleared with ready and
// failed rows so a purge cannot leave a customer file name behind.
const purgeableStatuses = "('pending', 'ready', 'failed')";

export async function listBrandObjectsToPurge(db: QueryConnection, ownerId: string, brandId: string) {
  const rows = await queryWithParameters(
    db,
    `SELECT id, object_key AS "objectKey" FROM stored_object
     WHERE owner_id = ? AND brand_id = ? AND status IN ${purgeableStatuses} AND object_key IS NOT NULL
     ORDER BY created_at ASC, id ASC`,
    [ownerId, brandId],
  );
  return z.array(purgeKeySchema).parse(rows);
}

export async function tombstoneBrandObjects(db: QueryConnection, input: {
  ownerId: string;
  brandId: string;
  ids: readonly string[];
  deletedAt: string;
}) {
  if (input.ids.length === 0) return 0;
  const updated = await queryWithParameters(
    db,
    `UPDATE stored_object
     SET status = 'tombstoned', file_name = NULL, object_key = NULL, deleted_at = ?
     WHERE owner_id = ? AND brand_id = ? AND status IN ${purgeableStatuses}
       AND id IN (${input.ids.map(() => "?").join(", ")})
     RETURNING id`,
    [input.deletedAt, input.ownerId, input.brandId, ...input.ids],
  );
  return updated.length;
}

export async function listPurgedObjectAudit(db: QueryConnection, ownerId: string, brandId: string) {
  const rows = await queryWithParameters(
    db,
    `SELECT id, "class", byte_size AS "byteSize", sha256,
       created_at AS "createdAt", deleted_at AS "deletedAt"
     FROM stored_object
     WHERE owner_id = ? AND brand_id = ? AND status = 'tombstoned'
     ORDER BY created_at ASC, id ASC
     LIMIT 500`,
    [ownerId, brandId],
  );
  return z.array(purgedObjectAuditSchema).parse(rows);
}
