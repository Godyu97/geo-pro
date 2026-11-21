import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const reportTracks = ["model_api", "consumer_ui"] as const;
export const reportTrackSchema = z.enum(reportTracks);

export const retestKinds = ["exploratory", "d7_reminder", "diagnostic"] as const;
export const retestKindSchema = z.enum(retestKinds);

export const retestStatuses = ["scheduled", "due", "running", "completed", "inconclusive", "blocked"] as const;
export const retestStatusSchema = z.enum(retestStatuses);

export const reportIntents = ["business_loop", "diagnostic"] as const;
export const reportIntentSchema = z.enum(reportIntents);

export const snapshotStatuses = ["created", "superseded"] as const;
export const snapshotStatusSchema = z.enum(snapshotStatuses);

export const reportGrades = ["exploratory", "incomparable"] as const;
export const reportGradeSchema = z.enum(reportGrades);

export const reportConclusions = ["improved", "unchanged", "declined", "inconclusive", "incomparable"] as const;
export const reportConclusionSchema = z.enum(reportConclusions);

export const reportErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  WINDOW_NOT_DUE: 409,
  LOOP_NOT_READY: 409,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type ReportError = keyof typeof reportErrors;

const opaqueId = z.string().uuid();
const iso = z.iso.datetime({ precision: 3 });

export const windowSampleSchema = z.strictObject({
  observationId: opaqueId,
  queryId: z.string().min(1).max(120),
  queryVersion: z.string().min(1).max(120),
  track: reportTrackSchema,
  channelVersion: z.string().min(1).max(120),
  protocolVersion: z.string().min(1).max(120),
  analysisRuleVersion: z.string().min(1).max(120),
  region: z.string().min(2).max(8),
  entityVersion: z.number().int().positive(),
  judgable: z.boolean(),
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(0),
  sourceMissing: z.boolean().optional(),
  brandQuestion: z.boolean().optional(),
});
export type WindowSample = z.infer<typeof windowSampleSchema>;

export const comparisonWindowSchema = z.strictObject({
  start: z.string().min(1),
  endExclusive: z.string().min(1),
  samples: z.array(windowSampleSchema).min(1).max(500),
});

export const requestRetestSchema = z.strictObject({
  action: z.literal("request-retest"),
  brandId: brandIdSchema,
  operationId: opaqueId,
  kind: retestKindSchema,
  intent: reportIntentSchema,
  track: reportTrackSchema,
  timezone: z.string().min(1).max(80).default("Asia/Shanghai"),
  entityVersion: z.number().int().positive(),
  before: comparisonWindowSchema,
  after: comparisonWindowSchema.optional(),
  publicationId: opaqueId.optional(),
  effectiveAt: iso.optional(),
  locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  metric: z.string().min(1).max(80).default("recommendation_rate"),
});
export type RequestRetestInput = z.infer<typeof requestRetestSchema>;

export const generateReportSchema = z.strictObject({
  action: z.literal("generate-report"),
  brandId: brandIdSchema,
  operationId: opaqueId,
  retestId: opaqueId,
  before: comparisonWindowSchema,
  after: comparisonWindowSchema,
  publicationId: opaqueId.optional(),
  effectiveAt: iso.optional(),
  locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  metric: z.string().min(1).max(80).default("recommendation_rate"),
  brandName: z.string().min(1).max(120).optional(),
});
export type GenerateReportInput = z.infer<typeof generateReportSchema>;

export const reviseReportSchema = z.strictObject({
  action: z.literal("revise-report"),
  brandId: brandIdSchema,
  operationId: opaqueId,
  snapshotId: opaqueId,
  before: comparisonWindowSchema,
  after: comparisonWindowSchema,
  locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  metric: z.string().min(1).max(80).default("recommendation_rate"),
  brandName: z.string().min(1).max(120).optional(),
  note: z.string().min(1).max(500).optional(),
});
export type ReviseReportInput = z.infer<typeof reviseReportSchema>;

export const reportWriteSchema = z.discriminatedUnion("action", [
  requestRetestSchema,
  generateReportSchema,
  reviseReportSchema,
]);
export type ReportWriteInput = z.infer<typeof reportWriteSchema>;

export const listReportsQuerySchema = z.strictObject({
  brandId: brandIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
