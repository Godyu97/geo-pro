import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { containsGuaranteeClaim } from "./strategy-template.ts";

export const planStatuses = ["draft", "settled"] as const;
export const itemStatuses = ["draft", "confirmed", "executed", "blocked"] as const;
export const blockReasons = ["fact_stale"] as const;

export const planStatusSchema = z.enum(planStatuses);
export const itemStatusSchema = z.enum(itemStatuses);
export const blockReasonSchema = z.enum(blockReasons);

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

const whole = (max: number) => z.number().int().min(0).max(max);

export const planItemInputSchema = z.strictObject({
  action: boundedText(200),
  factVersionId: brandIdSchema,
});

export const createAssistantPlanSchema = z.strictObject({
  brandId: brandIdSchema,
  material: boundedText(4000),
  budgetMinor: whole(1_000_000_000),
  successes: whole(1_000_000),
  items: z.array(planItemInputSchema).min(1).max(8),
}).refine((value) => new Set(value.items.map((item) => item.factVersionId)).size === value.items.length);

export const confirmAssistantPlanSchema = z.strictObject({
  itemIds: z.array(brandIdSchema).min(1).max(5),
}).refine((value) => new Set(value.itemIds).size === value.itemIds.length);

export const reviewNextStepMaxLength = 500;

export const reviewNextStepSchema = boundedText(reviewNextStepMaxLength).refine(
  (value) => !/[\r\n\u2028\u2029]/u.test(value) && !containsGuaranteeClaim(value),
);

export const saveAssistantPlanReviewSchema = z.strictObject({ nextStep: reviewNextStepSchema });

export const assistantErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_REVIEW: 400,
  PLAN_NOT_SETTLED: 409,
  REVIEW_ALREADY_SAVED: 409,
  AI_UNAVAILABLE: 503,
  AI_FAILED: 502,
  INVALID_MODEL_OUTPUT: 422,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type AssistantError = keyof typeof assistantErrors;
export type CreateAssistantPlanInput = z.infer<typeof createAssistantPlanSchema>;
export type ConfirmAssistantPlanInput = z.infer<typeof confirmAssistantPlanSchema>;
export type PlanItemInput = z.infer<typeof planItemInputSchema>;

export type AssistantPlanItemView = {
  id: string;
  position: number;
  action: string;
  factVersionId: string;
  factCurrent: boolean;
  status: (typeof itemStatuses)[number];
  blockReason: (typeof blockReasons)[number] | null;
};

export type AssistantPlanReviewView = {
  id: string;
  planId: string;
  executedCount: number;
  staleBlockedCount: number;
  nextStep: string;
  createdAt: string;
};

export type AssistantPlanView = {
  id: string;
  brandId: string;
  status: (typeof planStatuses)[number];
  ignored: boolean;
  budgetMinor: number;
  controlsUnchanged: true;
  strategy: { label: "observation"; guaranteed: false; successes: number };
  items: AssistantPlanItemView[];
  review: AssistantPlanReviewView | null;
};
