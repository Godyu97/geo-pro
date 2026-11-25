import "server-only";

import type { QueryConnection } from "../../lib/db/connection.ts";
import { TeamAccessDao } from "./dao.ts";
import { brandDutyAllows, type BrandAccessAction } from "./rules.ts";
import type { TeamRole } from "./contracts.ts";

export type BrandScope = {
  ownerId: string;
  brandId: string;
  role: TeamRole;
};

function expired(expiresAt: string | null, now: string) {
  return expiresAt !== null && expiresAt <= now;
}

export async function authorizeBrandActor(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  action: BrandAccessAction,
  now = new Date().toISOString(),
): Promise<BrandScope | null> {
  const row = await new TeamAccessDao(db).brandActor(actorId, brandId);
  if (!row || row.frozenAt) return null;
  const grantOpen = row.role !== null && row.active === 1 && !expired(row.expiresAt, now);
  let role: TeamRole | null = null;
  if (grantOpen && row.role) role = row.role;
  else if (row.ownerId === actorId && row.hasGrant !== 1) role = "owner";
  if (!role || !brandDutyAllows(role, action)) return null;
  if (action !== "read" && row.status !== "active") return null;
  if (role !== "owner" && row.status !== "active") return null;
  return { ownerId: row.ownerId, brandId, role };
}

export async function workspaceBrand(
  db: QueryConnection,
  actorId: string,
  requested: string | undefined,
  action: BrandAccessAction,
  now = new Date().toISOString(),
): Promise<BrandScope | null> {
  if (requested !== undefined && requested.trim() !== "") {
    return authorizeBrandActor(db, actorId, requested.trim(), action, now);
  }
  const rows = await new TeamAccessDao(db).accessibleBrands(actorId, now);
  const allowed = rows.filter((row) => brandDutyAllows(row.role, action));
  const own = allowed.find((row) => row.ownerId === actorId && row.role === "owner");
  const chosen = own ?? allowed[0];
  return chosen ? { ownerId: chosen.ownerId, brandId: chosen.brandId, role: chosen.role } : null;
}
