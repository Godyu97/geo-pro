"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { acknowledgeQualityAlert, snoozeQualityAlert } from "./commands.ts";

const alertsPath = "/dashboard/monitoring/alerts";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT", "ALERT_STATE_CONFLICT"]);

function finish(error?: string): never {
  revalidatePath(alertsPath);
  redirect(error && pageErrors.has(error) ? `${alertsPath}?error=${error}` : alertsPath);
}

export async function acknowledgeQualityAlertAction(formData: FormData) {
  const session = await requireSession();
  const alertId = brandIdSchema.safeParse(String(formData.get("alertId") ?? ""));
  if (!alertId.success) finish("INVALID_INPUT");
  const result = await acknowledgeQualityAlert(getConnection(), session.user.id, alertId.data);
  finish("error" in result ? result.error : undefined);
}

export async function snoozeQualityAlertAction(formData: FormData) {
  const session = await requireSession();
  const alertId = brandIdSchema.safeParse(String(formData.get("alertId") ?? ""));
  if (!alertId.success) finish("INVALID_INPUT");
  const result = await snoozeQualityAlert(getConnection(), session.user.id, alertId.data);
  finish("error" in result ? result.error : undefined);
}
