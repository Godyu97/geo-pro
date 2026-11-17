import { z } from "zod";

export const maintenancePermissions = ["capabilities.manage", "quotas.manage", "support.read"] as const;
export const permissionSchema = z.enum(maintenancePermissions);
export type MaintenancePermission = z.infer<typeof permissionSchema>;
export const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const changeReasonSchema = z.enum(["initial-setup", "scope-change", "access-review", "offboarding", "incident-response"]);
export const grantCommandSchema = z.strictObject({
  action: z.enum(["grant", "revoke"]),
  operatorId: opaqueIdSchema,
  userId: opaqueIdSchema,
  permission: permissionSchema,
  reason: changeReasonSchema,
});
export const auditSchema = z.strictObject({
  id: z.uuid(),
  actorId: opaqueIdSchema.nullable(),
  subjectId: opaqueIdSchema.nullable(),
  permission: permissionSchema.nullable(),
  action: z.enum(["access.view", "access.check", "grant", "revoke", "capability.write", "quota.write", "support.read"]),
  result: z.enum(["allowed", "denied", "failed"]),
  reason: z.enum(["authorized", "not-granted", "session-required", "invalid-input", "operation-failed", "account-missing", ...changeReasonSchema.options]),
  occurredAt: z.iso.datetime(),
});
export type MaintenanceAudit = z.infer<typeof auditSchema>;
export type GrantCommand = z.infer<typeof grantCommandSchema>;
export const accessQuerySchema = z.strictObject({ permission: permissionSchema.optional() });
