"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { recordEntityReviews } from "./commands.ts";
import { reviewFacts } from "./contracts.ts";
import { confirmEntityDisambiguation, recordEntityCorrection } from "./revisions.ts";

const pageErrors = new Set(["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"]);

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

const correctionPageErrors = new Set(["NOT_FOUND", "FORBIDDEN", "disambiguationInvalid", "correctionInvalid"]);

function finishCorrection(brandId: string, error?: string): never {
  const path = `/dashboard/brands/${brandId}/entity-corrections`;
  revalidatePath(path);
  redirect(error && correctionPageErrors.has(error) ? `${path}?error=${error}` : path);
}

export async function confirmDisambiguationAction(formData: FormData) {
  const session = await requireSession();
  const brandId = brandIdSchema.safeParse(String(formData.get("brandId") ?? ""));
  if (!brandId.success) redirect("/dashboard/brands");
  const result = await confirmEntityDisambiguation(getConnection(), session.user.id, {
    brandId: brandId.data,
    observationId: String(formData.get("observationId") ?? ""),
    priorAnalysisId: String(formData.get("priorAnalysisId") ?? ""),
    sameSurfaceName: formData.get("sameSurfaceName") === "on",
    confirmedDifferentEntity: formData.get("confirmedDifferentEntity") === "on",
  });
  const error = "error" in result
    ? result.error === "INVALID_INPUT" ? "disambiguationInvalid" : result.error
    : undefined;
  finishCorrection(brandId.data, error);
}

export async function recordCorrectionAction(formData: FormData) {
  const session = await requireSession();
  const brandId = brandIdSchema.safeParse(String(formData.get("brandId") ?? ""));
  if (!brandId.success) redirect("/dashboard/brands");
  const result = await recordEntityCorrection(getConnection(), session.user.id, {
    brandId: brandId.data,
    observationId: String(formData.get("observationId") ?? ""),
    actionDone: formData.get("actionDone") === "on",
    retestStillWrong: formData.get("retestStillWrong") === "on",
  });
  const error = "error" in result
    ? result.error === "INVALID_INPUT" ? "correctionInvalid" : result.error
    : undefined;
  finishCorrection(brandId.data, error);
}
