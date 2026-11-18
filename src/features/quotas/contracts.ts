import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const quotaKinds = ["sampling", "generation"] as const;
export const quotaKindSchema = z.enum(quotaKinds);
export type QuotaKind = z.infer<typeof quotaKindSchema>;

const maximumInteger = 2_147_483_647;
export const minorAmountSchema = z.int().min(0).max(maximumInteger);
export const quotaCurrencySchema = z.enum(Intl.supportedValuesOf("currency"));
const positiveInteger = z.int().min(1).max(maximumInteger);
const quotaReasonSchema = z.enum(["pilot-approval", "budget-increase", "budget-decrease", "pilot-ended", "correction"]);

export const grantValues = z.object({
  countLimit: positiveInteger,
  budgetMinor: minorAmountSchema,
  currency: quotaCurrencySchema,
  expiresAt: z.iso.datetime({ precision: 3 }),
});

const changeFields = {
  brandId: brandIdSchema,
  kind: quotaKindSchema,
  operationId: z.uuid(),
  actorId: opaqueIdSchema,
  expectedVersion: positiveInteger.nullable(),
  reason: quotaReasonSchema,
};
export const quotaChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...changeFields, ...grantValues.shape, action: z.literal("set") }),
  z.strictObject({ ...changeFields, action: z.literal("revoke") }),
]);
export type QuotaChange = z.infer<typeof quotaChangeSchema>;

export const grantSnapshotSchema = grantValues.extend({
  version: positiveInteger,
  action: z.enum(["set", "revoke"]),
  changedAt: z.iso.datetime(),
});
export type GrantSnapshot = z.infer<typeof grantSnapshotSchema>;

export const quotaErrors = {
  SESSION_REQUIRED: 401, SESSION_CHANGED: 409, FORBIDDEN: 403, NOT_FOUND: 404,
  INVALID_INPUT: 400, VERSION_CONFLICT: 409, OPERATION_CONFLICT: 409,
  CURRENCY_CONFLICT: 409, SERVICE_UNAVAILABLE: 503,
} as const;
export type QuotaError = keyof typeof quotaErrors;
