import "server-only";

import { cache } from "react";
import { getConnection, type QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";

export const readEntityBrandScope = cache((db: QueryConnection, actorId: string, brandId: string) =>
  authorizeBrandActor(db, actorId, brandId, "read"),
);

export async function entityBrandUnavailable(actorId: string, requestPath: string | null) {
  const path = requestPath?.split("?", 1)[0];
  const match = path?.match(/^\/dashboard\/brands\/([^/]+)\/entity-(?:reviews|corrections)\/?$/);
  if (!match) return false;
  const brandId = brandIdSchema.safeParse(match[1]);
  if (!brandId.success) return true;
  try {
    return !(await readEntityBrandScope(getConnection(), actorId, brandId.data));
  } catch {
    // The workspace page shows the service error and scoped reload link.
    return false;
  }
}

export async function authorizeEntityWrite(db: QueryConnection, actorId: string, brandId: string, now?: string) {
  const scope = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (scope) return scope;
  const readable = await authorizeBrandActor(db, actorId, brandId, "read", now);
  return { error: readable ? "FORBIDDEN" as const : "NOT_FOUND" as const };
}
