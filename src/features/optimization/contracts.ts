import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const gapTypes = [
  "fact_error",
  "name_confusion",
  "key_content_missing",
  "page_unreadable",
  "citation_gap",
  "needs_evidence",
] as const;
export const gapTypeSchema = z.enum(gapTypes);
export type GapType = z.infer<typeof gapTypeSchema>;

export const assumptionLevels = ["observed_absence", "verified", "pending"] as const;
export const assumptionLevelSchema = z.enum(assumptionLevels);

export const taskStatuses = [
  "todo",
  "doing",
  "blocked",
  "implemented",
  "retest_pending",
  "closed",
  "dismissed",
] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const priorityBuckets = ["urgent", "normal"] as const;
export const priorityBucketSchema = z.enum(priorityBuckets);

export const pagePublicStatuses = [
  "reachable",
  "restricted",
  "pending_verification",
  "not_applicable",
] as const;
export const pagePublicStatusSchema = z.enum(pagePublicStatuses);

export const optimizationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type OptimizationError = keyof typeof optimizationErrors;

export const generateFromEvidenceSchema = z.strictObject({
  action: z.literal("generate-from-evidence"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  observationId: brandIdSchema,
  businessImportance: z.int().min(1).max(3).default(2),
});
export type GenerateFromEvidenceInput = z.infer<typeof generateFromEvidenceSchema>;

const pageFixtureSchema = z.strictObject({
  url: z.string().url().max(2000),
  status: z.enum(["ok", "restricted", "error"]),
  title: z.string().max(500).optional(),
  body: z.string().max(20_000).optional(),
  accessCondition: z.string().max(500).optional(),
});

export const checkPagesSchema = z.strictObject({
  action: z.literal("check-pages"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  taskId: brandIdSchema.nullable().optional(),
  urls: z.array(z.string().url().max(2000)).min(1).max(5),
  /** Isolated acceptance only; never used for production claims. */
  fixtures: z.array(pageFixtureSchema).max(5).optional(),
});
export type CheckPagesInput = z.infer<typeof checkPagesSchema>;

export const updateTaskSchema = z.strictObject({
  action: z.literal("update-task"),
  brandId: brandIdSchema,
  taskId: brandIdSchema,
  operationId: brandIdSchema,
  status: taskStatusSchema.optional(),
  completionNote: z.string().min(1).max(2000).optional(),
  dismissReason: z.string().min(1).max(1000).optional(),
  retestConclusion: z.string().min(1).max(2000).optional(),
  manualRank: z.int().positive().optional(),
  reorderReason: z.string().min(1).max(1000).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const optimizationWriteSchema = z.discriminatedUnion("action", [
  generateFromEvidenceSchema,
  checkPagesSchema,
  updateTaskSchema,
]);
export type OptimizationWriteInput = z.infer<typeof optimizationWriteSchema>;

export const listTasksQuerySchema = z.strictObject({
  brandId: brandIdSchema,
  status: taskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
