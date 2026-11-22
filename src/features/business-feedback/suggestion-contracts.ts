import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

function boundedText(min: number, max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= min && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

export const leadSuggestionErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_INPUT: 400,
  AI_UNAVAILABLE: 503,
  AI_FAILED: 502,
  INVALID_MODEL_OUTPUT: 422,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const leadSuggestionStatuses = ["draft", "accepted", "discarded"] as const;

export const draftLeadSuggestionsSchema = z.strictObject({
  brandId: brandIdSchema,
  summary: boundedText(8, 2000),
});

export const decideLeadSuggestionSchema = z.strictObject({
  action: z.enum(["accept", "discard"]),
});

export type LeadSuggestionError = keyof typeof leadSuggestionErrors;
export type LeadSuggestionStatus = (typeof leadSuggestionStatuses)[number];
export type DraftLeadSuggestionsInput = z.infer<typeof draftLeadSuggestionsSchema>;
export type DecideLeadSuggestionInput = z.infer<typeof decideLeadSuggestionSchema>;
