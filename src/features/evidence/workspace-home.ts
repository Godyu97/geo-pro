import "server-only";

import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { EvidenceError } from "./contracts.ts";
import { readEvidenceOverview } from "./overview-commands.ts";
import type { OverviewPayload } from "./overview-cache.ts";

export const workspaceEntryHrefs = {
  brands: "/dashboard/brands",
  monitoring: "/dashboard/monitoring/overview",
  optimization: "/dashboard/optimization",
  content: "/dashboard/content",
  reports: "/dashboard/reports",
} as const;

export type WorkspaceHome =
  | { state: "no-brand" }
  | { state: "unavailable"; error: EvidenceError }
  | { state: "ready"; overview: OverviewPayload };

export async function readWorkspaceHome(
  db: DatabaseConnection,
  ownerId: string,
  cache: CacheStore = openCache(),
): Promise<WorkspaceHome> {
  const active = await new BrandDao(db).active(ownerId);
  if (!active) return { state: "no-brand" };

  const overview = await readEvidenceOverview(db, ownerId, {
    brandId: active.id,
    sourceMode: "model_api",
  }, cache);
  if ("error" in overview) return { state: "unavailable", error: overview.error };
  return { state: "ready", overview };
}
