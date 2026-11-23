import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import type {
  EntitlementView,
  EntitlementWorkspace,
  RecordUsageInput,
  RegisterEntitlementInput,
  ReviseEntitlementInput,
  UsageView,
} from "./entitlement-contracts.ts";
import { EntitlementDao } from "./entitlement-dao.ts";

function clock() {
  return new Date().toISOString();
}

export async function listServiceEntitlements(db: QueryConnection, ownerId: string) {
  const entitlements = await new EntitlementDao(db).entitlementsForOwner(ownerId);
  return { entitlements };
}

export async function loadEntitlementWorkspace(db: QueryConnection, ownerId: string): Promise<EntitlementWorkspace> {
  const dao = new EntitlementDao(db);
  const entitlements = await dao.entitlementsForOwner(ownerId);
  const brands = await dao.ownedBrands(ownerId);
  return { entitlements, brands };
}

export async function readServiceEntitlement(db: QueryConnection, ownerId: string, entitlementId: string): Promise<
  { error: "NOT_FOUND" } | { entitlement: EntitlementView }
> {
  const entitlement = await new EntitlementDao(db).entitlementForOwner(entitlementId, ownerId);
  if (!entitlement) return { error: "NOT_FOUND" };
  return { entitlement };
}

export async function registerServiceEntitlement(
  db: QueryConnection,
  actorId: string,
  input: RegisterEntitlementInput,
  now = clock(),
): Promise<{ error: "NOT_FOUND" | "CONFLICT" } | { entitlement: EntitlementView }> {
  const id = randomUUID();
  const saved = await new EntitlementDao(db).insertRegistered({
    id,
    brandId: input.brandId,
    ownerId: actorId,
    kind: input.kind,
    monitoringQuota: input.monitoringQuota,
    contentQuota: input.contentQuota,
    laborQuota: input.laborQuota,
    createdAt: now,
  });
  if (saved === "CONFLICT") return { error: "CONFLICT" };
  if (!saved) return { error: "NOT_FOUND" };
  return { entitlement: saved };
}

export async function reviseServiceEntitlement(
  db: QueryConnection,
  actorId: string,
  entitlementId: string,
  input: ReviseEntitlementInput,
  now = clock(),
): Promise<{ error: "NOT_FOUND" | "CONFLICT" } | { entitlement: EntitlementView }> {
  const id = randomUUID();
  const saved = await new EntitlementDao(db).insertRevision({
    id,
    sourceId: entitlementId,
    ownerId: actorId,
    kind: input.kind,
    monitoringQuota: input.monitoringQuota,
    contentQuota: input.contentQuota,
    laborQuota: input.laborQuota,
    createdAt: now,
  });
  if (saved === "CONFLICT") return { error: "CONFLICT" };
  if (!saved) return { error: "NOT_FOUND" };
  return { entitlement: saved };
}

export async function recordEntitlementUsage(
  db: QueryConnection,
  actorId: string,
  entitlementId: string,
  input: RecordUsageInput,
  now = clock(),
): Promise<{ error: "NOT_FOUND" } | { usage: UsageView }> {
  const saved = await new EntitlementDao(db).insertUsage({
    id: randomUUID(),
    entitlementId,
    ownerId: actorId,
    kind: input.kind,
    quantity: input.quantity,
    createdAt: now,
  });
  if (!saved) return { error: "NOT_FOUND" };
  return { usage: saved };
}
