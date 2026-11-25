import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const teamRoles = ["owner", "member", "read_only"] as const;
export const teamActionStatuses = ["queued", "stopped"] as const;
export const teamInviteStatuses = ["open", "accepted", "expired", "revoked"] as const;
export const teamInviteLabelKey = "inviteMember" as const;
export const teamInviteWindowMs = 7 * 24 * 60 * 60 * 1000;
export const teamListLimit = 200;
export const teamExportLimit = 20;

export const teamErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVITE_EXPIRED: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const grantInputSchema = z.strictObject({
  userId: opaqueIdSchema,
  brandId: brandIdSchema,
  role: z.enum(teamRoles),
  expiresAt: z.iso.datetime({ precision: 3 }).nullable().optional(),
});

export const invitationCreateSchema = z.strictObject({
  userId: opaqueIdSchema,
  brandId: brandIdSchema,
  expiresAt: z.iso.datetime({ precision: 3 }).optional(),
});

export const invitationResendSchema = z.strictObject({
  expiresAt: z.iso.datetime({ precision: 3 }).optional(),
});

export const invitationAcceptSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export type TeamRole = (typeof teamRoles)[number];
export type TeamActionStatus = (typeof teamActionStatuses)[number];
export type TeamInviteStatus = (typeof teamInviteStatuses)[number];
export type TeamError = keyof typeof teamErrors;
export type GrantInput = z.infer<typeof grantInputSchema>;
export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type InvitationResendInput = z.infer<typeof invitationResendSchema>;

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

export type TeamInvitationView = {
  id: string;
  brandId: string;
  inviteeUserId: string;
  role: "member";
  status: TeamInviteStatus;
  expiresAt: string;
  labelKey: typeof teamInviteLabelKey;
  canAccept: boolean;
  canResend: boolean;
};

export type TeamListView = {
  grants: TeamGrantView[];
  actions: TeamActionView[];
  members: TeamGrantView[];
  invitations: TeamInvitationView[];
  accessibleBrandIds: string[];
  ownerBrandIds: string[];
  invite: { exposesPrivateBrandName: false };
};

export type TeamLabel = { brandId: string; name: string };

export type OwnerTransferView = {
  id: string;
  brandId: string;
  fromUserId: string;
  toUserId: string;
  actorId: string;
  createdAt: string;
};
