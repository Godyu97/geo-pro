"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { createInterventionBatch, registerInterventionPage } from "./intervention-commands.ts";
import { createInterventionBatchSchema, registerInterventionPageSchema } from "./intervention-contracts.ts";

const interventionsPath = "/dashboard/reports/interventions";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT"]);

function finish(error?: string): never {
  revalidatePath(interventionsPath);
  redirect(error && pageErrors.has(error) ? `${interventionsPath}?error=${error}` : interventionsPath);
}

function verifiedAt(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
}

export async function createInterventionBatchAction(formData: FormData) {
  const session = await requireSession();
  const command = createInterventionBatchSchema.safeParse({ brandId: formData.get("brandId") });
  if (!command.success) finish("INVALID_INPUT");
  const result = await createInterventionBatch(getConnection(), session.user.id, command.data);
  finish("error" in result ? result.error : undefined);
}

export async function registerInterventionPageAction(formData: FormData) {
  const session = await requireSession();
  const batchId = brandIdSchema.safeParse(formData.get("batchId"));
  const command = registerInterventionPageSchema.safeParse({
    pageKey: formData.get("pageKey"),
    verifiedAt: verifiedAt(formData.get("verifiedAt")),
  });
  if (!batchId.success || !command.success) finish("INVALID_INPUT");
  const result = await registerInterventionPage(getConnection(), session.user.id, batchId.data, command.data);
  finish("error" in result ? result.error : undefined);
}
