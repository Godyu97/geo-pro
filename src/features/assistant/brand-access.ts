import "server-only";

import type { QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { authorizeBrandActor, workspaceBrand } from "../team-access/brand-scope.ts";
import { TeamAccessDao } from "../team-access/dao.ts";
import { authorizePlatformAdmin } from "../team-access/platform-role.ts";
import { brandDutyAllows } from "../team-access/rules.ts";

export type AssistantAccessError = "NOT_FOUND" | "FORBIDDEN";

export type AssistantReadAccess = {
  brandId: string;
  ownerId: string;
  canWrite: boolean;
};

export type AssistantWriteScope = {
  brandId: string;
  ownerId: string;
};

export type AssistantWorkspaceResolution =
  | { kind: "no-brand" }
  | { kind: "not-found" }
  | { kind: "ready"; brandId: string; ownerId: string; brandName: string; canWrite: boolean };

const assistantPaths = new Set([
  "/dashboard/assistant",
  "/dashboard/assistant/plans",
  "/dashboard/assistant/strategies",
]);

export async function assistantBrandUnavailable(
  db: QueryConnection,
  actorId: string,
  requestPath: string | null,
) {
  if (!requestPath) return false;
  const url = new URL(requestPath, "http://localhost");
  if (!assistantPaths.has(url.pathname)) return false;
  const brandIds = url.searchParams.getAll("brandId");
  if (brandIds.length === 0) return false;
  if (brandIds.length > 1) return true;
  const raw = brandIds[0]?.trim() ?? "";
  if (!raw) return false;
  if (!brandIdSchema.safeParse(raw).success) return true;
  try {
    return !(await readAssistantAccess(db, actorId, raw));
  } catch {
    return false;
  }
}

export async function readAssistantAccess(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  now = new Date().toISOString(),
): Promise<AssistantReadAccess | null> {
  if (!brandIdSchema.safeParse(brandId).success) return null;
  const scope = await authorizeBrandActor(db, actorId, brandId, "read", now);
  if (scope) {
    return {
      brandId: scope.brandId,
      ownerId: scope.ownerId,
      canWrite: brandDutyAllows(scope.role, "write"),
    };
  }
  if (await authorizePlatformAdmin(db, actorId)) {
    const brand = await new TeamAccessDao(db).brandActor(actorId, brandId);
    if (brand && !brand.frozenAt) {
      return {
        brandId,
        ownerId: brand.ownerId,
        canWrite: false,
      };
    }
  }
  return null;
}

export async function writeAssistantAccess(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  now = new Date().toISOString(),
): Promise<AssistantWriteScope | { error: AssistantAccessError }> {
  if (!brandIdSchema.safeParse(brandId).success) return { error: "NOT_FOUND" };
  const scope = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (scope) return { brandId: scope.brandId, ownerId: scope.ownerId };
  const read = await readAssistantAccess(db, actorId, brandId, now);
  if (!read) return { error: "NOT_FOUND" };
  const brand = await new BrandDao(db).owned(read.ownerId, brandId);
  return { error: brand?.status === "active" ? "FORBIDDEN" : "NOT_FOUND" };
}

export async function lockAssistantWrite(
  tx: TransactionConnection,
  actorId: string,
  brandId: string,
  now = new Date().toISOString(),
): Promise<AssistantWriteScope | { error: AssistantAccessError }> {
  const pre = await writeAssistantAccess(tx, actorId, brandId, now);
  if ("error" in pre) return pre;
  if (!await new BrandDao(tx).lockOwner(pre.ownerId)) return { error: "NOT_FOUND" };
  const current = await writeAssistantAccess(tx, actorId, brandId, now);
  if ("error" in current) return current;
  if (current.ownerId !== pre.ownerId) return { error: "NOT_FOUND" };
  return current;
}

export async function resolveAssistantWorkspaceBrand(
  db: QueryConnection,
  actorId: string,
  requestedBrandId?: string,
): Promise<AssistantWorkspaceResolution> {
  if (requestedBrandId !== undefined) {
    const access = await readAssistantAccess(db, actorId, requestedBrandId);
    if (!access) return { kind: "not-found" };
    const brand = await new BrandDao(db).ownedSummary(access.ownerId, access.brandId);
    if (!brand) return { kind: "not-found" };
    return {
      kind: "ready",
      brandId: access.brandId,
      ownerId: access.ownerId,
      brandName: brand.name,
      canWrite: access.canWrite && brand.status === "active",
    };
  }
  const scope = await workspaceBrand(db, actorId, undefined, "read");
  if (!scope) return { kind: "no-brand" };
  const brand = await new BrandDao(db).ownedSummary(scope.ownerId, scope.brandId);
  if (!brand) return { kind: "no-brand" };
  return {
    kind: "ready",
    brandId: scope.brandId,
    ownerId: scope.ownerId,
    brandName: brand.name,
    canWrite: brand.status === "active" && brandDutyAllows(scope.role, "write"),
  };
}
