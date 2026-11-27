import "server-only";

import type { QueryConnection } from "../../lib/db/connection.ts";
import { authorizeBrandActor, type BrandScope } from "../team-access/brand-scope.ts";

export type RetestResourceRef = string | { id: string; brandId: string };

export async function authorizeRetestWrite(
  db: QueryConnection,
  actorId: string,
  brandId: string,
): Promise<BrandScope | { error: "NOT_FOUND" | "FORBIDDEN" }> {
  const now = new Date().toISOString();
  const access = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (access) return access;
  const read = await authorizeBrandActor(db, actorId, brandId, "read", now);
  return { error: read ? "FORBIDDEN" : "NOT_FOUND" };
}
