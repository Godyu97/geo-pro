import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { reviewClaim } from "./rules.ts";

export const reviewFacts = ["active", "expired", "conflict"] as const;
export const reviewFactSchema = z.enum(reviewFacts);

const methodSchema = z.string().trim().min(1).max(200).refine((value) => value.isWellFormed() && !value.includes("\0"));

export const entityReviewMarkSchema = z.strictObject({
  observationId: brandIdSchema,
  analysisVersionId: brandIdSchema,
  reviewed: z.boolean(),
  confirmed: z.boolean(),
  fact: reviewFactSchema,
});

const batchFields = {
  method: methodSchema,
  population: z.number().int().min(1).max(100_000),
  marks: z.array(entityReviewMarkSchema).min(1).max(100),
};

type ReviewBatch = {
  population: number;
  marks: Array<z.infer<typeof entityReviewMarkSchema>>;
};

function validateReviewBatch(value: ReviewBatch, ctx: z.RefinementCtx) {
  const reviewed = value.marks.filter((mark) => mark.reviewed).length;
  const confirmed = value.marks.filter((mark) => mark.confirmed).length;
  if (confirmed > reviewed || reviewed > value.population) {
    ctx.addIssue({ code: "custom", path: ["marks"], message: "confirmed_exceeds_reviewed" });
  }
  const seen = new Set<string>();
  for (const mark of value.marks) {
    const claim = reviewClaim({ normalizedEqual: null, fact: mark.fact });
    if (mark.confirmed && (mark.fact !== "active" || claim.autoError)) {
      ctx.addIssue({ code: "custom", path: ["marks"], message: "fact_not_confirmable" });
    }
    const key = `${mark.observationId}:${mark.analysisVersionId}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["marks"], message: "duplicate_sample" });
    seen.add(key);
  }
}

export const entityReviewBodySchema = z.strictObject(batchFields).superRefine(validateReviewBatch);
export const entityReviewWriteSchema = z.strictObject({
  brandId: brandIdSchema,
  ...batchFields,
}).superRefine(validateReviewBatch);

export const entityReviewErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type EntityReviewError = keyof typeof entityReviewErrors;
export type EntityReviewWriteInput = z.infer<typeof entityReviewWriteSchema>;

export const claimExtractBodySchema = z.strictObject({
  observationId: brandIdSchema,
});

export const claimExtractErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  AI_UNAVAILABLE: 503,
  INVALID_MODEL_OUTPUT: 422,
  AI_FAILED: 503,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ClaimExtractError = keyof typeof claimExtractErrors;

const revisionFields = {
  observationId: brandIdSchema,
  priorAnalysisId: brandIdSchema,
  sameSurfaceName: z.boolean(),
  confirmedDifferentEntity: z.boolean(),
};

export const entityDisambiguationBodySchema = z.strictObject(revisionFields);
export const entityDisambiguationWriteSchema = z.strictObject({
  brandId: brandIdSchema,
  ...revisionFields,
});

const correctionFields = {
  observationId: brandIdSchema,
  actionDone: z.boolean(),
  retestStillWrong: z.boolean(),
};

export const entityCorrectionBodySchema = z.strictObject(correctionFields);
export const entityCorrectionWriteSchema = z.strictObject({
  brandId: brandIdSchema,
  ...correctionFields,
});

export const entityCorrectionErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const correctionActions = ["open", "actioned"] as const;
export const correctionEffects = ["open", "pending_retest", "unresolved"] as const;

export type EntityCorrectionError = keyof typeof entityCorrectionErrors;
export type EntityDisambiguationWriteInput = z.infer<typeof entityDisambiguationWriteSchema>;
export type EntityCorrectionWriteInput = z.infer<typeof entityCorrectionWriteSchema>;
