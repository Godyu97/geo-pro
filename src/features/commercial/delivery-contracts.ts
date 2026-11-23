import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { deliveryStatuses, type DeliveryStatus } from "./delivery.ts";

export const deliveryListLimit = 100;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

const paymentKeys = ["paid", "paymentReceived", "paymentConnected", "collected", "quoted", "amount", "currency"] as const;

export const registerDeliverySchema = z.strictObject({
  brandId: brandIdSchema,
  title: boundedText(120),
});

export const disputeDeliverySchema = z.strictObject({
  reason: boundedText(500),
});

export const deliveryErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type DeliveryError = keyof typeof deliveryErrors;
export type RegisterDeliveryInput = z.infer<typeof registerDeliverySchema>;

export type DeliveryView = {
  id: string;
  brandId: string;
  title: string;
  status: DeliveryStatus;
  disputeReason: string | null;
  createdAt: string;
};

export type DeliveryWorkspace = {
  deliveries: DeliveryView[];
  brands: { id: string; name: string }[];
};

function record(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function claimsPayment(body: Record<string, unknown>) {
  return paymentKeys.some((key) => key in body);
}

export function deliveryRegistrationInput(body: unknown): { error: "INVALID_INPUT" } | { input: RegisterDeliveryInput } {
  const fields = record(body);
  if (!fields || claimsPayment(fields) || "status" in fields || "disputeReason" in fields) return { error: "INVALID_INPUT" };
  const parsed = registerDeliverySchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}

export function deliveryDisputeInput(body: unknown): { error: "INVALID_INPUT" } | { reason: string } {
  const fields = record(body);
  if (!fields || claimsPayment(fields) || "status" in fields || "title" in fields) return { error: "INVALID_INPUT" };
  const parsed = disputeDeliverySchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { reason: parsed.data.reason };
}

export function deliveryAcceptInput(body: unknown): { error: "INVALID_INPUT" } | { ok: true } {
  if (body === null) return { ok: true };
  const fields = record(body);
  if (!fields || claimsPayment(fields) || "status" in fields || "disputeReason" in fields || "title" in fields || "reason" in fields) {
    return { error: "INVALID_INPUT" };
  }
  if (Object.keys(fields).length > 0) return { error: "INVALID_INPUT" };
  return { ok: true };
}

export function deliveryHasPaymentClaim(view: DeliveryView) {
  return "paid" in view || "paymentReceived" in view || "collected" in view;
}

export { deliveryStatuses };
