import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const externalConnectionListLimit = 50;
export const externalActionListLimit = 200;

const labelSchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 80
    && value.isWellFormed()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/password|token|secret|cookie/i.test(value);
});

const idempotencyKeySchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,80}$/);
const timestampSchema = z.iso.datetime({ precision: 3 });

export const connectionStatuses = ["pending", "verified", "revoked"] as const;
export const actionStatuses = ["confirmed", "acknowledged", "unknown", "failed", "reconciled"] as const;
export const receiptKinds = ["draft_created", "public_url"] as const;

export const registerConnectionSchema = z.strictObject({
  brandId: brandIdSchema,
  label: labelSchema,
  canRead: z.boolean(),
  canDraft: z.boolean(),
  canPublish: z.boolean(),
});

export const updateConnectionSchema = z.strictObject({
  id: brandIdSchema,
  status: z.enum(["verified", "revoked"]),
});

export const submitActionSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  confirmed: z.boolean(),
  remoteState: z.enum(["acknowledged", "unknown", "failed"]).nullable(),
  receiptKind: z.enum(receiptKinds).nullable(),
  effectiveAt: timestampSchema.nullable(),
});

export const retryActionSchema = z.strictObject({
  remoteState: z.enum(["acknowledged", "unknown", "failed"]).nullable(),
  receiptKind: z.enum(receiptKinds).nullable(),
  effectiveAt: timestampSchema.nullable(),
});

export const externalConnectionErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  REVOKED: 409,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ExternalConnectionError = keyof typeof externalConnectionErrors;
export type RegisterConnectionInput = z.infer<typeof registerConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type SubmitActionInput = z.infer<typeof submitActionSchema>;
export type RetryActionInput = z.infer<typeof retryActionSchema>;
export type ConnectionStatus = (typeof connectionStatuses)[number];
export type ActionStatus = (typeof actionStatuses)[number];
export type ReceiptKind = (typeof receiptKinds)[number];

export type ExternalActionView = {
  id: string;
  idempotencyKey: string;
  confirmed: boolean;
  status: ActionStatus;
  receiptKind: ReceiptKind | null;
  effectiveAt: string | null;
  reason: "manual_followup" | "needs_confirmation" | "ok";
  countsAsPublic: boolean;
  interventionEffective: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExternalConnectionView = {
  id: string;
  brandId: string;
  label: string;
  canRead: boolean;
  canDraft: boolean;
  canPublish: boolean;
  status: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
  actions: ExternalActionView[];
};

export type ExternalConnectionList = {
  brands: { id: string }[];
  connections: ExternalConnectionView[];
};
