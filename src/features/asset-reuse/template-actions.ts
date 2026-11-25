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

export type TemplateCloneFeedback = "cloned" | "INVALID_INPUT" | "NOT_FOUND" | "GATE_REQUIRED" | "cloneUnconfirmed";

export async function cloneContentTemplateAction(
  _previous: TemplateCloneFeedback | null,
  formData: FormData,
): Promise<TemplateCloneFeedback> {
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
  if (!parsed.success) return "INVALID_INPUT";

  try {
    const result = await cloneContentTemplate(getConnection(), session.user.id, parsed.data);
    if ("error" in result) return result.error;
    revalidatePath("/dashboard/content/templates");
    return "cloned";
  } catch {
    console.error("content-template-clone-unconfirmed");
    return "cloneUnconfirmed";
  }
}

async function checkExport(ownerId: string, input: { brandId: string; id: string }) {
  try {
    return await exportContentTemplate(getConnection(), ownerId, input);
  } catch {
    console.error("content-template-export-check-unavailable");
    return { error: "SERVICE_UNAVAILABLE" } as const;
  }
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
  const result = await checkExport(session.user.id, parsed.data);
  const feedback: Record<string, string> = "error" in result ? { error: result.error } : { notice: result.reason };
  redirect(`${templatesPath(parsed.data.brandId, feedback)}#template-feedback`);
}
