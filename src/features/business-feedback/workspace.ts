import "server-only";

import { cache } from "react";
import { getConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { workspaceBrand } from "../team-access/brand-scope.ts";
import { brandDutyAllows } from "../team-access/rules.ts";
import { readFeedbackAccess } from "./brand-access.ts";

export const reportsPath = "/dashboard/reports";
export const leadsPath = `${reportsPath}/leads`;
export const qualityPath = `${reportsPath}/lead-quality`;
export const suggestionsPath = `${reportsPath}/lead-suggestions`;

export function feedbackHref(path: string, brandId: unknown) {
  const parsed = brandIdSchema.safeParse(brandId);
  return parsed.success ? `${path}?brandId=${encodeURIComponent(parsed.data)}` : path;
}

export const readFeedbackWorkspace = cache(async (
  actorId: string,
  requested: string | string[] | undefined,
) => {
  const parsed = brandIdSchema.optional().safeParse(requested);
  if (!parsed.success) return { kind: "notFound" } as const;
  const db = getConnection();
  const brands = new BrandDao(db);
  const scope = parsed.data === undefined ? await workspaceBrand(db, actorId, undefined, "read") : null;
  const brandId = parsed.data ?? scope?.brandId;
  const access = brandId ? scope ?? await readFeedbackAccess(db, actorId, brandId) : null;
  const brand = access && brandId ? await brands.ownedSummary(access.ownerId, brandId) : null;
  if (!brand || !access) return { kind: parsed.data === undefined ? "noBrand" : "notFound" } as const;
  return {
    kind: "ready",
    brand,
    ownerId: access.ownerId,
    canWrite: brand.status === "active" && access.role !== null && brandDutyAllows(access.role, "write"),
  } as const;
});

export async function feedbackBrandUnavailable(actorId: string, requestPath: string | null) {
  if (!requestPath) return false;
  const url = new URL(requestPath, "http://localhost");
  if (![leadsPath, qualityPath, suggestionsPath].includes(url.pathname)) return false;
  const ids = url.searchParams.getAll("brandId");
  if (ids.length === 0) return false;
  if (ids.length !== 1) return true;
  try {
    return (await readFeedbackWorkspace(actorId, ids[0])).kind === "notFound";
  } catch {
    return false;
  }
}
