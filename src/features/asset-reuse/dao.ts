import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
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

export async function sourceOriginalMayDownload(db: QueryConnection, ownerId: string, objectId: string) {
  const rows = await queryWithParameters(
    db,
    `SELECT id FROM source_original
     WHERE owner_id = ? AND stored_object_id = ? AND rights_status = 'active'`,
    [ownerId, objectId],
  );
  return rows.length === 1;
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
