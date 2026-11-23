"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { appendFormalConfounder, createFormalObservation, recordFormalCheckpoint } from "./commands.ts";
import { createFormalObservationSchema, recordFormalCheckpointSchema } from "./contracts.ts";

const observationsPath = "/dashboard/reports/observations";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT", "THRESHOLD_REJECTED"]);

function finish(error?: string): never {
  revalidatePath(observationsPath);
  redirect(error && pageErrors.has(error) ? `${observationsPath}?error=${error}` : observationsPath);
}

function excludedIds(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\s,]+/).map((item) => item.trim()).filter((item) => item.length > 0);
}

function wholeNumber(value: FormDataEntryValue | null) {
  const parsed = zNumber(String(value ?? ""));
  return parsed;
}

function zNumber(value: string) {
  if (!/^\d{1,4}$/.test(value)) return Number.NaN;
  return Number(value);
}

export async function createFormalObservationAction(formData: FormData) {
  const session = await requireSession();
  const command = createFormalObservationSchema.safeParse({
    brandId: formData.get("brandId"),
    frozenSetId: formData.get("frozenSetId"),
    effectiveOn: formData.get("effectiveOn"),
    frozenNonBrandCount: wholeNumber(formData.get("frozenNonBrandCount")),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await createFormalObservation(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function recordFormalCheckpointAction(formData: FormData) {
  const session = await requireSession();
  const observationId = brandIdSchema.safeParse(formData.get("observationId"));
  const command = recordFormalCheckpointSchema.safeParse({
    checkpoint: formData.get("checkpoint"),
    today: formData.get("today"),
    comparableQuestions: wholeNumber(formData.get("comparableQuestions")),
    excluded: excludedIds(formData.get("excluded")),
    requestedMode: "formal",
  });
  if (!observationId.success || !command.success) finish("INVALID_INPUT");
  const result = await recordFormalCheckpoint(getConnection(), session.user.id, observationId.data, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function appendFormalConfounderAction(formData: FormData) {
  const session = await requireSession();
  const observationId = brandIdSchema.safeParse(formData.get("observationId"));
  if (!observationId.success) finish("INVALID_INPUT");
  const raw: Record<string, FormDataEntryValue | null> = {
    factor: formData.get("factor"),
    note: formData.get("note"),
  };
  if (formData.has("thresholdPp")) raw.thresholdPp = formData.get("thresholdPp");
  if (formData.has("threshold")) raw.threshold = formData.get("threshold");
  const result = await appendFormalConfounder(getConnection(), session.user.id, observationId.data, raw);
  finish("error" in result ? result.error : undefined);
}
