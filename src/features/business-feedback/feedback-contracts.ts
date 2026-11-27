import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const qualificationStatuses = ["qualified", "disqualified", "unknown"] as const;
export const followUpOutcomes = ["unknown", "pending", "contacted", "won", "lost"] as const;

export const recordLeadFeedbackSchema = z.strictObject({
  brandId: brandIdSchema,
  leadId: brandIdSchema,
  ruleId: brandIdSchema,
  expectedRevision: z.number().int().nonnegative().max(2_147_483_646),
  realNeed: z.boolean().nullable(),
  targetIndustry: z.boolean().nullable(),
  canFollowUp: z.boolean().nullable(),
  outcome: z.enum(followUpOutcomes),
});

export type RecordLeadFeedbackInput = z.infer<typeof recordLeadFeedbackSchema>;
