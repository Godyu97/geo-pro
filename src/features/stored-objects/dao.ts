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
