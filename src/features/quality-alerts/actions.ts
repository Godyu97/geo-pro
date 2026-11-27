"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { acknowledgeQualityAlert, snoozeQualityAlert } from "./commands.ts";

const alertsPath = "/dashboard/monitoring/alerts";
const pageErrors = new Set(["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT", "ALERT_STATE_CONFLICT"]);

function returnBrandFrom(formData: FormData) {
  const parsed = brandIdSchema.safeParse(formData.get("returnBrandId"));
  return parsed.success ? parsed.data : undefined;
}

function finish(error?: string, returnBrandId?: string): never {
  revalidatePath(alertsPath);
  const query = new URLSearchParams();
  if (returnBrandId) query.set("brandId", returnBrandId);
  if (error && pageErrors.has(error)) query.set("error", error);
  const suffix = query.toString();
  redirect(suffix ? `${alertsPath}?${suffix}` : alertsPath);
}

export async function acknowledgeQualityAlertAction(formData: FormData) {
  const session = await requireSession();
  const returnBrandId = returnBrandFrom(formData);
  const alertId = brandIdSchema.safeParse(String(formData.get("alertId") ?? ""));
  if (!alertId.success) finish("INVALID_INPUT", returnBrandId);
  const result = await acknowledgeQualityAlert(getConnection(), session.user.id, alertId.data);
  finish("error" in result ? result.error : undefined, returnBrandId);
}

export async function snoozeQualityAlertAction(formData: FormData) {
  const session = await requireSession();
  const returnBrandId = returnBrandFrom(formData);
  const alertId = brandIdSchema.safeParse(String(formData.get("alertId") ?? ""));
  if (!alertId.success) finish("INVALID_INPUT", returnBrandId);
  const result = await snoozeQualityAlert(getConnection(), session.user.id, alertId.data);
  finish("error" in result ? result.error : undefined, returnBrandId);
}
