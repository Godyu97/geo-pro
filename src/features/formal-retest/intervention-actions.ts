"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { createInterventionBatch, registerInterventionPage } from "./intervention-commands.ts";
import { createInterventionBatchSchema, registerInterventionPageSchema } from "./intervention-contracts.ts";
import { interventionsPath, retestHref } from "./workspace.ts";

const pageErrors = new Set(["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"]);

function finish(brandId?: string, error?: string): never {
  revalidatePath(interventionsPath);
  redirect(retestHref(interventionsPath, brandId, error && pageErrors.has(error) ? error : undefined));
}

function verifiedAt(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
}

export async function createInterventionBatchAction(formData: FormData) {
  const session = await requireSession();
  const command = createInterventionBatchSchema.safeParse({ brandId: formData.get("brandId") });
  if (!command.success) finish(undefined, "INVALID_INPUT");
  const result = await createInterventionBatch(getConnection(), session.user.id, command.data);
  finish(command.data.brandId, "error" in result ? result.error : undefined);
}

export async function registerInterventionPageAction(formData: FormData) {
  const session = await requireSession();
  const brandId = brandIdSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) finish(undefined, "INVALID_INPUT");
  const batchId = brandIdSchema.safeParse(formData.get("batchId"));
  const command = registerInterventionPageSchema.safeParse({
    pageKey: formData.get("pageKey"),
    verifiedAt: verifiedAt(formData.get("verifiedAt")),
  });
  if (!batchId.success || !command.success) finish(brandId.data, "INVALID_INPUT");
  const result = await registerInterventionPage(getConnection(), session.user.id, { id: batchId.data, brandId: brandId.data }, command.data);
  finish(brandId.data, "error" in result ? result.error : undefined);
}
