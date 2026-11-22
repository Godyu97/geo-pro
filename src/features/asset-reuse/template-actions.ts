"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { cloneContentTemplate, exportContentTemplate } from "./template-commands.ts";
import { cloneContentTemplateSchema, exportContentTemplateSchema } from "./template-contracts.ts";

function templatesPath(brandId: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ brandId, ...extra });
  return `/dashboard/content/templates?${params.toString()}`;
}

function checked(formData: FormData, name: string) {
  return formData.get(name) === "1";
}

export async function cloneContentTemplateAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const rawName = String(formData.get("name") ?? "").trim();
  const parsed = cloneContentTemplateSchema.safeParse({
    brandId,
    id: String(formData.get("id") ?? ""),
    gates: {
      fact: checked(formData, "fact"),
      publicLicense: checked(formData, "publicLicense"),
      review: checked(formData, "review"),
    },
    ...(rawName ? { name: rawName } : {}),
  });
  if (!parsed.success) {
    redirect(brandIdSchema.safeParse(brandId).success ? templatesPath(brandId, { error: "INVALID_INPUT" }) : "/dashboard/content/templates?error=INVALID_INPUT");
  }
  const result = await cloneContentTemplate(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/templates");
  if ("error" in result) redirect(templatesPath(parsed.data.brandId, { error: result.error }));
  redirect(templatesPath(parsed.data.brandId, { notice: "cloned" }));
}

export async function exportContentTemplateAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = exportContentTemplateSchema.safeParse({
    brandId,
    id: String(formData.get("id") ?? ""),
  });
  if (!parsed.success) {
    redirect(brandIdSchema.safeParse(brandId).success ? templatesPath(brandId, { error: "INVALID_INPUT" }) : "/dashboard/content/templates?error=INVALID_INPUT");
  }
  const result = await exportContentTemplate(getConnection(), session.user.id, parsed.data);
  if ("error" in result) redirect(templatesPath(parsed.data.brandId, { error: result.error }));
  redirect(templatesPath(parsed.data.brandId, { notice: result.reason }));
}
