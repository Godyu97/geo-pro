import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { IMAGE_RIGHTS, imageAssetLimit, imageAssetUseLimit } from "./image-asset-contracts.ts";

const timeSchema = z.iso.datetime();
const versionSchema = z.number().int().min(1).max(2_147_483_647);

const assetRowSchema = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  version: versionSchema,
  rightsStatus: z.enum(IMAGE_RIGHTS),
  fileName: z.string().min(1).max(120),
  byteSize: z.number().int().min(0).max(2_147_483_647).nullable(),
  createdAt: timeSchema,
  updatedAt: timeSchema,
});

const linkRowSchema = z.object({
  id: brandIdSchema,
  assetId: brandIdSchema,
  contentVersionId: brandIdSchema,
  assetVersion: versionSchema,
  createdAt: timeSchema,
  todoId: brandIdSchema.nullable(),
  todoCreatedAt: timeSchema.nullable(),
});

export type ImageAssetRow = z.infer<typeof assetRowSchema>;
export type ImageAssetLinkRow = z.infer<typeof linkRowSchema>;

export type ImageAssetInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  version: number;
  fileName: string;
  byteSize: number | null;
  createdAt: string;
};

export type ImageAssetUseInsert = {
  id: string;
  assetId: string;
  brandId: string;
  contentVersionId: string;
  assetVersion: number;
  createdAt: string;
};

export type ImageAssetTodoInsert = {
  id: string;
  useId: string;
  assetId: string;
  brandId: string;
  contentVersionId: string;
  assetVersion: number;
  createdAt: string;
};

const assetColumns = `id, brand_id AS "brandId", version, rights_status AS "rightsStatus",
  file_name AS "fileName", byte_size AS "byteSize", created_at AS "createdAt", updated_at AS "updatedAt"`;

const linkColumns = `u.id AS "id", u.asset_id AS "assetId", u.content_version_id AS "contentVersionId",
  u.asset_version AS "assetVersion", u.created_at AS "createdAt",
  t.id AS "todoId", t.created_at AS "todoCreatedAt"`;

export function ownedImageAssetsQuery(ownerId: string, brandId: string, limit = imageAssetLimit) {
  return {
    sql: `SELECT ${assetColumns} FROM image_asset
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [ownerId, brandId, limit] as QueryValue[],
  };
}

export function imageAssetUsesQuery(assetId: string, limit = imageAssetUseLimit) {
  return {
    sql: `SELECT ${linkColumns}
      FROM image_asset_use u
      LEFT JOIN image_asset_todo t ON t.use_id = u.id
      WHERE u.asset_id = ?
      ORDER BY u.created_at, u.id
      LIMIT ?`,
    values: [assetId, limit] as QueryValue[],
  };
}

export async function insertImageAsset(db: QueryConnection, row: ImageAssetInsert) {
  const [inserted] = await queryWithParameters(
    db,
    `INSERT INTO image_asset (
      id, brand_id, owner_id, version, rights_status, file_name, byte_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
    RETURNING ${assetColumns}`,
    [row.id, row.brandId, row.ownerId, row.version, row.fileName, row.byteSize, row.createdAt, row.createdAt],
  );
  if (!inserted) throw new Error("image asset insert failed");
  return assetRowSchema.parse(inserted);
}

export async function loadOwnedImageAsset(db: QueryConnection, ownerId: string, brandId: string, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT ${assetColumns} FROM image_asset WHERE id = ? AND owner_id = ? AND brand_id = ?`,
    [id, ownerId, brandId],
  );
  return row ? assetRowSchema.parse(row) : null;
}

export async function listOwnedImageAssets(db: QueryConnection, ownerId: string, brandId: string) {
  const query = ownedImageAssetsQuery(ownerId, brandId);
  return z.array(assetRowSchema).parse(await queryWithParameters(db, query.sql, query.values));
}

export async function listImageAssetLinks(db: QueryConnection, assetIds: readonly string[]) {
  if (assetIds.length === 0) return [];
  const marks = assetIds.map(() => "?").join(", ");
  const rows = await queryWithParameters(
    db,
    `SELECT ${linkColumns}
      FROM image_asset_use u
      LEFT JOIN image_asset_todo t ON t.use_id = u.id
      WHERE u.asset_id IN (${marks})
      ORDER BY u.asset_id, u.created_at, u.id
      LIMIT ?`,
    [...assetIds, assetIds.length * imageAssetUseLimit],
  );
  return z.array(linkRowSchema).parse(rows);
}

export async function listImageAssetLinksForAsset(db: QueryConnection, assetId: string) {
  const query = imageAssetUsesQuery(assetId);
  return z.array(linkRowSchema).parse(await queryWithParameters(db, query.sql, query.values));
}

export async function findImageAssetUse(db: QueryConnection, assetId: string, contentVersionId: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT id, content_version_id AS "contentVersionId", asset_version AS "assetVersion", created_at AS "createdAt"
      FROM image_asset_use WHERE asset_id = ? AND content_version_id = ?`,
    [assetId, contentVersionId],
  );
  if (!row) return null;
  return z.object({
    id: brandIdSchema,
    contentVersionId: brandIdSchema,
    assetVersion: versionSchema,
    createdAt: timeSchema,
  }).parse(row);
}

export async function contentVersionOwnedBy(db: QueryConnection, ownerId: string, brandId: string, id: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT id FROM content_version WHERE id = ? AND brand_id = ? AND owner_id = ?`,
    [id, brandId, ownerId],
  );
  return Boolean(row);
}

export async function insertImageAssetUse(db: QueryConnection, row: ImageAssetUseInsert) {
  const [inserted] = await queryWithParameters(
    db,
    `INSERT INTO image_asset_use (id, asset_id, brand_id, content_version_id, asset_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id, content_version_id AS "contentVersionId", asset_version AS "assetVersion", created_at AS "createdAt"`,
    [row.id, row.assetId, row.brandId, row.contentVersionId, row.assetVersion, row.createdAt],
  );
  if (!inserted) throw new Error("image asset use insert failed");
  return z.object({
    id: brandIdSchema,
    contentVersionId: brandIdSchema,
    assetVersion: versionSchema,
    createdAt: timeSchema,
  }).parse(inserted);
}

export async function setImageAssetRights(
  db: QueryConnection,
  row: { id: string; ownerId: string; brandId: string; rightsStatus: "revoked" | "expired"; updatedAt: string },
) {
  const sql = row.rightsStatus === "revoked"
    ? `UPDATE image_asset SET rights_status = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND brand_id = ? AND rights_status IN ('active', 'expired', 'revoked')
      RETURNING ${assetColumns}`
    : `UPDATE image_asset SET rights_status = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND brand_id = ? AND rights_status IN ('active', 'expired')
      RETURNING ${assetColumns}`;
  const [updated] = await queryWithParameters(
    db,
    sql,
    [row.rightsStatus, row.updatedAt, row.id, row.ownerId, row.brandId],
  );
  return updated ? assetRowSchema.parse(updated) : null;
}

export async function insertImageAssetTodos(db: QueryConnection, rows: readonly ImageAssetTodoInsert[]) {
  if (rows.length === 0) return;
  const values = rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
  const parameters = rows.flatMap((row) => [
    row.id,
    row.useId,
    row.assetId,
    row.brandId,
    row.contentVersionId,
    row.assetVersion,
    row.createdAt,
  ]);
  await queryWithParameters(
    db,
    `INSERT INTO image_asset_todo (
      id, use_id, asset_id, brand_id, content_version_id, asset_version, created_at
    ) VALUES ${values}
    ON CONFLICT (use_id) DO NOTHING`,
    parameters,
  );
}
