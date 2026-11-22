"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { recordEntityReviews } from "./commands.ts";
import { reviewFacts } from "./contracts.ts";

const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT"]);

function finish(brandId: string, error?: string): never {
  const path = `/dashboard/brands/${brandId}/entity-reviews`;
  revalidatePath(path);
  redirect(error && pageErrors.has(error) ? `${path}?error=${error}` : path);
}

export async function recordEntityReviewAction(formData: FormData) {
  const session = await requireSession();
  const brandId = brandIdSchema.safeParse(String(formData.get("brandId") ?? ""));
  if (!brandId.success) redirect("/dashboard/brands");
  const fact = String(formData.get("fact") ?? "");
  const population = Number(formData.get("population"));
  const result = await recordEntityReviews(getConnection(), session.user.id, {
    brandId: brandId.data,
    method: String(formData.get("method") ?? ""),
    population,
    marks: [{
      observationId: String(formData.get("observationId") ?? ""),
      analysisVersionId: String(formData.get("analysisVersionId") ?? ""),
      reviewed: formData.get("reviewed") === "on",
      confirmed: formData.get("confirmed") === "on",
      fact: reviewFacts.find((item) => item === fact) ?? fact,
    }],
  });
  finish(brandId.data, "error" in result ? result.error : undefined);
}
