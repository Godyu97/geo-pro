"use server";

import { randomUUID } from "node:crypto";
import { MAX_STORED_OBJECT_BYTES } from "../stored-objects/contracts.ts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts";
import {
  approveChannelVariant,
  approveContent,
  blockChannelVariant,
  cancelBatch,
  confirmBrief,
  exportChannelVariant,
  exportConfirm,
  exportPreflight,
  generateBatch,
  pauseBatch,
  registerAsset,
  rejectContent,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
  saveChannelVariant,
  submitManualEvidence,
  submitPublication,
  submitReview,
  updateVariant,
  verifyPublication,
} from "./commands";
import {
  approveChannelVariantSchema,
  approveContentSchema,
  batchControlSchema,
  blockChannelVariantSchema,
  calendarErrorCodes,
  confirmBriefSchema,
  exportChannelVariantSchema,
  exportConfirmSchema,
  exportPreflightSchema,
  generateBatchSchema,
  registerAssetSchema,
  scanExpiredMaintenanceSchema,
  settleMaintenanceSchema,
  rejectContentSchema,
  saveBriefDraftSchema,
  saveChannelVariantSchema,
  submitManualEvidenceSchema,
  submitPublicationSchema,
  submitReviewSchema,
  templateKindSchema,
  updateVariantSchema,
  verifyPublicationSchema,
} from "./contracts";
import { scanExpiredContentMaintenance, settleContentMaintenance } from "./maintenance";

