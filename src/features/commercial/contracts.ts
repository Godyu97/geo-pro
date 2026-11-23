import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const delegationListLimit = 200;
export const delegationActionStatuses = ["queued", "stopped"] as const;

const evidenceIdSchema = z.string().regex(/^[a-z0-9-]{8,64}$/);

export const delegationScopeSchema = z.string().trim().max(600).refine((value) => {
  const parts = value.split(",");
  return parts.length >= 1 && parts.length <= 8 && parts.every((part) => evidenceIdSchema.safeParse(part).success);
});

const expiresAtSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const registerMembershipSchema = z.strictObject({
  organizationId: brandIdSchema,
  userId: z.string().trim().min(1).max(128),
});

export const registerDelegationSchema = z.strictObject({
  brandId: brandIdSchema,
  organizationId: brandIdSchema,
  expiresAt: expiresAtSchema,
  scope: delegationScopeSchema,
});

export const expireDelegationSchema = z.strictObject({});

export const delegationErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type DelegationError = keyof typeof delegationErrors;
export type RegisterMembershipInput = z.infer<typeof registerMembershipSchema>;
export type RegisterDelegationInput = z.infer<typeof registerDelegationSchema>;
export type DelegationActionStatus = (typeof delegationActionStatuses)[number];

export type PortfolioRowView = {
  delegationId: string;
  brandId: string;
  summary: "blocked" | "visible";
  evidenceIds: string[];
};

export type DelegationActionView = {
  id: string;
  delegationId: string;
  brandId: string;
  status: DelegationActionStatus;
};

export type ManagedDelegationView = {
  id: string;
  brandId: string;
  organizationId: string;
  active: 0 | 1;
  expiresAt: string;
};

export type DelegationWorkspace = {
  memberships: { organizationId: string }[];
  portfolio: PortfolioRowView[];
  actions: DelegationActionView[];
  managed: ManagedDelegationView[];
  brands: { id: string; name: string }[];
};
