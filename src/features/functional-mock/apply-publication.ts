import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { submitPublication } from "../content/commands.ts";
import { ContentDao } from "../content/dao.ts";
import { functionalMockMarker } from "./mode.ts";

function mockUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function failed(error: string) {
  return { ok: false as const, error };
}

/** Records a self-publish check against an in-memory fixture page. No site is fetched. */
export async function applyMockPublication(db: DatabaseConnection, ownerId: string, brandId: string) {
  const dao = new ContentDao(db);
  const versions = await dao.listContentVersionsForBrand(ownerId, brandId, 20);
  const version = versions.find((item) => item.status === "approved" && item.bodyMarkdown.includes(functionalMockMarker));
  if (!version) return failed("draft-missing");
  const claims = Object.keys(JSON.parse(version.claimsJson) as Record<string, string>);
  const saved = await submitPublication(db, ownerId, {
    action: "submit-publication",
    brandId,
    operationId: mockUuid(`functional-mock:publication:${version.id}`),
    versionId: version.id,
    targetAccount: "functional-mock",
    pageUrl: "https://functional-mock.example.com/published",
    publisherId: "functional-mock-publisher",
    claimedPublishedAt: "2026-11-21T00:00:00.000Z",
    channelDeclaration: `${functionalMockMarker} 合成获准站点，不是真实发布`,
    fixturePage: {
      accessClass: "public",
      httpStatus: 200,
      title: `${functionalMockMarker} 合成公开页`,
      bodyText: [functionalMockMarker, ...claims].join("\n"),
      pageMarker: functionalMockMarker,
    },
  });
  if ("error" in saved) return failed(String(saved.error));
  return { ok: true as const, status: saved.status, mock: true as const };
}
