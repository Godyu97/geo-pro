import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema } from "../quotas/contracts.ts";
import { isTimeZone } from "./due-window.ts";
import type { PlanPhase, SamplingSlotStatus } from "./rules.ts";

export const trendThresholdPpSchema = z.number().finite().positive();

export const planPhases = ["draft", "active", "paused", "ended"] as const satisfies readonly PlanPhase[];
export const slotStatuses = ["scheduled", "completed", "failed", "paused"] as const satisfies readonly SamplingSlotStatus[];

export const planPhaseSchema = z.enum(planPhases);
export const slotStatusSchema = z.enum(slotStatuses);
export const channelIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const windowIdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instantSchema = z.iso.datetime({ precision: 3 });

export const samplingSlotInputSchema = z.strictObject({
  id: brandIdSchema,
  channelId: channelIdSchema,
  at: instantSchema,
  status: slotStatusSchema,
  manual: z.boolean(),
  costMinor: minorAmountSchema,
});

export const createSamplingPlanSchema = z.strictObject({
  action: z.literal("create"),
  brandId: brandIdSchema,
  phase: planPhaseSchema,
  currency: quotaCurrencySchema,
  budgetMinor: minorAmountSchema,
  spentMinor: minorAmountSchema,
  pendingMinor: minorAmountSchema,
  nextAt: instantSchema,
  trendThresholdPp: trendThresholdPpSchema.optional(),
  slots: z.array(samplingSlotInputSchema).min(1).max(32),
});

export const transitionSamplingPlanSchema = z.strictObject({
  action: z.literal("transition"),
  planId: brandIdSchema,
  phase: planPhaseSchema,
});

export const arriveSamplingPlanSchema = z.strictObject({
  action: z.literal("arrive"),
  planId: brandIdSchema,
  nextAt: instantSchema,
});

export const expireSamplingChannelSchema = z.strictObject({
  action: z.literal("expire-channel"),
  planId: brandIdSchema,
  channelId: channelIdSchema,
  nextAt: instantSchema,
});

export const samplingPlanWriteSchema = z.discriminatedUnion("action", [
  createSamplingPlanSchema,
  transitionSamplingPlanSchema,
  arriveSamplingPlanSchema,
  expireSamplingChannelSchema,
]);

export const reviseSamplingBudgetSchema = z.strictObject({
  budgetMinor: minorAmountSchema,
  nextAt: instantSchema.optional(),
  trendThresholdPp: trendThresholdPpSchema.optional(),
});

export const setSamplingTrendThresholdSchema = z.strictObject({
  planId: brandIdSchema,
  trendThresholdPp: trendThresholdPpSchema,
});

export const dueChannelStateSchema = z.enum(["eligible", "degraded", "expired"]);

export const driveDueWindowSchema = z.strictObject({
  planId: brandIdSchema,
  timezone: z.string().trim().min(1).max(64).refine(isTimeZone),
  now: instantSchema,
  channels: z.array(z.strictObject({
    channelId: channelIdSchema,
    state: dueChannelStateSchema,
  })).max(32),
  promptIds: z.array(brandIdSchema).max(10),
  promptSetId: brandIdSchema.optional(),
});

export const samplingPlanErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  PLAN_PHASE_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type SamplingPlanError = keyof typeof samplingPlanErrors;
export type CreateSamplingPlan = z.infer<typeof createSamplingPlanSchema>;
export type TransitionSamplingPlanInput = z.infer<typeof transitionSamplingPlanSchema>;
export type ArriveSamplingPlanInput = z.infer<typeof arriveSamplingPlanSchema>;
export type ExpireSamplingChannelInput = z.infer<typeof expireSamplingChannelSchema>;
export type ReviseSamplingBudgetInput = z.infer<typeof reviseSamplingBudgetSchema>;
export type SetSamplingTrendThresholdInput = z.infer<typeof setSamplingTrendThresholdSchema>;
export type DriveDueWindowInput = z.infer<typeof driveDueWindowSchema>;
