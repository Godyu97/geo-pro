"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import type { ReportError } from "./contracts.ts";
import {
  generateSavedSnapshot,
  requestSavedComparison,
  requestSavedReminder,
  reviseSavedSnapshot,
  savedComparisonSchema,
  savedGenerateSchema,
  savedReminderSchema,
  savedReviseSchema,
} from "./saved-retest.ts";

const pageErrors = new Set<ReportError>([
  "INVALID_INPUT",
  "LOOP_NOT_READY",
  "CONFLICT",
  "NOT_FOUND",
  "SERVICE_UNAVAILABLE",
  "WINDOW_NOT_DUE",
  "FORBIDDEN",
]);

function finish(brandId: string, error?: string, notice?: string): never {
  revalidatePath("/dashboard/reports");
  const params = new URLSearchParams();
  if (brandIdSchema.safeParse(brandId).success) params.set("brandId", brandId);
  if (error && pageErrors.has(error as ReportError)) params.set("error", error);
  if (notice === "diagnostic-downgrade") params.set("notice", notice);
  const query = params.toString();
  redirect(query ? `/dashboard/reports?${query}` : "/dashboard/reports");
}

export async function requestSavedComparisonAction(formData: FormData) {
  const session = await requireSession();
  const locale = await getLocale();
  const brandId = String(formData.get("brandId") ?? "");
  const publicationId = String(formData.get("publicationId") ?? "").trim();
  const parsed = savedComparisonSchema.safeParse({
    brandId,
    operationId: randomUUID(),
    intent: formData.get("intent"),
    track: formData.get("track"),
    timezone: String(formData.get("timezone") ?? ""),
    beforeStart: formData.get("beforeStart"),
    beforeEnd: formData.get("beforeEnd"),
    afterStart: formData.get("afterStart"),
    afterEnd: formData.get("afterEnd"),
    ...(publicationId ? { publicationId } : {}),
    locale,
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await requestSavedComparison(getConnection(), session.user.id, parsed.data);
  if ("error" in result) finish(brandId, result.error);
  finish(brandId, undefined, result.downgraded ? "diagnostic-downgrade" : undefined);
}

export async function requestSavedReminderAction(formData: FormData) {
  const session = await requireSession();
  const locale = await getLocale();
  const brandId = String(formData.get("brandId") ?? "");
  const publicationId = String(formData.get("publicationId") ?? "").trim();
  const parsed = savedReminderSchema.safeParse({
    brandId,
    operationId: randomUUID(),
    track: formData.get("track"),
    timezone: String(formData.get("timezone") ?? ""),
    ...(publicationId ? { publicationId } : {}),
    locale,
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await requestSavedReminder(getConnection(), session.user.id, parsed.data);
  finish(brandId, "error" in result ? result.error : undefined);
}

export async function generateSavedSnapshotAction(formData: FormData) {
  const session = await requireSession();
  const locale = await getLocale();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = savedGenerateSchema.safeParse({
    brandId,
    operationId: randomUUID(),
    retestId: formData.get("retestId"),
    locale,
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await generateSavedSnapshot(getConnection(), session.user.id, parsed.data);
  finish(brandId, "error" in result ? result.error : undefined);
}

export async function reviseSavedSnapshotAction(formData: FormData) {
  const session = await requireSession();
  const locale = await getLocale();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = savedReviseSchema.safeParse({
    brandId,
    operationId: randomUUID(),
    snapshotId: formData.get("snapshotId"),
    locale,
  });
  if (!parsed.success) finish(brandId, "INVALID_INPUT");
  const result = await reviseSavedSnapshot(getConnection(), session.user.id, parsed.data);
  finish(brandId, "error" in result ? result.error : undefined);
}
