import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const interventionStatuses = ["pending", "effective"] as const;
export const interventionStatusSchema = z.enum(interventionStatuses);

export const verifiedAtSchema = z.iso.datetime({ precision: 3 }).nullable();

export const pageKeySchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 300 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
});

export const createInterventionBatchSchema = z.strictObject({
  brandId: brandIdSchema,
});

export const registerInterventionPageSchema = z.strictObject({
  pageKey: pageKeySchema,
  verifiedAt: verifiedAtSchema,
});

export const interventionBatchErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type InterventionBatchError = keyof typeof interventionBatchErrors;
export type InterventionStatus = z.infer<typeof interventionStatusSchema>;
export type CreateInterventionBatchInput = z.infer<typeof createInterventionBatchSchema>;
export type RegisterInterventionPageInput = z.infer<typeof registerInterventionPageSchema>;
