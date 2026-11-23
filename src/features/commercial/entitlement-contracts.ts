import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  entitlementKinds,
  entitlementQuotaMax,
  usageKinds,
  type EntitlementKind,
  type UsageKind,
  type UsageTotals,
} from "./entitlement.ts";

export const entitlementListLimit = 100;

const quota = z.number().int().min(0).max(entitlementQuotaMax);
const quantity = z.number().int().min(1).max(entitlementQuotaMax);

export const registerEntitlementSchema = z.strictObject({
  brandId: brandIdSchema,
  kind: z.enum(entitlementKinds),
  monitoringQuota: quota,
  contentQuota: quota,
  laborQuota: quota,
});

export const reviseEntitlementSchema = z.strictObject({
  kind: z.enum(entitlementKinds),
  monitoringQuota: quota,
  contentQuota: quota,
  laborQuota: quota,
});

export const recordUsageSchema = z.strictObject({
  kind: z.enum(usageKinds),
  quantity,
});

export const entitlementErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type EntitlementError = keyof typeof entitlementErrors;
export type RegisterEntitlementInput = z.infer<typeof registerEntitlementSchema>;
export type ReviseEntitlementInput = z.infer<typeof reviseEntitlementSchema>;
export type RecordUsageInput = z.infer<typeof recordUsageSchema>;

const chargeKeys = [
  "paid",
  "paymentReceived",
  "paymentConnected",
  "collected",
  "charged",
  "revenue",
  "amount",
  "currency",
  "paymentStatus",
  "settled",
] as const;

export type EntitlementUsageView = {
  id: string;
  kind: UsageKind;
  quantity: number;
};

export type EntitlementView = {
  id: string;
  brandId: string;
  version: number;
  kind: EntitlementKind;
  monitoringQuota: number;
  contentQuota: number;
  laborQuota: number;
  createdAt: string;
  usages: EntitlementUsageView[];
  usageTotals: UsageTotals;
};

export type UsageView = {
  id: string;
  entitlementId: string;
  kind: UsageKind;
  quantity: number;
  createdAt: string;
};

export type EntitlementWorkspace = {
  entitlements: EntitlementView[];
  brands: { id: string; name: string }[];
};

function record(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function claimsCharge(body: Record<string, unknown>) {
  return chargeKeys.some((key) => key in body);
}

export function entitlementRegistrationInput(body: unknown): { error: "INVALID_INPUT" } | { input: RegisterEntitlementInput } {
  const fields = record(body);
  if (!fields || claimsCharge(fields) || "version" in fields || "status" in fields) return { error: "INVALID_INPUT" };
  const parsed = registerEntitlementSchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}

export function entitlementRevisionInput(body: unknown): { error: "INVALID_INPUT" } | { input: ReviseEntitlementInput } {
  const fields = record(body);
  if (!fields || claimsCharge(fields) || "version" in fields || "brandId" in fields || "status" in fields || "id" in fields) {
    return { error: "INVALID_INPUT" };
  }
  const parsed = reviseEntitlementSchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}

export function entitlementUsageInput(body: unknown): { error: "INVALID_INPUT" } | { input: RecordUsageInput } {
  const fields = record(body);
  if (!fields || claimsCharge(fields) || "entitlementId" in fields || "version" in fields || "status" in fields) {
    return { error: "INVALID_INPUT" };
  }
  const parsed = recordUsageSchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}

export function entitlementHasChargeSuccess(view: unknown) {
  return /收款成功|payment received|paid successfully|payment successful/i.test(JSON.stringify(view));
}
