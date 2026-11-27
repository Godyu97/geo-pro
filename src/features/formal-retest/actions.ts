"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { appendFormalConfounder, createFormalObservation, recordFormalCheckpoint, registerFormalControl, stopFormalObservation } from "./commands.ts";
import { createFormalObservationSchema, recordFormalCheckpointSchema } from "./contracts.ts";
import { observationsPath, retestHref } from "./workspace.ts";

const pageErrors = new Set(["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT", "THRESHOLD_REJECTED", "CHECKPOINT_EXISTS", "OBSERVATION_STOPPED"]);

function finish(brandId?: string, error?: string): never {
  revalidatePath(observationsPath);
  redirect(retestHref(observationsPath, brandId, error && pageErrors.has(error) ? error : undefined));
}

function observationRef(formData: FormData) {
  const brandId = brandIdSchema.safeParse(formData.get("brandId"));
  const id = brandIdSchema.safeParse(formData.get("observationId"));
  if (!brandId.success) finish(undefined, "INVALID_INPUT");
  if (!id.success) finish(brandId.data, "INVALID_INPUT");
  return { id: id.data, brandId: brandId.data };
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
  if (!command.success) {
    const brand = brandIdSchema.safeParse(formData.get("brandId"));
    finish(brand.data, "INVALID_INPUT");
  }
  const result = await createFormalObservation(getConnection(), session.user.id, command.data);
  finish(command.data.brandId, "error" in result ? result.error : undefined);
}

export async function recordFormalCheckpointAction(formData: FormData) {
  const session = await requireSession();
  const ref = observationRef(formData);
  const command = recordFormalCheckpointSchema.safeParse({
    checkpoint: formData.get("checkpoint"),
    today: formData.get("today"),
    requestedMode: "formal",
  });
  if (!command.success) finish(ref.brandId, "INVALID_INPUT");
  const result = await recordFormalCheckpoint(getConnection(), session.user.id, ref, command.data);
  finish(ref.brandId, "error" in result ? result.error : undefined);
}

export async function appendFormalConfounderAction(formData: FormData) {
  const session = await requireSession();
  const ref = observationRef(formData);
  const raw: Record<string, FormDataEntryValue | null> = {
    factor: formData.get("factor"),
    note: formData.get("note"),
  };
  if (formData.has("thresholdPp")) raw.thresholdPp = formData.get("thresholdPp");
  if (formData.has("threshold")) raw.threshold = formData.get("threshold");
  const result = await appendFormalConfounder(getConnection(), session.user.id, ref, raw);
  finish(ref.brandId, "error" in result ? result.error : undefined);
}

export async function stopFormalObservationAction(formData: FormData) {
  const session = await requireSession();
  const ref = observationRef(formData);
  const result = await stopFormalObservation(getConnection(), session.user.id, ref, {
    reason: formData.get("reason"),
  });
  finish(ref.brandId, "error" in result ? result.error : undefined);
}

export async function registerFormalControlAction(formData: FormData) {
  const session = await requireSession();
  const ref = observationRef(formData);
  const result = await registerFormalControl(getConnection(), session.user.id, ref, {
    pageKey: formData.get("pageKey"),
    label: formData.get("label"),
  });
  finish(ref.brandId, "error" in result ? result.error : undefined);
}
