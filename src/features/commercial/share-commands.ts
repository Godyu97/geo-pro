import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import { whitelabelReport } from "./billing.ts";
import type { RegisterShareInput, ShareRead, ShareView, ShareWorkspace } from "./share-contracts.ts";
import { ShareDao } from "./share-dao.ts";

function clock() {
  return new Date().toISOString();
}

export async function loadShareWorkspace(db: QueryConnection, ownerId: string): Promise<ShareWorkspace> {
  const dao = new ShareDao(db);
  const shares = await dao.sharesForOwner(ownerId);
  const brands = await dao.ownedBrands(ownerId);
  return { shares, brands };
}

export async function registerWhitelabelShare(
  db: QueryConnection,
  actorId: string,
  input: RegisterShareInput,
  now = clock(),
): Promise<{ error: "INVALID_INPUT" | "NOT_FOUND" } | { share: ShareRead }> {
  if (input.expiresAt <= now) return { error: "INVALID_INPUT" };
  const report = whitelabelReport({ track: input.track, sampleSize: input.sampleSize, grade: input.grade });
  const id = randomUUID();
  const inserted = await new ShareDao(db).insertForOwner({
    id,
    brandId: input.brandId,
    ownerId: actorId,
    track: report.track,
    sampleSize: report.sampleSize,
    grade: report.grade,
    expiresAt: input.expiresAt,
    createdAt: now,
  });
  if (!inserted) return { error: "NOT_FOUND" };
  return {
    share: {
      id,
      brandId: input.brandId,
      track: report.track,
      sampleSize: report.sampleSize,
      grade: report.grade,
      expiresAt: input.expiresAt,
      revoked: 0,
      createdAt: now,
    },
  };
}

export async function viewWhitelabelShare(
  db: QueryConnection,
  actorId: string,
  shareId: string,
  now = clock(),
): Promise<{ error: "NOT_FOUND" } | { share: ShareRead }> {
  const dao = new ShareDao(db);
  const share = await dao.shareForOwner(shareId, actorId);
  if (!share || share.revoked === 1 || share.expiresAt <= now) return { error: "NOT_FOUND" };
  const recorded = await dao.insertAccess({ id: randomUUID(), shareId, ownerId: actorId, accessedAt: now });
  if (!recorded) return { error: "NOT_FOUND" };
  return {
    share: {
      id: share.id,
      brandId: share.brandId,
      track: share.track,
      sampleSize: share.sampleSize,
      grade: share.grade,
      expiresAt: share.expiresAt,
      revoked: 0,
      createdAt: share.createdAt,
    },
  };
}

export async function revokeWhitelabelShare(
  db: QueryConnection,
  actorId: string,
  shareId: string,
): Promise<{ error: "NOT_FOUND" } | { share: { id: string; revoked: 1 } }> {
  const revoked = await new ShareDao(db).revokeForOwner(shareId, actorId);
  if (!revoked) return { error: "NOT_FOUND" };
  return { share: { id: shareId, revoked: 1 } };
}

export async function sharesOwnedBy(db: QueryConnection, ownerId: string): Promise<ShareView[]> {
  return new ShareDao(db).sharesForOwner(ownerId);
}
