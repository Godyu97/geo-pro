import "server-only";

import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { workspaceBrand } from "../team-access/brand-scope.ts";
import type { EvidenceError } from "./contracts.ts";
import { readEvidenceOverview } from "./overview-commands.ts";
import type { OverviewPayload } from "./overview-cache.ts";

export type WorkspaceHome =
  | { state: "no-brand" }
  | { state: "unavailable"; error: EvidenceError }
  | { state: "ready"; overview: OverviewPayload };

export async function readWorkspaceHome(
  db: DatabaseConnection,
  ownerId: string,
  cache: CacheStore = openCache(),
): Promise<WorkspaceHome> {
  const scope = await workspaceBrand(db, ownerId, undefined, "read");
  if (!scope) return { state: "no-brand" };

  const overview = await readEvidenceOverview(db, ownerId, {
    brandId: scope.brandId,
    sourceMode: "model_api",
  }, cache);
  if ("error" in overview) return { state: "unavailable", error: overview.error };
  return { state: "ready", overview };
}
