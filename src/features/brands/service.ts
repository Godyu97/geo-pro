import "server-only";

import { randomUUID } from "node:crypto";
import { getConnection } from "@/lib/db/connection";
import { BrandDao } from "./dao";

export function brandUnavailable() {
  const traceId = randomUUID();
  console.error("brand-store-unavailable", { traceId });
  return { unavailable: true, traceId } as const;
}

export async function readBrandData<T>(read: (dao: BrandDao) => Promise<T>) {
  try {
    return { data: await read(new BrandDao(getConnection())) };
  } catch {
    return brandUnavailable();
  }
}

export async function readNewBrandWorkspace(ownerId: string) {
  return readBrandData(async (dao) => {
    const active = await dao.active(ownerId);
    if (active) return { active, draft: null, policy: null };
    return { active, draft: await dao.draft(ownerId, "new"), policy: await dao.currentRetentionPolicy() };
  });
}

export async function readDeletionPreview(ownerId: string, brandId: string) {
  return readBrandData((dao) => dao.deletionImpact(ownerId, brandId));
}

export async function readDeletionRecovery(ownerId: string, brandId: string) {
  return readBrandData((dao) => dao.deletionState(ownerId, brandId));
}
