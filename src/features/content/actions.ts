"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import {
  cancelBatch,
  confirmBrief,
  generateBatch,
  pauseBatch,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
} from "./commands";
import {
  batchControlSchema,
  confirmBriefSchema,
  generateBatchSchema,
  saveBriefDraftSchema,
  templateKindSchema,
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
  const parsed = generateBatchSchema.safeParse({
    action: "generate-batch",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    briefIds,
  });
  if (!parsed.success) return;
  const result = await generateBatch(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content");
  if (!("error" in result) && result.batch) {
    revalidatePath(`/dashboard/content/batches/${result.batch.id}`);
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
