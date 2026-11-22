import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

const count = z.number().int().min(0).max(1_000_000_000);

export const leadQualityErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const saveLeadRuleSchema = z.strictObject({
  brandId: brandIdSchema,
  requiresRealNeed: z.boolean(),
  requiresIndustry: z.boolean(),
  requiresFollowUp: z.boolean(),
});

export const qualifyLeadRuleSchema = z.strictObject({
  brandId: brandIdSchema,
  ruleId: brandIdSchema,
  realNeed: z.boolean(),
  targetIndustry: z.boolean(),
  followUp: z.boolean(),
});

export const leadRuleCommandSchema = z.union([qualifyLeadRuleSchema, saveLeadRuleSchema]);

export const recordLeadObservationSchema = z.strictObject({
  brandId: brandIdSchema,
  identifiedReferrals: count,
  sessionDenominator: count.nullable(),
  selfReported: count,
  crawlerVisits: count,
  answerCitations: count,
});

export type LeadQualityError = keyof typeof leadQualityErrors;
export type SaveLeadRuleInput = z.infer<typeof saveLeadRuleSchema>;
export type QualifyLeadRuleInput = z.infer<typeof qualifyLeadRuleSchema>;
export type LeadRuleCommand = z.infer<typeof leadRuleCommandSchema>;
export type RecordLeadObservationInput = z.infer<typeof recordLeadObservationSchema>;

export function isQualifyLeadRule(command: LeadRuleCommand): command is QualifyLeadRuleInput {
  return "ruleId" in command;
}
