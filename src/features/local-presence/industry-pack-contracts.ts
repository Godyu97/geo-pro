import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { maxDraftQuestions } from "../prompts/contracts.ts";

export const industryPackListLimit = 50;
export const industryPackQuestionListLimit = 200;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
  });
}

export const industryPackScopeSchema = boundedText(400);
export const industryPackMaterialsSchema = boundedText(4000);
export const industryPackQuestionBodySchema = boundedText(500);
export const industryPackScenarioSchema = z.enum(["general", "regulated"]);
export const industryPackStatusSchema = z.enum(["draft", "reviewed", "available", "retired"]);

export const registerIndustryPackSchema = z.strictObject({
  brandId: brandIdSchema,
  scope: industryPackScopeSchema,
  coversRegulated: z.boolean(),
});

export const draftIndustryPackQuestionsSchema = z.strictObject({
  scenario: industryPackScenarioSchema,
  materials: industryPackMaterialsSchema,
});

export const industryPackCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("transition"),
    from: industryPackStatusSchema,
    to: industryPackStatusSchema.exclude(["draft"]),
  }),
  z.strictObject({
    action: z.literal("adopt"),
    scenario: industryPackScenarioSchema,
    questionIds: z.array(brandIdSchema).min(1).max(maxDraftQuestions)
      .refine((ids) => new Set(ids).size === ids.length),
    acceptSimilar: z.boolean().default(false),
  }),
]);

export const industryPackErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SCOPE_BLOCKED: 409,
  STATUS_CONFLICT: 409,
  EMPTY_PACK: 409,
  DRAFT_CONFLICT: 409,
  DRAFT_LIMIT: 422,
  DRAFT_DUPLICATE: 422,
  DRAFT_SIMILAR: 422,
  DRAFT_INVALID: 422,
  PROMPTS_UNAVAILABLE: 403,
  AI_UNAVAILABLE: 503,
  AI_FAILED: 502,
  INVALID_MODEL_OUTPUT: 422,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type IndustryPackError = keyof typeof industryPackErrors;
export type RegisterIndustryPackInput = z.infer<typeof registerIndustryPackSchema>;
export type DraftIndustryPackQuestionsInput = z.infer<typeof draftIndustryPackQuestionsSchema>;
export type IndustryPackScenario = z.infer<typeof industryPackScenarioSchema>;
export type IndustryPackStatus = z.infer<typeof industryPackStatusSchema>;
export type IndustryPackCommand = z.infer<typeof industryPackCommandSchema>;

export type IndustryPackQuestionView = {
  id: string;
  packId: string;
  body: string;
  status: "draft";
  createdAt: string;
};

export type IndustryPackView = {
  id: string;
  brandId: string;
  scope: string;
  coversRegulated: boolean;
  status: IndustryPackStatus;
  canWrite: boolean;
  createdAt: string;
  questions: IndustryPackQuestionView[];
};

export type IndustryPackList = {
  brands: { id: string; canWrite: boolean }[];
  packs: IndustryPackView[];
};
