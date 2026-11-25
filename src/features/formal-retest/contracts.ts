import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { confounderFactors, controlLabel, type Checkpoint } from "./rules.ts";

export const checkpoints = ["d7", "d14", "d28"] as const satisfies readonly Checkpoint[];
export const observationStatuses = ["observing", "checkpoint_due"] as const;
export const checkpointModes = ["progress", "formal", "exploratory"] as const;

export const checkpointSchema = z.enum(checkpoints);
export const observationStatusSchema = z.enum(observationStatuses);
export const checkpointModeSchema = z.enum(checkpointModes);
export const frozenSetIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const questionIdSchema = frozenSetIdSchema;

export const calendarDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
});

const countSchema = z.number().int().min(0).max(500);
const slotCountSchema = z.number().int().min(0).max(50000);

export const createFormalObservationSchema = z.strictObject({
  brandId: brandIdSchema,
  frozenSetId: frozenSetIdSchema,
  effectiveOn: calendarDaySchema,
  frozenNonBrandCount: countSchema.refine((value) => value >= 1),
});

export const formalExclusionReasons = [
  "missing_window",
  "low_eligible_coverage",
  "low_mention_coverage",
  "low_recommendation_coverage",
  "incomplete_citations",
  "low_citation_coverage",
  "no_official_website",
  "caller_excluded",
] as const;

export const formalInsufficiencyReasons = [
  "missing_samples",
  "overall_coverage_below_90",
  "mention_common_below_80",
  "mention_coverage_below_80",
  "recommendation_common_below_80",
  "recommendation_coverage_below_80",
  "citation_common_below_80",
  "citation_coverage_below_80",
  "no_official_website",
] as const;

export const formalGateKeys = ["coverage", "mention", "recommendation", "citation"] as const;

const exclusionReasonSchema = z.enum(formalExclusionReasons);
const insufficiencyReasonSchema = z.enum(formalInsufficiencyReasons);
const gateKeySchema = z.enum(formalGateKeys);
const rateSchema = z.number().min(0).max(1).nullable();

const windowCoverageReadingSchema = z.object({
  planned: slotCountSchema,
  valid: slotCountSchema,
  eligible: slotCountSchema,
  rate: rateSchema,
});

const metricJudgmentReadingSchema = z.object({
  judged: slotCountSchema,
  eligible: slotCountSchema,
  rate: rateSchema,
});

const citationJudgmentReadingSchema = z.object({
  judged: slotCountSchema,
  completeCitations: slotCountSchema,
  eligible: slotCountSchema,
  jcOverE: rateSchema,
  cOverE: rateSchema,
  jcOverC: rateSchema,
});

const metricExcludedItemSchema = z.object({
  questionId: questionIdSchema,
  reason: exclusionReasonSchema,
});

export const formalCheckpointEvaluationSchema = z.object({
  missingSamples: z.boolean(),
  hasOfficialWebsite: z.boolean(),
  slotIds: z.array(questionIdSchema),
  coverage: z.object({
    before: windowCoverageReadingSchema,
    after: windowCoverageReadingSchema,
    passed: z.boolean(),
  }),
  metrics: z.object({
    mention: z.object({
      passed: z.boolean(),
      comparableCount: countSchema,
      frozenNonBrandCount: countSchema,
      before: metricJudgmentReadingSchema,
      after: metricJudgmentReadingSchema,
      excluded: z.array(metricExcludedItemSchema),
    }),
    recommendation: z.object({
      passed: z.boolean(),
      comparableCount: countSchema,
      frozenNonBrandCount: countSchema,
      before: metricJudgmentReadingSchema,
      after: metricJudgmentReadingSchema,
      excluded: z.array(metricExcludedItemSchema),
    }),
    citation: z.object({
      passed: z.boolean(),
      applicable: z.boolean(),
      comparableCount: countSchema,
      frozenNonBrandCount: countSchema,
      before: citationJudgmentReadingSchema,
      after: citationJudgmentReadingSchema,
      excluded: z.array(metricExcludedItemSchema),
    }),
  }),
  insufficientMetrics: z.array(gateKeySchema),
  insufficiencyReasons: z.array(insufficiencyReasonSchema),
  excludedQuestions: z.array(z.object({
    questionId: questionIdSchema,
    reasons: z.array(exclusionReasonSchema),
  })),
});

export const recordFormalCheckpointSchema = z.strictObject({
  checkpoint: checkpointSchema,
  today: calendarDaySchema,
  comparableQuestions: countSchema.optional().default(0),
  excluded: z.array(questionIdSchema).max(40).optional().default([]),
  requestedMode: z.literal("formal"),
});

export const confounderFactorSchema = z.enum(confounderFactors);

export const appendFormalConfounderSchema = z.strictObject({
  factor: confounderFactorSchema,
  note: z.string().trim().min(1).max(400).refine((value) => value.isWellFormed() && !value.includes("\0")),
});

export const controlPageKeySchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 300 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
});

export const registerFormalControlSchema = z.strictObject({
  pageKey: controlPageKeySchema,
  label: z.literal(controlLabel),
});

export const formalObservationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  THRESHOLD_REJECTED: 409,
  CHECKPOINT_EXISTS: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type FormalObservationError = keyof typeof formalObservationErrors;
export type CreateFormalObservationInput = z.infer<typeof createFormalObservationSchema>;
export type RecordFormalCheckpointInput = z.infer<typeof recordFormalCheckpointSchema>;
export type AppendFormalConfounderInput = z.infer<typeof appendFormalConfounderSchema>;
export type RegisterFormalControlInput = z.infer<typeof registerFormalControlSchema>;
