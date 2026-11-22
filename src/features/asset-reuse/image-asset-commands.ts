import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { brandOwnedBy } from "./dao.ts";
import type {
  ImageAssetDetail,
  ImageAssetExpiry,
  ImageAssetList,
  ImageAssetRead,
  ImageAssetRegistration,
  ImageAssetRevocation,
  ImageAssetTodoView,
  ImageAssetUseRegistration,
  ImageAssetUseView,
  ImageAssetView,
  ReadImageAssetInput,
  RegisterImageAssetInput,
  RegisterImageAssetUseInput,
} from "./image-asset-contracts.ts";
import {
  contentVersionOwnedBy,
  findImageAssetUse,
  insertImageAsset,
  insertImageAssetTodos,
  insertImageAssetUse,
  listImageAssetLinks,
  listImageAssetLinksForAsset,
  listOwnedImageAssets,
  loadOwnedImageAsset,
  setImageAssetRights,
  type ImageAssetLinkRow as DaoLink,
  type ImageAssetRow,
} from "./image-asset-dao.ts";
import { revokeAsset } from "./rules.ts";

function clock() {
  return new Date().toISOString();
}

function toAsset(row: ImageAssetRow): ImageAssetView {
  return {
    id: row.id,
    fileName: row.fileName,
    version: row.version,
    rightsStatus: row.rightsStatus,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  };
}

function toUse(row: Pick<DaoLink, "id" | "contentVersionId" | "assetVersion" | "createdAt">): ImageAssetUseView {
  return {
    id: row.id,
    contentVersionId: row.contentVersionId,
    assetVersion: row.assetVersion,
    createdAt: row.createdAt,
  };
}

function toTodo(row: DaoLink): ImageAssetTodoView | null {
  if (!row.todoId || !row.todoCreatedAt) return null;
  return {
    id: row.todoId,
    useId: row.id,
    contentVersionId: row.contentVersionId,
    assetVersion: row.assetVersion,
    createdAt: row.todoCreatedAt,
  };
}

function detail(asset: ImageAssetRow, links: readonly DaoLink[]): ImageAssetDetail {
  const todos = links.flatMap((link) => {
    const todo = toTodo(link);
    return todo ? [todo] : [];
  });
  return { asset: toAsset(asset), uses: links.map(toUse), todos };
}

function groupLinks(links: readonly DaoLink[]) {
  const grouped = new Map<string, DaoLink[]>();
  for (const link of links) {
    const current = grouped.get(link.assetId) ?? [];
    current.push(link);
    grouped.set(link.assetId, current);
  }
  return grouped;
}

async function ownedBrand(db: QueryConnection, actorId: string, brandId: string) {
  const brand = await brandOwnedBy(db, actorId, brandId);
  if (!brand || brand.status !== "active" || brand.frozenAt !== null) return null;
  return brand;
}

export async function listImageAssets(db: QueryConnection, actorId: string, brandId: string): Promise<ImageAssetList> {
  if (!await ownedBrand(db, actorId, brandId)) return { error: "NOT_FOUND" };
  const assets = await listOwnedImageAssets(db, actorId, brandId);
  const links = await listImageAssetLinks(db, assets.map((asset) => asset.id));
  const grouped = groupLinks(links);
  return { assets: assets.map((asset) => detail(asset, grouped.get(asset.id) ?? [])) };
}

export async function readImageAsset(db: QueryConnection, actorId: string, input: ReadImageAssetInput): Promise<ImageAssetRead> {
  if (!await ownedBrand(db, actorId, input.brandId)) return { error: "NOT_FOUND" };
  const asset = await loadOwnedImageAsset(db, actorId, input.brandId, input.id);
  if (!asset) return { error: "NOT_FOUND" };
  const links = await listImageAssetLinksForAsset(db, asset.id);
  return detail(asset, links);
}

export async function registerImageAsset(
  db: DatabaseConnection,
  actorId: string,
  input: RegisterImageAssetInput,
  now = clock(),
): Promise<ImageAssetRegistration> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const inserted = await insertImageAsset(tx, {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId: actorId,
      version: input.version ?? 1,
      fileName: input.fileName,
      byteSize: input.byteSize ?? null,
      createdAt: now,
    });
    return { asset: toAsset(inserted) };
  });
}

export async function registerImageAssetUse(
  db: DatabaseConnection,
  actorId: string,
  input: RegisterImageAssetUseInput,
  now = clock(),
): Promise<ImageAssetUseRegistration> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const asset = await loadOwnedImageAsset(tx, actorId, input.brandId, input.id);
    if (!asset) return { error: "NOT_FOUND" };
    if (asset.rightsStatus !== "active") return { error: "RIGHTS_CLOSED" };
    if (!await contentVersionOwnedBy(tx, actorId, input.brandId, input.contentVersionId)) return { error: "NOT_FOUND" };
    const existing = await findImageAssetUse(tx, asset.id, input.contentVersionId);
    if (existing) return { use: existing };
    const inserted = await insertImageAssetUse(tx, {
      id: randomUUID(),
      assetId: asset.id,
      brandId: input.brandId,
      contentVersionId: input.contentVersionId,
      assetVersion: asset.version,
      createdAt: now,
    });
    return { use: inserted };
  });
}

export async function revokeImageAsset(
  db: DatabaseConnection,
  actorId: string,
  input: ReadImageAssetInput,
  now = clock(),
): Promise<ImageAssetRevocation> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const asset = await loadOwnedImageAsset(tx, actorId, input.brandId, input.id);
    if (!asset) return { error: "NOT_FOUND" };
    const links = await listImageAssetLinksForAsset(tx, asset.id);
    const decision = revokeAsset({
      assetId: asset.id,
      references: links.map((link) => ({ contentId: link.contentVersionId, assetVersion: link.assetVersion })),
    });
    const updated = await setImageAssetRights(tx, {
      id: asset.id,
      ownerId: actorId,
      brandId: input.brandId,
      rightsStatus: decision.status,
      updatedAt: now,
    });
    if (!updated) return { error: "NOT_FOUND" };
    const pending = new Map(decision.todos.map((todo) => [`${todo.contentId}:${todo.assetVersion}`, todo]));
    await insertImageAssetTodos(tx, links.flatMap((link) => {
      if (link.todoId || !pending.has(`${link.contentVersionId}:${link.assetVersion}`)) return [];
      return [{
        id: randomUUID(),
        useId: link.id,
        assetId: asset.id,
        brandId: input.brandId,
        contentVersionId: link.contentVersionId,
        assetVersion: link.assetVersion,
        createdAt: now,
      }];
    }));
    const after = await listImageAssetLinksForAsset(tx, asset.id);
    return detail(updated, after);
  });
}

export async function expireImageAsset(
  db: DatabaseConnection,
  actorId: string,
  input: ReadImageAssetInput,
  now = clock(),
): Promise<ImageAssetExpiry> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const asset = await loadOwnedImageAsset(tx, actorId, input.brandId, input.id);
    if (!asset) return { error: "NOT_FOUND" };
    const updated = await setImageAssetRights(tx, {
      id: asset.id,
      ownerId: actorId,
      brandId: input.brandId,
      rightsStatus: "expired",
      updatedAt: now,
    });
    const current = updated ?? asset;
    const links = await listImageAssetLinksForAsset(tx, current.id);
    return detail(current, links);
  });
}
