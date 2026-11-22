import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const teamRoles = ["owner", "member"] as const;
export const teamActionStatuses = ["queued", "stopped"] as const;
export const teamListLimit = 200;
export const teamExportLimit = 20;

export const teamErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const grantInputSchema = z.strictObject({
  userId: opaqueIdSchema,
  brandId: brandIdSchema,
  role: z.enum(teamRoles),
  expiresAt: z.iso.datetime({ precision: 3 }).nullable().optional(),
});

export type TeamRole = (typeof teamRoles)[number];
export type TeamActionStatus = (typeof teamActionStatuses)[number];
export type TeamError = keyof typeof teamErrors;
export type GrantInput = z.infer<typeof grantInputSchema>;

export type TeamGrantView = {
  id: string;
  userId: string;
  brandId: string;
  role: TeamRole;
  active: 0 | 1;
  expiresAt: string | null;
};

export type TeamActionView = {
  id: string;
  grantId: string;
  status: TeamActionStatus;
};

export type TeamListView = {
  grants: TeamGrantView[];
  actions: TeamActionView[];
  members: TeamGrantView[];
  accessibleBrandIds: string[];
  ownerBrandIds: string[];
  invite: { exposesPrivateBrandName: false };
};

export type TeamLabel = { brandId: string; name: string };
