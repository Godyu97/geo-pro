import "server-only";

import { cache } from "react";
import { getConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { workspaceBrand } from "../team-access/brand-scope.ts";
import { brandDutyAllows } from "../team-access/rules.ts";

export const reportsPath = "/dashboard/reports";
export const observationsPath = `${reportsPath}/observations`;
export const interventionsPath = `${reportsPath}/interventions`;

export function retestHref(path: string, brandId?: string, error?: string) {
  const query = new URLSearchParams();
  if (brandId) query.set("brandId", brandId);
  if (error) query.set("error", error);
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const readRetestWorkspace = cache(async (
  actorId: string,
  brandParam: string | string[] | undefined,
) => {
  const parsed = brandIdSchema.optional().safeParse(brandParam);
  if (!parsed.success) return { kind: "notFound" } as const;
  const db = getConnection();
  const scope = await workspaceBrand(db, actorId, parsed.data, "read");
  if (!scope) return { kind: parsed.data === undefined ? "noBrand" : "notFound" } as const;

  const brand = await new BrandDao(db).ownedSummary(scope.ownerId, scope.brandId);
  if (!brand) return { kind: "notFound" } as const;
  return {
    kind: "ready",
    brand,
    canWrite: brand.status === "active" && brandDutyAllows(scope.role, "write"),
  } as const;
});

export async function retestBrandUnavailable(actorId: string, requestPath: string | null) {
  if (!requestPath) return false;
  const url = new URL(requestPath, "http://localhost");
  if (url.pathname !== observationsPath && url.pathname !== interventionsPath) return false;
  const brandIds = url.searchParams.getAll("brandId");
  if (brandIds.length === 0) return false;
  if (brandIds.length !== 1) return true;
  try {
    return (await readRetestWorkspace(actorId, brandIds[0])).kind === "notFound";
  } catch {
    // The page handles service failures and keeps a scoped reload link.
    return false;
  }
}
