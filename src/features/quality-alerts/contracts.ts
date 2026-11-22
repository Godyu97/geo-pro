import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import type { AlertKind, AlertReason, AlertStatus } from "./rules.ts";

export const alertKinds = ["data_quality", "trend"] as const satisfies readonly AlertKind[];
export const alertStatuses = ["open", "acknowledged", "snoozed", "resolved"] as const satisfies readonly AlertStatus[];
export const alertReasons = [
  "coverage_insufficient",
  "citation_field_changed",
  "mode_changed",
  "recommendation_drop",
] as const satisfies readonly AlertReason[];

export const alertKindSchema = z.enum(alertKinds);
export const alertStatusSchema = z.enum(alertStatuses);
export const alertReasonSchema = z.enum(alertReasons);
export const alertWindowIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const rateSchema = z.number().min(0).max(1).refine((value) => Number.isFinite(value));

export const windowSampleSchema = z.strictObject({
  windowId: alertWindowIdSchema,
  completed: z.boolean(),
  coverageSufficient: z.boolean(),
  citationFieldChanged: z.boolean(),
  modeChanged: z.boolean(),
  recommendationRate: rateSchema.nullable(),
});

export const recordQualityAlertSchema = z.strictObject({
  action: z.literal("record"),
  brandId: brandIdSchema,
  windows: z.array(windowSampleSchema).min(1).max(16),
});

export const acknowledgeQualityAlertSchema = z.strictObject({
  action: z.literal("acknowledge"),
  alertId: brandIdSchema,
});

export const snoozeQualityAlertSchema = z.strictObject({
  action: z.literal("snooze"),
  alertId: brandIdSchema,
});

export const qualityAlertWriteSchema = z.discriminatedUnion("action", [
  recordQualityAlertSchema,
  acknowledgeQualityAlertSchema,
  snoozeQualityAlertSchema,
]);

export const qualityAlertErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  ALERT_STATE_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type QualityAlertError = keyof typeof qualityAlertErrors;
export type RecordQualityAlertInput = z.infer<typeof recordQualityAlertSchema>;
export type AcknowledgeQualityAlertInput = z.infer<typeof acknowledgeQualityAlertSchema>;
export type SnoozeQualityAlertInput = z.infer<typeof snoozeQualityAlertSchema>;