export async function saveBriefAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const titleCandidates = String(formData.get("titleCandidates") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const factVersionIds = uniqueIds([
    ...formData.getAll("factVersionId"),
    ...splitIds(formData.get("factVersionIds")),
  ]);
  const templateKind = templateKindSchema.catch("fact_faq").parse(String(formData.get("templateKind") ?? "fact_faq"));
  const parsed = saveBriefDraftSchema.safeParse({
    action: "save-brief-draft",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    briefId: String(formData.get("briefId") ?? "") || undefined,
    optimizationTaskId: String(formData.get("optimizationTaskId") ?? "") || undefined,
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

function uniqueIds(values: FormDataEntryValue[]) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function versionPath(versionId: string) {
  return `/dashboard/content/versions/${versionId}`;
}

function contentListPath(brandId: string, filter: string) {
  const search = new URLSearchParams();
  if (brandId) search.set("brandId", brandId);
  if (filter === "pending_review" || filter === "deliverable") search.set("filter", filter);
  const query = search.toString();
  return query ? `/dashboard/content?${query}` : "/dashboard/content";
}

function withSearch(path: string, extra: Record<string, string | undefined>) {
  const [pathname, existing] = path.split("?");
  const search = new URLSearchParams(existing ?? "");
  for (const [key, value] of Object.entries(extra)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function exportTarget(formData: FormData, versionId: string) {
  const brandId = String(formData.get("brandId") ?? "");
  if (String(formData.get("source") ?? "") === "list") {
    return contentListPath(brandId, String(formData.get("filter") ?? ""));
  }
  return versionId ? versionPath(versionId) : contentListPath(brandId, "");
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
    const result = parsed.success ? await approveContent(db, session.user.id, parsed.data) : { error: "INVALID_INPUT" as const };
    if ("error" in result && base.versionId) {
      revalidatePath("/dashboard/content");
      revalidatePath(versionPath(base.versionId));
      redirect(`${versionPath(base.versionId)}?reviewError=${result.error}`);
    }
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
  if (!parsed.success) {
    const versionId = brandIdSchema.safeParse(formData.get("versionId"));
    if (versionId.success) redirect(`${versionPath(versionId.data)}?assetError=INVALID_INPUT#version-images`);
    return;
  }
  const result = await updateVariant(getConnection(), session.user.id, parsed.data);
  if ("error" in result) {
    redirect(`${versionPath(parsed.data.versionId)}?assetError=${result.error}#version-images`);
  }
  revalidatePath("/dashboard/content");
  revalidatePath(versionPath(parsed.data.versionId));
  redirect(`${versionPath(parsed.data.versionId)}#version-images`);
}

export async function registerAssetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = brandIdSchema.safeParse(formData.get("versionId")).data;
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
  if (versionId) {
    revalidatePath(versionPath(versionId));
    redirect(`${versionPath(versionId)}?registeredAsset=${result.asset.id}#version-images`);
  }
}

export async function exportPreflightAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionIds = uniqueIds(formData.getAll("versionId"));
  const target = exportTarget(formData, versionIds[0] ?? "");
  if (versionIds.length === 0) redirect(withSearch(target, { exportError: "NONE_SELECTED" }));
  const parsed = exportPreflightSchema.safeParse({
    action: "export-preflight",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    versionIds,
    mode: String(formData.get("mode") ?? "auto"),
  });
  if (!parsed.success) redirect(withSearch(target, { exportError: "INVALID_INPUT" }));
  const result = await exportPreflight(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  if (String(formData.get("source") ?? "") !== "list" && versionIds[0]) revalidatePath(versionPath(versionIds[0]));
  if ("error" in result) redirect(withSearch(target, { exportError: result.error }));
  redirect(withSearch(target, { op: result.operationId }));
}

export async function exportConfirmAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const operationId = String(formData.get("operationId") ?? "");
  const target = exportTarget(formData, versionId);
  const checked = uniqueIds(formData.getAll("chosenVersionId"));
  const chosenVersionIds = checked.length > 0 ? checked : splitIds(formData.get("chosenVersionIds"));
  const kept = operationId ? { op: operationId } : {};
  if (chosenVersionIds.length === 0) redirect(withSearch(target, { ...kept, exportError: "NONE_SELECTED" }));
  const parsed = exportConfirmSchema.safeParse({
    action: "export-confirm",
    brandId: String(formData.get("brandId") ?? ""),
    operationId,
    chosenVersionIds,
  });
  if (!parsed.success) redirect(withSearch(target, { ...kept, exportError: "INVALID_INPUT" }));
  const result = await exportConfirm(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  if (versionId) revalidatePath(versionPath(versionId));
  if ("error" in result) redirect(withSearch(target, { ...kept, exportError: result.error }));
  redirect(withSearch(target, { op: result.operationId }));
}

function publicationPath(publicationId: string) {
  return `/dashboard/content/publications/${publicationId}`;
}

export async function submitPublicationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const versionId = String(formData.get("versionId") ?? "");
  const predecessorId = String(formData.get("predecessorId") ?? "").trim();
  const parsed = submitPublicationSchema.safeParse({
    action: "submit-publication",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: String(formData.get("operationId") ?? ""),
    versionId,
    ...(predecessorId ? { predecessorId } : {}),
    targetAccount: String(formData.get("targetAccount") ?? ""),
    pageUrl: String(formData.get("pageUrl") ?? ""),
    publisherId: String(formData.get("publisherId") ?? session.user.id),
    claimedPublishedAt: String(formData.get("claimedPublishedAt") ?? ""),
    channelDeclaration: String(formData.get("channelDeclaration") ?? ""),
  });
  if (!parsed.success) {
    if (submitPublicationSchema.shape.versionId.safeParse(versionId).success) {
      redirect(`${versionPath(versionId)}?publicationError=INVALID_INPUT#publication-backfill`);
    }
    return;
  }
  const result = await submitPublication(getConnection(), session.user.id, parsed.data);
  if ("error" in result) redirect(`${versionPath(versionId)}?publicationError=${result.error}#publication-backfill`);
  revalidatePath(versionPath(versionId));
  redirect(publicationPath(result.publicationId));
}

export async function verifyPublicationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const publicationId = String(formData.get("publicationId") ?? "");
  const parsed = verifyPublicationSchema.safeParse({
    action: "verify-publication",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    publicationId,
  });
  if (!parsed.success) return;
  const result = await verifyPublication(getConnection(), session.user.id, parsed.data);
  revalidatePath(publicationPath(publicationId));
  redirect("error" in result
    ? `${publicationPath(publicationId)}?verificationError=${result.error}`
    : publicationPath(publicationId));
}

export async function submitManualEvidenceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const publicationId = String(formData.get("publicationId") ?? "");
  const uploaded = formData.get("screenshot");
  const evidencePath = (code: string) => `${publicationPath(publicationId)}?evidenceError=${code}`;
  if (!(uploaded instanceof File) || uploaded.size < 1) redirect(evidencePath("SCREENSHOT_REQUIRED"));
  if (uploaded.size > MAX_STORED_OBJECT_BYTES) redirect(evidencePath("EVIDENCE_TOO_LARGE"));
  const parsed = submitManualEvidenceSchema.safeParse({
    action: "submit-manual-evidence",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    publicationId,
    screenshotRef: uploaded.name || "screenshot",
    pageMarker: String(formData.get("pageMarker") ?? ""),
    observedAt: String(formData.get("observedAt") ?? ""),
    bodyExcerpt: String(formData.get("bodyExcerpt") ?? ""),
    reviewerNote: String(formData.get("reviewerNote") ?? "") || undefined,
  });
  if (!parsed.success) redirect(evidencePath("INVALID_INPUT"));
  const result = await submitManualEvidence(getConnection(), session.user.id, parsed.data, undefined, {
    file: {
      fileName: uploaded.name,
      contentType: uploaded.type,
      body: new Uint8Array(await uploaded.arrayBuffer()),
    },
  });
  if ("error" in result) redirect(evidencePath(result.error));
  revalidatePath(publicationPath(publicationId));
}

function variantPath(versionId: string) {
  return `/dashboard/content/versions/${versionId}/variants`;
}

function channelCommand(formData: FormData) {
  return {
    brandId: String(formData.get("brandId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
    channel: String(formData.get("channel") ?? ""),
    operationId: randomUUID(),
  };
}

export async function saveChannelVariantAction(formData: FormData) {
  const session = await requireSession();
  const base = channelCommand(formData);
  const profileVersionId = String(formData.get("profileVersionId") ?? "");
  const parsed = saveChannelVariantSchema.safeParse({
    action: "save-channel-variant",
    ...base,
    bodyMarkdown: String(formData.get("bodyMarkdown") ?? ""),
    ...(profileVersionId ? { profileVersionId } : {}),
  });
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" as const };
  const result = await saveChannelVariant(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidatePath(variantPath(parsed.data.versionId));
  revalidatePath(versionPath(parsed.data.versionId));
  return { ok: true as const };
}

export async function approveChannelVariantAction(formData: FormData) {
  const session = await requireSession();
  const base = channelCommand(formData);
  const parsed = approveChannelVariantSchema.safeParse({ action: "approve-channel-variant", ...base });
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" as const };
  const result = await approveChannelVariant(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidatePath(variantPath(parsed.data.versionId));
  return { ok: true as const };
}

export async function blockChannelVariantAction(formData: FormData) {
  const session = await requireSession();
  const base = channelCommand(formData);
  const parsed = blockChannelVariantSchema.safeParse({ action: "block-channel-variant", ...base });
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" as const };
  const result = await blockChannelVariant(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidatePath(variantPath(parsed.data.versionId));
  return { ok: true as const };
}

export async function exportChannelVariantAction(formData: FormData) {
  const session = await requireSession();
  const base = channelCommand(formData);
  const parsed = exportChannelVariantSchema.safeParse({ action: "export-channel-variant", ...base });
  if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" as const };
  const result = await exportChannelVariant(getConnection(), session.user.id, parsed.data);
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidatePath(variantPath(parsed.data.versionId));
  revalidatePath(versionPath(parsed.data.versionId));
  return { ok: true as const };
}

function calendarPath(brandId: string, extra: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  if (brandId) search.set("brandId", brandId);
  for (const [key, value] of Object.entries(extra)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/dashboard/content/calendar?${query}` : "/dashboard/content/calendar";
}

export async function scanExpiredMaintenanceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const factVersionId = brandIdSchema.safeParse(formData.get("factVersionId")).data;
  const parsed = scanExpiredMaintenanceSchema.safeParse({ action: "scan-expired-maintenance", brandId });
  if (!parsed.success) redirect(calendarPath("", { calendarError: "INVALID_INPUT" }));
  const result = await Promise.resolve()
    .then(() => scanExpiredContentMaintenance(getConnection(), session.user.id, parsed.data.brandId))
    .catch(() => ({ error: "SERVICE_UNAVAILABLE" as const }));
  if ("error" in result) {
    const calendarError = calendarErrorCodes.find((code) => code === result.error) ?? "INVALID_INPUT";
    redirect(calendarPath(parsed.data.brandId, { factVersionId, calendarError }));
  }
  revalidatePath("/dashboard/content/calendar");
  revalidatePath(`/dashboard/brands/${parsed.data.brandId}/facts`);
  redirect(calendarPath(parsed.data.brandId, { factVersionId, calendarNotice: "scanned", scanned: String(result.scanned) }));
}

export async function settleMaintenanceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const factVersionId = brandIdSchema.safeParse(formData.get("factVersionId")).data;
  const taskId = String(formData.get("taskId") ?? "");
  const channels = formData.getAll("channel").map((value) => String(value));
  const changes: { channel: string; state: "verified" | "blocked"; verifiedOn?: string }[] = [];
  for (const channel of channels) {
    const state = String(formData.get(`state-${channel}`) ?? "");
    if (state !== "verified" && state !== "blocked") continue;
    const verifiedOn = String(formData.get(`verified-${channel}`) ?? "");
    changes.push({
      channel,
      state,
      ...(state === "verified" && verifiedOn ? { verifiedOn } : {}),
    });
  }
  const parsed = settleMaintenanceSchema.safeParse({
    action: "settle-maintenance",
    brandId,
    taskId,
    channels: changes,
  });
  if (!parsed.success) {
    redirect(calendarPath(brandIdSchema.safeParse(brandId).data ?? "", { factVersionId, calendarError: "INVALID_INPUT" }));
  }
  const result = await Promise.resolve()
    .then(() => settleContentMaintenance(getConnection(), session.user.id, parsed.data))
    .catch(() => ({ error: "SERVICE_UNAVAILABLE" as const }));
  if ("error" in result) {
    const calendarError = calendarErrorCodes.find((code) => code === result.error) ?? "INVALID_INPUT";
    redirect(calendarPath(parsed.data.brandId, { factVersionId, calendarError }));
  }
  revalidatePath("/dashboard/content/calendar");
  revalidatePath(`/dashboard/brands/${parsed.data.brandId}/facts`);
  redirect(calendarPath(parsed.data.brandId, { factVersionId, calendarNotice: "settled" }));
}
