"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { checkPages, generateFromEvidence, updateTask } from "./commands";
import {
  checkPagesSchema,
  generateFromEvidenceSchema,
  updateTaskSchema,
  type OptimizationError,
} from "./contracts";

export async function generateOptimizationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = generateFromEvidenceSchema.safeParse({
    action: "generate-from-evidence",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    observationId: String(formData.get("observationId") ?? ""),
    businessImportance: Number(formData.get("businessImportance") ?? 2),
  });
  if (!parsed.success) return;
  await generateFromEvidence(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/optimization");
  revalidatePath("/dashboard/monitoring/overview");
}

export async function checkPagesAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const urls = String(formData.get("urls") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const fixtureRaw = String(formData.get("fixtureBody") ?? "");
  const fixtureStatus = String(formData.get("fixtureStatus") ?? "ok");
  const fixtures = urls.length === 1 && fixtureRaw
    ? [{
        url: urls[0],
        status: (fixtureStatus === "restricted" || fixtureStatus === "error" ? fixtureStatus : "ok") as
          "ok" | "restricted" | "error",
        title: String(formData.get("fixtureTitle") ?? "Isolated fixture"),
        body: fixtureRaw,
        accessCondition: "isolated-fixture",
      }]
    : undefined;

  const parsed = checkPagesSchema.safeParse({
    action: "check-pages",
    brandId: String(formData.get("brandId") ?? ""),
    operationId: randomUUID(),
    taskId: String(formData.get("taskId") ?? "") || null,
    urls,
    fixtures,
  });
  if (!parsed.success) return;
  await checkPages(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/optimization");
}

export type OptimizationUpdateResult = "saved" | OptimizationError;

export async function updateOptimizationAction(formData: FormData): Promise<OptimizationUpdateResult> {
  const session = await requireSession();
  const parsed = updateTaskSchema.safeParse({
    action: "update-task",
    brandId: String(formData.get("brandId") ?? ""),
    taskId: String(formData.get("taskId") ?? ""),
    operationId: randomUUID(),
    status: String(formData.get("status") ?? "") || undefined,
    completionNote: String(formData.get("completionNote") ?? "") || undefined,
    dismissReason: String(formData.get("dismissReason") ?? "") || undefined,
    retestConclusion: String(formData.get("retestConclusion") ?? "") || undefined,
    manualRank: formData.get("manualRank") ? Number(formData.get("manualRank")) : undefined,
    reorderReason: String(formData.get("reorderReason") ?? "") || undefined,
  });
  if (!parsed.success) return "INVALID_INPUT";
  try {
    const result = await updateTask(getConnection(), session.user.id, parsed.data);
    if ("error" in result) return result.error;
  } catch {
    console.error("optimization-task-update-failed");
    return "SERVICE_UNAVAILABLE";
  }
  revalidatePath("/dashboard/optimization");
  revalidatePath(`/dashboard/optimization/${parsed.data.taskId}`);
  revalidatePath("/dashboard/monitoring/overview");
  return "saved";
}
