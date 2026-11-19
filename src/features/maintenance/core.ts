import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { grantCommandSchema, opaqueIdSchema, permissionSchema, type MaintenanceAudit, type MaintenancePermission } from "./contracts.ts";
import { MaintenanceDao } from "./dao.ts";

type Denial = "session-required" | "not-granted" | "invalid-input" | "account-missing";
export type MaintenanceResult<T> =
  | { status: "allowed"; data: T; traceId: string }
  | { status: "denied"; reason: Denial; traceId: string }
  | { status: "unavailable"; traceId: string };

type AuditContext = Pick<MaintenanceAudit, "actorId" | "subjectId" | "permission" | "action">;
function auditEvent(context: AuditContext): MaintenanceAudit {
  return { ...context, id: randomUUID(), occurredAt: new Date().toISOString(), result: "allowed", reason: "authorized" };
}

export async function maintenanceUnavailable(connection: DatabaseConnection | undefined, event: MaintenanceAudit = auditEvent({ actorId: null, subjectId: null, permission: null, action: "access.view" })) {
  const failure: MaintenanceAudit = { ...event, result: "failed", reason: "operation-failed" };
  try {
    if (!connection) throw new Error("Database unavailable");
    await new MaintenanceDao(connection).audit(failure);
  } catch {
    // No exception text, request, credential or customer content reaches logs.
    console.error(JSON.stringify({ event: "maintenance-audit-unavailable", traceId: failure.id, action: failure.action, result: "failed" }));
  }
  return { status: "unavailable", traceId: event.id } as const;
}

async function deny(dao: MaintenanceDao, event: MaintenanceAudit, reason: Denial) {
  await dao.audit({ ...event, result: "denied", reason });
  return { status: "denied", reason, traceId: event.id } as const;
}

async function authorized<T>(
  connection: DatabaseConnection,
  context: AuditContext,
  work: (transaction: QueryConnection, permissions: MaintenancePermission[]) => Promise<T>,
  invalidInput = false,
): Promise<MaintenanceResult<T>> {
  const event = auditEvent(context);
  try {
    return await connection.transaction(async (transaction) => {
      const dao = new MaintenanceDao(transaction);
      if (!context.actorId) return deny(dao, event, "session-required");
      if (!(await dao.lockAccounts([context.actorId])).includes(context.actorId)) return deny(dao, event, "session-required");
      if (invalidInput) return deny(dao, event, "invalid-input");
      const permissions = await dao.permissions(context.actorId);
      if (!permissions.length || (context.permission && !permissions.includes(context.permission))) return deny(dao, event, "not-granted");
      const data = await work(transaction, permissions);
      await dao.audit(event);
      return { status: "allowed", data, traceId: event.id } as const;
    });
  } catch {
    // Never replay an unknown outcome; this only records the failed attempt.
    return maintenanceUnavailable(connection, event);
  }
}

// actorId must come from an authoritative server session, never request input.
export function readMaintenanceAccess(connection: DatabaseConnection, actorId: string | null, permission: MaintenancePermission | null = null, invalidInput = false) {
  return authorized(connection, { actorId, subjectId: actorId, permission, action: permission ? "access.check" : "access.view" },
    async (_transaction, permissions) => ({ permissions: permission ? permissions.filter((item) => item === permission) : permissions }), invalidInput);
}

const operationPermissions = {
  "capability.write": "capabilities.manage",
  "quota.write": "quotas.manage",
  "support.read": "support.read",
} as const;

// Future maintenance actions use this guard with their own DAO on the same transaction.
// No customer-data permission or online grant operation is represented here.
// subjectId records the opaque object of a read; it never carries free text.
export function runMaintenanceAction<T>(
  connection: DatabaseConnection,
  actorId: string | null,
  action: keyof typeof operationPermissions,
  work: (transaction: QueryConnection) => Promise<T>,
  subjectId: string | null = actorId,
  invalidInput = false,
) {
  return authorized(connection, { actorId, subjectId, action, permission: operationPermissions[action] }, work, invalidInput);
}

// Trusted server CLI only. This is intentionally not exported by a server action
// or an HTTP route. OS access to the deployment is the grant authority.
export async function changeMaintenanceGrant(connection: DatabaseConnection, input: unknown): Promise<MaintenanceResult<null>> {
  const parsed = grantCommandSchema.safeParse(input);
  if (!parsed.success) {
    // Salvage only validated identifiers/enums so malformed attempts with a
    // known operator remain attributable without copying any raw input.
    const safe = z.object({
      operatorId: opaqueIdSchema.nullable().catch(null),
      userId: opaqueIdSchema.nullable().catch(null),
      permission: permissionSchema.nullable().catch(null),
      action: z.enum(["grant", "revoke"]).catch("grant"),
    }).safeParse(input);
    const candidate = safe.success ? safe.data : { operatorId: null, userId: null, permission: null, action: "grant" as const };
    let event = auditEvent({ actorId: null, subjectId: null, permission: candidate.permission, action: candidate.action });
    try {
      return await connection.transaction(async (transaction) => {
        const dao = new MaintenanceDao(transaction);
        const ids = [candidate.operatorId, candidate.userId].filter((id): id is string => id !== null);
        const accounts = await dao.lockAccounts(ids);
        event = {
          ...event,
          actorId: candidate.operatorId && accounts.includes(candidate.operatorId) ? candidate.operatorId : null,
          subjectId: candidate.userId && accounts.includes(candidate.userId) ? candidate.userId : null,
        };
        return deny(dao, event, "invalid-input");
      });
    } catch {
      return maintenanceUnavailable(connection, event);
    }
  }
  const command = parsed.data;
  let event = auditEvent({ actorId: null, subjectId: null, permission: command.permission, action: command.action });
  try {
    return await connection.transaction(async (transaction) => {
      const dao = new MaintenanceDao(transaction);
      const accounts = await dao.lockAccounts([command.operatorId, command.userId]);
      event = {
        ...event,
        actorId: accounts.includes(command.operatorId) ? command.operatorId : null,
        subjectId: accounts.includes(command.userId) ? command.userId : null,
      };
      if (!accounts.includes(command.operatorId) || !accounts.includes(command.userId)) return deny(dao, event, "account-missing");
      await dao.changeGrant(command, event.occurredAt);
      await dao.audit({ ...event, reason: command.reason });
      return { status: "allowed", data: null, traceId: event.id } as const;
    });
  } catch {
    return maintenanceUnavailable(connection, event);
  }
}
