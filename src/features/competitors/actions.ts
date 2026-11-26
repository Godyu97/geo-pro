"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import {
  createContentBriefFromResearch,
  createOptimizationTaskFromResearch,
  inspectCitationSource,
  proposeResearchBrief,
  recordCompetitorMentions,
  saveCompetitorSet,
  setResearchBriefStatus,
} from "./commands";
import {
  briefStatusSchema,
  inspectCitationSchema,
  proposeBriefSchema,
  recordMentionsSchema,
  researchHandoffSchema,
  saveCompetitorSetSchema,
} from "./contracts";

function finish(brandId: string, error?: string, reason?: string): never {
  const params = new URLSearchParams();
  if (brandId) params.set("brandId", brandId);
  if (error) params.set("error", error);
  if (reason) params.set("reason", reason);
  revalidatePath("/dashboard/monitoring/competitors");
  redirect(`/dashboard/monitoring/competitors?${params.toString()}`);
}

export async function saveCompetitorSetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const labels = String(formData.get("labels") ?? "").split("\n");
  const parsed = saveCompetitorSetSchema.safeParse({ brandId, labels });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await saveCompetitorSet(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}

export async function recordMentionsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const ordered = formData.get("ordered") === "on";
  const mentions = formData.getAll("setLabel").map((item) => {
    const label = String(item);
    const state = String(formData.get(`state:${label}`) ?? "");
    const raw = String(formData.get(`position:${label}`) ?? "").trim();
    return raw.length > 0
      ? { label, state, position: Number(raw) }
      : { label, state };
  });
  const parsed = recordMentionsSchema.safeParse({
    brandId,
    setId: String(formData.get("setId") ?? ""),
    observationId: String(formData.get("observationId") ?? ""),
    ordered,
    mentions,
  });
  if (!parsed.success || parsed.data.mentions.length === 0) finish(brandId, "INVALID_INPUT");
  const result = await recordCompetitorMentions(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}

export async function inspectCitationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = inspectCitationSchema.safeParse({
    brandId,
    citationId: String(formData.get("citationId") ?? ""),
    pageLive: formData.get("pageLive") === "on",
    readable: formData.get("readable") === "on",
    authorKnown: formData.get("authorKnown") === "on",
    supportsBrand: formData.get("supportsBrand") === "on",
    supportedClaim: String(formData.get("supportedClaim") ?? ""),
    factVersionId: String(formData.get("factVersionId") ?? "") || null,
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await inspectCitationSource(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}

export async function proposeBriefAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = proposeBriefSchema.safeParse({
    brandId,
    questionCluster: String(formData.get("questionCluster") ?? ""),
    gap: String(formData.get("gap") ?? ""),
    facts: String(formData.get("facts") ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
    sourceIds: formData.getAll("sourceId").map(String),
    sourceText: String(formData.get("sourceText") ?? ""),
    briefText: String(formData.get("briefText") ?? ""),
    sourceBrand: String(formData.get("sourceBrand") ?? ""),
    ownBrand: String(formData.get("ownBrand") ?? ""),
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await proposeResearchBrief(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error, "reason" in result ? result.reason : undefined);
  finish(brandId);
}

export async function briefStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = briefStatusSchema.safeParse({
    brandId,
    briefId: String(formData.get("briefId") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await setResearchBriefStatus(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}

export async function createContentBriefFromResearchAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = researchHandoffSchema.safeParse({
    brandId,
    briefId: String(formData.get("briefId") ?? ""),
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await createContentBriefFromResearch(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}

export async function createOptimizationTaskFromResearchAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = researchHandoffSchema.safeParse({
    brandId,
    briefId: String(formData.get("briefId") ?? ""),
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await createOptimizationTaskFromResearch(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId);
}
