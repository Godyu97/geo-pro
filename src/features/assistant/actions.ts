"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { confirmPlanItems, draftWeeklyPlan, executeConfirmedPlan } from "./commands.ts";
import { confirmAssistantPlanSchema, createAssistantPlanSchema } from "./contracts.ts";

const assistantPath = "/dashboard/assistant";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "AI_FAILED", "INVALID_MODEL_OUTPUT"]);

function finish(error?: string): never {
  revalidatePath(assistantPath);
  redirect(error && pageErrors.has(error) ? `${assistantPath}?error=${error}` : assistantPath);
}

function wholeNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (!/^\d{1,10}$/.test(text)) return Number.NaN;
  return Number(text);
}

function itemsFromForm(formData: FormData) {
  const items = [];
  for (let index = 1; index <= 5; index += 1) {
    const action = String(formData.get(`action${index}`) ?? "").trim();
    const factVersionId = String(formData.get(`fact${index}`) ?? "").trim();
    if (!action && !factVersionId) continue;
    items.push({ action, factVersionId });
  }
  return items;
}

export async function createAssistantPlanAction(formData: FormData) {
  const session = await requireSession();
  const command = createAssistantPlanSchema.safeParse({
    brandId: formData.get("brandId"),
    material: formData.get("material"),
    budgetMinor: wholeNumber(formData.get("budgetMinor")),
    successes: wholeNumber(formData.get("successes")),
    items: itemsFromForm(formData),
  });
  if (!command.success) finish("INVALID_INPUT");
  const result = await draftWeeklyPlan(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function confirmAssistantPlanAction(formData: FormData) {
  const session = await requireSession();
  const planId = brandIdSchema.safeParse(formData.get("planId"));
  const itemIds = formData.getAll("itemId").map((value) => String(value));
  const command = confirmAssistantPlanSchema.safeParse({ itemIds });
  if (!planId.success || !command.success) finish("INVALID_INPUT");
  const result = await confirmPlanItems(getConnection(), session.user.id, planId.data, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function executeAssistantPlanAction(formData: FormData) {
  const session = await requireSession();
  const planId = brandIdSchema.safeParse(formData.get("planId"));
  if (!planId.success) finish("INVALID_INPUT");
  const result = await executeConfirmedPlan(getConnection(), session.user.id, planId.data);
  finish("error" in result ? result.error : undefined);
}
