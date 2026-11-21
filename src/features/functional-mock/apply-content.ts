import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { FactDao } from "../brand-facts/dao.ts";
import {
  approveContent,
  confirmBrief,
  exportConfirm,
  exportPreflight,
  generateBatch,
  saveBriefDraft,
  submitReview,
  updateVariant,
} from "../content/commands.ts";
import { ContentDao } from "../content/dao.ts";
import { functionalMockMarker } from "./mode.ts";

const cluster = "functional-mock";

function mockUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function failed(error: string) {
  return { ok: false as const, error };
}

/** Draft, review and export through the existing content commands. The body repeats the mock fact claim. */
export async function applyMockContent(db: DatabaseConnection, ownerId: string, brandId: string) {
  const facts = await new FactDao(db, { ownerId, brandId }).versions();
  const fact = facts.find((item) => item.state === "approved" && item.fields.title.includes(functionalMockMarker));
  if (!fact) return failed("fact-missing");

  const dao = new ContentDao(db);
  const plan = await dao.getPlanByCluster(ownerId, brandId, cluster);
  const briefs = await dao.listBriefs(ownerId, brandId, 20);
  let brief = briefs.find((item) => item.planId === plan?.id && item.status !== "invalidated");
  if (!brief) {
    const saved = await saveBriefDraft(db, ownerId, {
      action: "save-brief-draft",
      brandId,
      operationId: mockUuid(`functional-mock:brief:${brandId}`),
      questionCluster: cluster,
      fields: {
        audience: `${functionalMockMarker} 合成受众`,
        targetGap: `${functionalMockMarker} 合成缺口，不是真实诊断`,
        applicableBoundary: `${functionalMockMarker} 只适用于功能性 mock`,
        primaryPage: "https://functional-mock.example.com/faq",
        conversionAction: `${functionalMockMarker} 不发布`,
        templateKind: "fact_faq",
        titleCandidates: [`${functionalMockMarker} 合成草稿`],
        factVersionIds: [fact.id],
      },
    });
    if ("error" in saved) return failed(String(saved.error));
    brief = await dao.getBrief(ownerId, brandId, saved.briefId) ?? undefined;
  }
  if (!brief) return failed("brief-missing");
  if (brief.status !== "confirmed") {
    const confirmed = await confirmBrief(db, ownerId, {
      action: "confirm-brief",
      brandId,
      briefId: brief.id,
      operationId: mockUuid(`functional-mock:confirm:${brief.id}`),
    });
    if ("error" in confirmed) return failed(String(confirmed.error));
  }

  const versions = await dao.listContentVersionsForBrand(ownerId, brandId, 20);
  let version = versions.find((item) => item.bodyMarkdown.includes(functionalMockMarker) && item.status !== "invalidated" && item.status !== "rejected");
  if (!version) {
    const batch = await generateBatch(db, ownerId, {
      action: "generate-batch",
      brandId,
      operationId: mockUuid(`functional-mock:batch:${brief.id}`),
      briefIds: [brief.id],
    });
    if ("error" in batch) return failed(String(batch.error));
    const unit = batch.units.find((item) => item.contentVersionId);
    if (!unit?.contentVersionId) return failed("draft-missing");
    version = (await dao.listContentVersionsForBrand(ownerId, brandId, 20)).find((item) => item.id === unit.contentVersionId);
  }
  if (!version) return failed("draft-missing");

  if (version.status === "draft" && version.labelingProfileStatus !== "verified") {
    const labeled = await updateVariant(db, ownerId, {
      action: "update-variant",
      brandId,
      operationId: mockUuid(`functional-mock:label:${version.id}`),
      versionId: version.id,
      labelingProfileVersion: "functional-mock",
      labelingProfileStatus: "verified",
    });
    if ("error" in labeled) return failed(String(labeled.error));
  }
  if (version.status === "draft") {
    const review = await submitReview(db, ownerId, {
      action: "submit-review",
      brandId,
      operationId: mockUuid(`functional-mock:review:${version.id}`),
      versionId: version.id,
    });
    if ("error" in review) return failed(String(review.error));
    version = { ...version, status: "in_review" };
  }
  if (version.status === "in_review") {
    const approved = await approveContent(db, ownerId, {
      action: "approve-content",
      brandId,
      operationId: mockUuid(`functional-mock:approve:${version.id}`),
      versionId: version.id,
    });
    if ("error" in approved) return failed(String(approved.error));
  }

  const preflight = await exportPreflight(db, ownerId, {
    action: "export-preflight",
    brandId,
    operationId: mockUuid(`functional-mock:export:${version.id}`),
    versionIds: [version.id],
    mode: "auto",
  });
  if ("error" in preflight) return failed(String(preflight.error));
  const exported = await exportConfirm(db, ownerId, {
    action: "export-confirm",
    brandId,
    operationId: mockUuid(`functional-mock:export:${version.id}`),
    chosenVersionIds: [version.id],
  });
  if ("error" in exported) return failed(String(exported.error));
  return { ok: true as const, versionId: version.id };
}
