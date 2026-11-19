import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema } from "../quotas/contracts.ts";

export const monitoringTracks = ["model_api", "consumer_ui"] as const;
export const monitoringTrackSchema = z.enum(monitoringTracks);
export const repeatSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const previewTtlMs = 15 * 60 * 1000;

const ceilingSchema = z.strictObject({
  currency: quotaCurrencySchema,
  upperMinor: minorAmountSchema,
}).nullable();

const channelRefSchema = z.strictObject({
  channelId: brandIdSchema,
  version: z.int().positive(),
});

export const previewRequestSchema = z.strictObject({
  action: z.literal("preview"),
  brandId: brandIdSchema,
  track: monitoringTrackSchema,
  promptSetId: brandIdSchema,
  repeats: repeatSchema,
  requestedNetworkMode: z.enum(networkModes),
  channelIds: z.array(brandIdSchema).min(1).max(5),
  ceiling: ceilingSchema,
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const previewSnapshotSchema = z.strictObject({
  brandId: brandIdSchema,
  track: monitoringTrackSchema,
  promptSetId: brandIdSchema,
  promptSetVersion: z.int().positive(),
  repeats: repeatSchema,
  requestedNetworkMode: z.enum(networkModes),
  channels: z.array(channelRefSchema).min(1).max(5),
  grantVersion: z.int().positive().nullable(),
  ceiling: ceilingSchema,
  questionCount: z.int().positive(),
  naturalCount: z.int().nonnegative(),
  region: z.string().length(2),
  language: z.string().min(2).max(40),
  previewedAt: z.iso.datetime({ precision: 3 }),
  expiresAt: z.iso.datetime({ precision: 3 }),
});
export type PreviewSnapshot = z.infer<typeof previewSnapshotSchema>;

export const acceptRequestSchema = previewSnapshotSchema.extend({
  action: z.literal("accept"),
  operationId: brandIdSchema,
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AcceptRequest = z.infer<typeof acceptRequestSchema>;

export const runStatuses = ["queued", "running", "paused", "succeeded", "partial", "failed", "cancelled"] as const;
export const slotStatuses = ["queued", "running", "paused", "succeeded", "failed", "cancelled", "reconciliation_required"] as const;
export const attemptKinds = ["sampling", "analysis"] as const;
export const attemptDispositions = ["pending", "adopted", "safe_failure", "unknown", "late", "analysis_reuse"] as const;

export const monitoringErrors = {
  SESSION_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_INPUT: 400,
  OPERATION_CONFLICT: 409, CHANNEL_UNVERIFIED: 409, PREVIEW_EXPIRED: 409,
  VERSION_CONFLICT: 409, QUOTA_INSUFFICIENT: 409, NO_TRUSTED_CEILING: 409,
  EMAIL_UNVERIFIED: 409, NOT_READY: 409, NOT_ENTITLED: 409, REAL_CHANNEL_CLOSED: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type MonitoringError = keyof typeof monitoringErrors;

export const monitoringNextSteps = [
  "adjust-scope", "refresh-preview", "verify-email", "verify-channel",
  "confirm-ceiling", "request-quota", "add-primary", "await-channel",
] as const;

export const runControlSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("pause") }),
  z.strictObject({ action: z.literal("continue") }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("redo-analysis"), slotId: brandIdSchema }),
  z.strictObject({
    action: z.literal("reconcile"),
    attemptId: brandIdSchema,
    actualMinor: minorAmountSchema.nullable(),
  }),
]);
export type RunControl = z.infer<typeof runControlSchema>;
export type MonitoringNextStep = (typeof monitoringNextSteps)[number];
