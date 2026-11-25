import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { evidenceStrengthAllowed, evidenceStrengths, stripGuaranteeSentences } from "./strategy-template.ts";

export const strategyTemplateListLimit = 50;

export const evidenceStrengthSchema = z.enum(evidenceStrengths);

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

const successesSchema = z.number().int().min(0).max(1_000_000);
const noteTextSchema = boundedText(4000);

const templateFields = {
  brandId: brandIdSchema,
  industry: boundedText(120),
  samplingCondition: boundedText(500),
  successes: successesSchema,
  evidenceStrength: evidenceStrengthSchema,
  failureCase: boundedText(2000),
};

function strengthMatches(value: { successes: number; evidenceStrength: z.infer<typeof evidenceStrengthSchema> }) {
  return evidenceStrengthAllowed(value.successes, value.evidenceStrength);
}

export const explanationSchema = noteTextSchema.refine((value) => stripGuaranteeSentences(value) === value);

export const saveStrategyTemplateSchema = z.strictObject({
  ...templateFields,
  explanation: noteTextSchema,
}).refine(strengthMatches);

export const draftStrategyTemplateSchema = z.strictObject({
  ...templateFields,
  materials: noteTextSchema,
}).refine(strengthMatches);

export const strategyTemplateErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  AI_UNAVAILABLE: 503,
  AI_FAILED: 502,
  INVALID_MODEL_OUTPUT: 422,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type StrategyTemplateError = keyof typeof strategyTemplateErrors;
export type SaveStrategyTemplateInput = z.infer<typeof saveStrategyTemplateSchema>;
export type DraftStrategyTemplateInput = z.infer<typeof draftStrategyTemplateSchema>;
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

export type StrategyTemplateView = {
  id: string;
  brandId: string;
  industry: string;
  samplingCondition: string;
  evidenceStrength: EvidenceStrength;
  failureCase: string;
  explanation: string;
  label: "observation";
  guaranteed: 0;
  successes: number;
  createdAt: string;
  updatedAt: string;
};
