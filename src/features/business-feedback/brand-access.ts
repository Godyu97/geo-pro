import "server-only";

import type { QueryConnection } from "../../lib/db/connection.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { TeamAccessDao } from "../team-access/dao.ts";
import { authorizePlatformAdmin } from "../team-access/platform-role.ts";

export async function readFeedbackAccess(db: QueryConnection, actorId: string, brandId: string) {
  const scope = await authorizeBrandActor(db, actorId, brandId, "read");
  if (scope) return { ownerId: scope.ownerId, role: scope.role };
  if (await authorizePlatformAdmin(db, actorId)) {
    const brand = await new TeamAccessDao(db).brandActor(actorId, brandId);
    if (brand && !brand.frozenAt) return { ownerId: brand.ownerId, role: null };
  }
  return null;
}

export async function writeFeedbackAccess(db: QueryConnection, actorId: string, brandId: string) {
  const now = new Date().toISOString();
  const scope = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (scope) return scope;
  return { error: (await readFeedbackAccess(db, actorId, brandId)) ? "FORBIDDEN" : "NOT_FOUND" } as const;
}
