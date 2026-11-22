import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const captureMinuteMax = 100_000;
export const captureCitationMax = 1_000;
export const capturePromptMax = 100;

const promptIdSchema = z.string().trim().pipe(brandIdSchema);
export const promptIdsSchema = z.array(promptIdSchema).min(1).max(capturePromptMax).superRefine((ids, ctx) => {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate" });
});

const minutesSchema = z.number().int().min(0).max(captureMinuteMax).nullable();

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
});

export const confirmCaptureAttemptSchema = z.strictObject({
  confirmed: z.boolean(),
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
