import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { confounderFactors, type Checkpoint } from "./rules.ts";

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

export const createFormalObservationSchema = z.strictObject({
  brandId: brandIdSchema,
  frozenSetId: frozenSetIdSchema,
  effectiveOn: calendarDaySchema,
  frozenNonBrandCount: countSchema.refine((value) => value >= 1),
});

export const recordFormalCheckpointSchema = z.strictObject({
  checkpoint: checkpointSchema,
  today: calendarDaySchema,
  comparableQuestions: countSchema,
  excluded: z.array(questionIdSchema).max(40),
  requestedMode: z.literal("formal"),
});

export const confounderFactorSchema = z.enum(confounderFactors);

export const appendFormalConfounderSchema = z.strictObject({
  factor: confounderFactorSchema,
  note: z.string().trim().min(1).max(400).refine((value) => value.isWellFormed() && !value.includes("\0")),
});

export const formalObservationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  THRESHOLD_REJECTED: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type FormalObservationError = keyof typeof formalObservationErrors;
export type CreateFormalObservationInput = z.infer<typeof createFormalObservationSchema>;
export type RecordFormalCheckpointInput = z.infer<typeof recordFormalCheckpointSchema>;
export type AppendFormalConfounderInput = z.infer<typeof appendFormalConfounderSchema>;
