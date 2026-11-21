"use server";

import { randomUUID } from "node:crypto";
import { MAX_STORED_OBJECT_BYTES } from "../stored-objects/contracts.ts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import {
  approveContent,
  cancelBatch,
  confirmBrief,
  exportConfirm,
  exportPreflight,
  generateBatch,
  pauseBatch,
  registerAsset,
  rejectContent,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
  submitManualEvidence,
  submitPublication,
  submitReview,
  updateVariant,
  verifyPublication,
} from "./commands";
import {
  approveContentSchema,
  batchControlSchema,
  confirmBriefSchema,
  exportConfirmSchema,
  exportPreflightSchema,
  generateBatchSchema,
  registerAssetSchema,
  rejectContentSchema,
  saveBriefDraftSchema,
  submitManualEvidenceSchema,
  submitPublicationSchema,
  submitReviewSchema,
  templateKindSchema,
  updateVariantSchema,
  verifyPublicationSchema,
} from "./contracts";

export async function saveBriefAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const titleCandidates = String(formData.get("titleCandidates") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const factVersionIds = String(formData.get("factVersionIds") ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const templateKind = templateKindSchema.catch("fact_faq").parse(String(formData.get("templateKind") ?? "fact_faq"));
  const parsed = saveBriefDraftSchema.safeParse({
    action: "save-brief-draft",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    briefId: String(formData.get("briefId") ?? "") || undefined,
    questionCluster: String(formData.get("questionCluster") ?? "") || undefined,
    fields: {
      audience: String(formData.get("audience") ?? ""),
      targetGap: String(formData.get("targetGap") ?? ""),
      applicableBoundary: String(formData.get("applicableBoundary") ?? ""),
      primaryPage: String(formData.get("primaryPage") ?? ""),
      conversionAction: String(formData.get("conversionAction") ?? ""),
      templateKind,
      titleCandidates,
      factVersionIds,
      competitorSource: String(formData.get("competitorSource") ?? "") || null,
    },
  });
  if (!parsed.success) return;
  const result = await saveBriefDraft(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  if (!("error" in result)) revalidatePath(`/dashboard/content/briefs/${result.briefId}`);
}

export async function confirmBriefAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = confirmBriefSchema.safeParse({
    action: "confirm-brief",
    brandId: String(formData.get("brandId") ?? ""),
    briefId: String(formData.get("briefId") ?? ""),
    operationId: randomUUID(),
  });
  if (!parsed.success) return;
  await confirmBrief(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  revalidatePath(`/dashboard/content/briefs/${parsed.data.briefId}`);
}

export async function generateBatchAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const briefIds = String(formData.get("briefIds") ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const failBriefIds = process.env.GEO_BRANDS_FIXTURE === "1"
    ? String(formData.get("failBriefIds") ?? "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 5)
    : [];
  const parsed = generateBatchSchema.safeParse({
    action: "generate-batch",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    briefIds,
    ...(failBriefIds.length ? { fixtures: { failBriefIds } } : {}),
  });
  if (!parsed.success) return;
  const result = await generateBatch(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  if (!("error" in result) && result.batch) {
    revalidatePath(`/dashboard/content/batches/${result.batch.id}`);
    redirect(`/dashboard/content/batches/${result.batch.id}`);
  }
}

export async function batchControlAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const action = String(formData.get("action") ?? "");
  const parsed = batchControlSchema.safeParse({
    action,
    brandId: String(formData.get("brandId") ?? ""),
    batchId: String(formData.get("batchId") ?? ""),
    operationId: randomUUID(),
  });
  if (!parsed.success) return;
  const db = getConnection();
  if (parsed.data.action === "pause-batch") await pauseBatch(db, session.user.id, parsed.data);
  else if (parsed.data.action === "resume-batch") await resumeBatch(db, session.user.id, parsed.data);
  else if (parsed.data.action === "cancel-batch") await cancelBatch(db, session.user.id, parsed.data);
  else await retryFailed(db, session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  revalidatePath(`/dashboard/content/batches/${parsed.data.batchId}`);
}

function splitIds(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function versionPath(versionId: string) {
  return `/dashboard/content/versions/${versionId}`;
}

export async function reviewVersionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const base = {
    action: String(formData.get("action") ?? ""),
    brandId: String(formData.get("brandId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
    operationId: randomUUID(),
  };
  const db = getConnection();
  if (base.action === "submit-review") {
    const parsed = submitReviewSchema.safeParse(base);
    if (parsed.success) await submitReview(db, session.user.id, parsed.data);
  } else if (base.action === "approve-content") {
    const parsed = approveContentSchema.safeParse(base);
    if (parsed.success) await approveContent(db, session.user.id, parsed.data);
  } else if (base.action === "reject-content") {
    const parsed = rejectContentSchema.safeParse(base);
    if (parsed.success) await rejectContent(db, session.user.id, parsed.data);
  }
  revalidatePath("/dashboard/content");
  revalidatePath(versionPath(base.versionId));
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = updateVariantSchema.safeParse({
    action: "update-variant",
    brandId: String(formData.get("brandId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
    operationId: randomUUID(),
    title: String(formData.get("title") ?? ""),
    bodyMarkdown: String(formData.get("bodyMarkdown") ?? ""),
    imageAssetIds: splitIds(formData.get("imageAssetIds")),
    targetChannel: String(formData.get("targetChannel") ?? ""),
    labelingProfileVersion: String(formData.get("labelingProfileVersion") ?? ""),
    labelingProfileStatus: String(formData.get("labelingProfileStatus") ?? ""),
  });
  if (!parsed.success) return;
  await updateVariant(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  revalidatePath(versionPath(parsed.data.versionId));
}

export async function registerAssetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const parsed = registerAssetSchema.safeParse({
    action: "register-asset",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    kind: String(formData.get("kind") ?? ""),
    source: String(formData.get("source") ?? ""),
    rightsStatement: String(formData.get("rightsStatement") ?? ""),
    visibility: String(formData.get("visibility") ?? ""),
    reviewStatus: String(formData.get("reviewStatus") ?? "pending"),
    contentRef: String(formData.get("contentRef") ?? ""),
  });
  if (!parsed.success) {
    if (versionId) redirect(`${versionPath(versionId)}?assetError=INVALID_INPUT`);
    return;
  }
  const uploaded = formData.get("file");
  if (uploaded instanceof File && uploaded.size > MAX_STORED_OBJECT_BYTES) {
    if (versionId) redirect(`${versionPath(versionId)}?assetError=ASSET_TOO_LARGE`);
    return;
  }
  const file = uploaded instanceof File && uploaded.size > 0
    ? {
      fileName: uploaded.name,
      contentType: uploaded.type,
      body: new Uint8Array(await uploaded.arrayBuffer()),
    }
    : undefined;
  const result = await registerAsset(getConnection(), session.user.id, parsed.data, undefined, file ? { file } : {});
  if ("error" in result) {
    if (versionId) redirect(`${versionPath(versionId)}?assetError=${result.error}`);
    return;
  }
  if (versionId) revalidatePath(versionPath(versionId));
}

export async function exportPreflightAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const parsed = exportPreflightSchema.safeParse({
    action: "export-preflight",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    versionIds: [versionId],
    mode: String(formData.get("mode") ?? "auto"),
  });
  if (!parsed.success) return;
  const result = await exportPreflight(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return;
  redirect(`${versionPath(versionId)}?op=${result.operationId}`);
}

export async function exportConfirmAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const operationId = String(formData.get("operationId") ?? "");
  const parsed = exportConfirmSchema.safeParse({
    action: "export-confirm",
    brandId: String(formData.get("brandId") ?? ""),
    operationId,
    chosenVersionIds: splitIds(formData.get("chosenVersionIds")),
  });
  if (!parsed.success) return;
  await exportConfirm(getConnection(), session.user.id, parsed.data);
  revalidatePath(versionPath(versionId));
  redirect(`${versionPath(versionId)}?op=${operationId}`);
}

function publicationPath(publicationId: string) {
  return `/dashboard/content/publications/${publicationId}`;
}

export async function submitPublicationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const accessClass = String(formData.get("accessClass") ?? "");
  const fixturePage = accessClass
    ? {
      accessClass,
      httpStatus: Number(formData.get("httpStatus") ?? 200),
      title: String(formData.get("fixtureTitle") ?? ""),
      bodyText: String(formData.get("fixtureBody") ?? ""),
      pageMarker: String(formData.get("pageMarker") ?? "") || undefined,
    }
    : undefined;
  const parsed = submitPublicationSchema.safeParse({
    action: "submit-publication",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    versionId,
    targetAccount: String(formData.get("targetAccount") ?? ""),
    pageUrl: String(formData.get("pageUrl") ?? ""),
    publisherId: String(formData.get("publisherId") ?? session.user.id),
    claimedPublishedAt: String(formData.get("claimedPublishedAt") ?? ""),
    channelDeclaration: String(formData.get("channelDeclaration") ?? ""),
    ...(fixturePage ? { fixturePage } : {}),
  });
  if (!parsed.success) return;
  const result = await submitPublication(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return;
  revalidatePath(versionPath(versionId));
  redirect(publicationPath(result.publicationId));
}

export async function verifyPublicationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const publicationId = String(formData.get("publicationId") ?? "");
  const useLiveFetch = String(formData.get("useLiveFetch") ?? "") === "true";
  const parsed = verifyPublicationSchema.safeParse({
    action: "verify-publication",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    publicationId,
    ...(useLiveFetch ? {} : {
      fixturePage: {
        accessClass: String(formData.get("accessClass") ?? ""),
        httpStatus: Number(formData.get("httpStatus") ?? 200),
        title: String(formData.get("fixtureTitle") ?? ""),
        bodyText: String(formData.get("fixtureBody") ?? ""),
        pageMarker: String(formData.get("pageMarker") ?? "") || undefined,
      },
    }),
  });
  if (!parsed.success) return;
  await verifyPublication(getConnection(), session.user.id, parsed.data);
  revalidatePath(publicationPath(publicationId));
}

export async function submitManualEvidenceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const publicationId = String(formData.get("publicationId") ?? "");
  const parsed = submitManualEvidenceSchema.safeParse({
    action: "submit-manual-evidence",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    publicationId,
    screenshotRef: String(formData.get("screenshotRef") ?? ""),
    pageMarker: String(formData.get("pageMarker") ?? ""),
    observedAt: String(formData.get("observedAt") ?? ""),
    bodyExcerpt: String(formData.get("bodyExcerpt") ?? ""),
    reviewerNote: String(formData.get("reviewerNote") ?? "") || undefined,
  });
  if (!parsed.success) return;
  await submitManualEvidence(getConnection(), session.user.id, parsed.data);
  revalidatePath(publicationPath(publicationId));
}
