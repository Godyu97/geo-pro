import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { citationSetStates, observedRegionSchema, triStateSchema } from "../evidence/contracts.ts";

export const captureMinuteMax = 100_000;
export const captureCitationMax = 1_000;
export const capturePromptMax = 100;
export const captureCitationUrlMax = 50;

const promptIdSchema = z.string().trim().pipe(brandIdSchema);
export const promptIdsSchema = z.array(promptIdSchema).min(1).max(capturePromptMax).superRefine((ids, ctx) => {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate" });
});

export const captureCitationUrlSchema = z.string().trim().url().max(2000).refine((value) => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
});

const minutesSchema = z.number().int().min(0).max(captureMinuteMax).nullable();
const optionalRegionSchema = z.string().trim().length(2).optional();
const optionalLocatorSchema = z.string().trim().max(500).nullable().optional();
const optionalCollectorSchema = z.string().trim().max(128).nullable().optional();
const optionalAnswerSchema = z.string().max(8000).nullable().optional();
const optionalQuestionTextSchema = z.string().trim().min(1).max(4000).nullable().optional();

export const createCaptureSheetSchema = z.strictObject({
  brandId: brandIdSchema,
  promptIds: promptIdsSchema,
  assistedMinutes: minutesSchema,
  manualMinutes: minutesSchema,
  citationsComplete: z.boolean(),
});

export const recordCaptureAttemptSchema = z.strictObject({
  sheetId: brandIdSchema,
  blockedBy: z.enum(["captcha", "login"]).nullable(),
  citationCount: z.number().int().min(0).max(captureCitationMax),
  promptId: brandIdSchema.nullable().optional(),
  questionText: optionalQuestionTextSchema,
  answerText: optionalAnswerSchema,
  citations: z.array(captureCitationUrlSchema).max(captureCitationUrlMax).optional(),
  citationSetState: z.enum(citationSetStates).optional(),
  locatorRef: optionalLocatorSchema,
  collectorId: optionalCollectorSchema,
  requestedNetworkMode: z.enum(networkModes).optional(),
  targetRegion: optionalRegionSchema,
  observedRegion: observedRegionSchema.optional(),
  newSession: triStateSchema.optional(),
  productMode: triStateSchema.optional(),
});

export const confirmCaptureAttemptSchema = z.strictObject({
  confirmed: z.boolean(),
  promptId: brandIdSchema.nullable().optional(),
  questionText: optionalQuestionTextSchema,
  answerText: optionalAnswerSchema,
  citations: z.array(captureCitationUrlSchema).max(captureCitationUrlMax).optional(),
  citationSetState: z.enum(citationSetStates).optional(),
  locatorRef: optionalLocatorSchema,
  collectorId: optionalCollectorSchema,
  requestedNetworkMode: z.enum(networkModes).optional(),
  targetRegion: optionalRegionSchema,
  observedRegion: observedRegionSchema.optional(),
  newSession: triStateSchema.optional(),
  productMode: triStateSchema.optional(),
  contested: z.boolean().optional(),
});

export const degradeCaptureSheetSchema = z.strictObject({
  structureChanged: z.boolean(),
});

export const captureErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type CaptureError = keyof typeof captureErrors;
export type CreateCaptureSheetInput = z.infer<typeof createCaptureSheetSchema>;
export type RecordCaptureAttemptInput = z.infer<typeof recordCaptureAttemptSchema>;
export type ConfirmCaptureAttemptInput = z.infer<typeof confirmCaptureAttemptSchema>;
export type DegradeCaptureSheetInput = z.infer<typeof degradeCaptureSheetSchema>;
