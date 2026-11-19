import "server-only";

import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { maintenanceUnavailable, runMaintenanceAction } from "../maintenance/core.ts";
import type { MaintenanceResult } from "../maintenance/core.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";
import { supportViewSchema, type SupportCacheState, type SupportView } from "./contracts.ts";
import { SupportDao } from "./dao.ts";

const cacheTtlSeconds = 30;
export type SupportLookup = MaintenanceResult<SupportView> & { cache?: SupportCacheState };

function cacheKey(operationId: string) {
  return `support:v1:${operationId}`;
}

async function attachCache(cache: CacheStore, operationId: string, view: SupportView): Promise<SupportCacheState> {
  const canonical = JSON.stringify(supportViewSchema.parse(view));
  let cached: Awaited<ReturnType<CacheStore["get"]>>;
  try {
    cached = await cache.get(cacheKey(operationId));
  } catch {
    return "blocked";
  }
  if (cached.state === "blocked") return "blocked";
  if (cached.state === "hit") {
    try {
      const parsed = supportViewSchema.safeParse(JSON.parse(cached.value));
      if (parsed.success && JSON.stringify(parsed.data) === canonical) return "hit";
    } catch {
      // A corrupt or non-metadata copy is discarded below.
    }
    try {
      await cache.delete(cacheKey(operationId));
    } catch {
      return "blocked";
    }
  }
  try {
    const stored = await cache.set(cacheKey(operationId), canonical, cacheTtlSeconds);
    return stored === "stored" ? "origin" : "blocked";
  } catch {
    return "blocked";
  }
}

export async function readSupportCase(
  connection: DatabaseConnection,
  actorId: string | null,
  rawId: string | null,
  cache: CacheStore = openCache(),
  invalidInput = false,
  now = () => new Date().toISOString(),
): Promise<SupportLookup> {
  const parsed = opaqueIdSchema.safeParse(rawId);
  const invalid = invalidInput || !parsed.success;
  const operationId = parsed.success && !invalid ? parsed.data : null;
  const result = await runMaintenanceAction(connection, actorId, "support.read", async (transaction) => {
    const matches = await new SupportDao(transaction).locate(operationId ?? "", now());
    return supportViewSchema.parse({ matches });
  }, operationId, invalid);
  if (result.status !== "allowed" || !operationId) return result;
  return { ...result, cache: await attachCache(cache, operationId, result.data) };
}

export function supportUnavailable(connection: DatabaseConnection | undefined) {
  return maintenanceUnavailable(connection);
}
