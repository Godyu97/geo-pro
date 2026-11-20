import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const templateKinds = ["fact_faq", "scenario_solution", "verifiable_comparison"] as const;
export const templateKindSchema = z.enum(templateKinds);
export type TemplateKind = z.infer<typeof templateKindSchema>;

export const briefStatuses = ["draft", "confirmed", "invalidated"] as const;
export const briefStatusSchema = z.enum(briefStatuses);
export type BriefStatus = z.infer<typeof briefStatusSchema>;

export const batchStatuses = ["queued", "running", "paused", "partial", "completed", "cancelled"] as const;
export const batchStatusSchema = z.enum(batchStatuses);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const unitStatuses = ["queued", "running", "succeeded", "failed", "blocked"] as const;
export const unitStatusSchema = z.enum(unitStatuses);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

export const contentGapCodes = [
  "audienceMissing",
  "targetGapMissing",
  "boundaryMissing",
  "sourceMissing",
  "primaryPageMissing",
  "conversionActionMissing",
  "templateMissing",
  "titlesMissing",
  "factsMissing",
  "competitorSourceMissing",
] as const;
export const contentGapCodeSchema = z.enum(contentGapCodes);
export type ContentGapCode = z.infer<typeof contentGapCodeSchema>;

export const contentErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  EVIDENCE_REQUIRED: 422,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type ContentError = keyof typeof contentErrors;

export const briefDraftFieldsSchema = z.strictObject({
  audience: z.string().max(500),
  targetGap: z.string().max(1000),
  applicableBoundary: z.string().max(1000),
  primaryPage: z.string().max(2000),
  conversionAction: z.string().max(500),
  templateKind: templateKindSchema,
  titleCandidates: z.array(z.string().min(1).max(200)).max(3),
  factVersionIds: z.array(brandIdSchema).max(20),
  competitorSource: z.string().max(2000).nullable().optional(),
});
export type BriefDraftFields = z.infer<typeof briefDraftFieldsSchema>;

export const saveBriefDraftSchema = z.strictObject({
  action: z.literal("save-brief-draft"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  briefId: brandIdSchema.optional(),
  planId: brandIdSchema.nullable().optional(),
  optimizationTaskId: brandIdSchema.nullable().optional(),
  questionCluster: z.string().min(1).max(128).optional(),
  fields: briefDraftFieldsSchema,
});
export type SaveBriefDraftInput = z.infer<typeof saveBriefDraftSchema>;

export const confirmBriefSchema = z.strictObject({
  action: z.literal("confirm-brief"),
  brandId: brandIdSchema,
  briefId: brandIdSchema,
  operationId: brandIdSchema,
});
export type ConfirmBriefInput = z.infer<typeof confirmBriefSchema>;

export const generateBatchSchema = z.strictObject({
  action: z.literal("generate-batch"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  briefIds: z.array(brandIdSchema).min(1).max(5),
  fixtures: z.strictObject({
    failBriefIds: z.array(brandIdSchema).max(5).optional(),
    /** Process this many units then leave the rest queued and pause the batch. */
    pauseAfter: z.int().min(0).max(5).optional(),
  }).optional(),
});
export type GenerateBatchInput = z.infer<typeof generateBatchSchema>;

export const batchControlSchema = z.strictObject({
  action: z.enum(["pause-batch", "resume-batch", "cancel-batch", "retry-failed"]),
  brandId: brandIdSchema,
  batchId: brandIdSchema,
  operationId: brandIdSchema,
});
export type BatchControlInput = z.infer<typeof batchControlSchema>;

export const contentWriteSchema = z.discriminatedUnion("action", [
  saveBriefDraftSchema,
  confirmBriefSchema,
  generateBatchSchema,
  batchControlSchema,
]);
export type ContentWriteInput = z.infer<typeof contentWriteSchema>;

export const listContentQuerySchema = z.strictObject({
  brandId: brandIdSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListContentQuery = z.infer<typeof listContentQuerySchema>;
