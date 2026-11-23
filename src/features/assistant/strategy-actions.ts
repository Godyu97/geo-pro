"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { draftStrategyTemplate, saveStrategyTemplate } from "./strategy-commands.ts";
import { draftStrategyTemplateSchema, saveStrategyTemplateSchema } from "./strategy-contracts.ts";

const strategiesPath = "/dashboard/assistant/strategies";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "AI_FAILED", "INVALID_MODEL_OUTPUT"]);

function finish(error?: string): never {
  revalidatePath(strategiesPath);
  revalidatePath("/dashboard/assistant");
  redirect(error && pageErrors.has(error) ? `${strategiesPath}?error=${error}` : strategiesPath);
}

function wholeNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (!/^\d{1,10}$/.test(text)) return Number.NaN;
  return Number(text);
}

function fieldsFromForm(formData: FormData) {
  return {
    brandId: formData.get("brandId"),
    industry: formData.get("industry"),
    samplingCondition: formData.get("samplingCondition"),
    successes: wholeNumber(formData.get("successes")),
    evidenceStrength: formData.get("evidenceStrength"),
    failureCase: formData.get("failureCase"),
  };
}

export async function saveStrategyTemplateAction(formData: FormData) {
  const session = await requireSession();
  const command = saveStrategyTemplateSchema.safeParse({
    ...fieldsFromForm(formData),
    explanation: formData.get("explanation"),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await saveStrategyTemplate(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function draftStrategyTemplateAction(formData: FormData) {
  const session = await requireSession();
  const command = draftStrategyTemplateSchema.safeParse({
    ...fieldsFromForm(formData),
    materials: formData.get("materials"),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await draftStrategyTemplate(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}
