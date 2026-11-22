"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { confirmCaptureAttempt, createCaptureSheet, degradeCaptureSheet, recordCaptureAttempt } from "./commands.ts";
import {
  confirmCaptureAttemptSchema,
  createCaptureSheetSchema,
  degradeCaptureSheetSchema,
  recordCaptureAttemptSchema,
} from "./contracts.ts";

const capturePath = "/dashboard/monitoring/capture";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT"]);

function finish(error?: string): never {
  revalidatePath(capturePath);
  redirect(error && pageErrors.has(error) ? `${capturePath}?error=${error}` : capturePath);
}

function minutes(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (text.length === 0) return null;
  if (!/^\d{1,6}$/.test(text)) return Number.NaN;
  return Number(text);
}

function promptIds(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function flag(value: FormDataEntryValue | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function blockedBy(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  return text.length === 0 ? null : text;
}

function count(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,4}$/.test(text)) return Number.NaN;
  return Number(text);
}

export async function createCaptureSheetAction(formData: FormData) {
  const session = await requireSession();
  const command = createCaptureSheetSchema.safeParse({
    brandId: formData.get("brandId"),
    promptIds: promptIds(formData.get("promptIds")),
    assistedMinutes: minutes(formData.get("assistedMinutes")),
    manualMinutes: minutes(formData.get("manualMinutes")),
    citationsComplete: flag(formData.get("citationsComplete")),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await createCaptureSheet(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function recordCaptureAttemptAction(formData: FormData) {
  const session = await requireSession();
  const command = recordCaptureAttemptSchema.safeParse({
    sheetId: formData.get("sheetId"),
    blockedBy: blockedBy(formData.get("blockedBy")),
    citationCount: count(formData.get("citationCount")),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await recordCaptureAttempt(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function confirmCaptureAttemptAction(formData: FormData) {
  const session = await requireSession();
  const attemptId = brandIdSchema.safeParse(formData.get("attemptId"));
  const command = confirmCaptureAttemptSchema.safeParse({ confirmed: flag(formData.get("confirmed")) });
  if (!attemptId.success || !command.success) finish("INVALID_INPUT");
  const result = await confirmCaptureAttempt(getConnection(), session.user.id, attemptId.data, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function degradeCaptureSheetAction(formData: FormData) {
  const session = await requireSession();
  const sheetId = brandIdSchema.safeParse(formData.get("sheetId"));
  const command = degradeCaptureSheetSchema.safeParse({ structureChanged: flag(formData.get("structureChanged")) });
  if (!sheetId.success || !command.success) finish("INVALID_INPUT");
  const result = await degradeCaptureSheet(getConnection(), session.user.id, sheetId.data, command.data);
  finish("error" in result ? result.error : undefined);
}
