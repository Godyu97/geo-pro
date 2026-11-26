import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { queryWithParameters } from "../../lib/db/connection.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const platformRoles = ["admin", "user"] as const;
export type PlatformRole = (typeof platformRoles)[number];
export const platformRoleSchema = z.enum(platformRoles);

export const platformRoleReasons = [
  "initial-setup",
  "scope-change",
  "access-review",
  "offboarding",
  "incident-response",
] as const;
export type PlatformRoleReason = (typeof platformRoleReasons)[number];

export const platformRoleCommandSchema = z.strictObject({
  action: z.enum(["grant", "revoke"]),
  operatorId: opaqueIdSchema,
  userId: opaqueIdSchema,
  reason: z.enum(platformRoleReasons),
});

export type PlatformRoleAuditStatus = "allowed" | "denied" | "failed";
export type PlatformRoleDenial = "invalid-input" | "account-missing" | "not-authorized";
export type PlatformRoleResult<T> =
  | { status: "allowed"; data: T; traceId: string }
  | { status: "denied"; reason: PlatformRoleDenial; traceId: string }
  | { status: "unavailable"; traceId: string };

const userRoleRow = z.object({
  id: opaqueIdSchema,
  platformRole: platformRoleSchema,
});

const groupIdRow = z.object({
  id: z.string().min(1).max(128),
});

function sanitizeGroupName(name?: string | null) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "Personal";
  return Array.from(trimmed).slice(0, 120).join("");
}

export async function ensureUserPlatformRole(
  db: QueryConnection,
  userId: string,
  now = new Date().toISOString(),
) {
  await queryWithParameters(
    db,
    `INSERT INTO platform_account_role (user_id, role, updated_at)
     VALUES (?, 'user', ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, now],
  );
}

export async function getUserPlatformRole(db: QueryConnection, userId: string): Promise<PlatformRole | null> {
  const [row] = await queryWithParameters(
    db,
    `SELECT u.id, COALESCE(r.role, 'user') AS "platformRole"
     FROM "user" u
     LEFT JOIN platform_account_role r ON r.user_id = u.id
     WHERE u.id = ?`,
    [userId],
  );
  if (!row) return null;
  const parsed = userRoleRow.safeParse(row);
  return parsed.success ? parsed.data.platformRole : null;
}

export async function authorizePlatformAdmin(db: QueryConnection, actorId: string) {
  const parsed = opaqueIdSchema.safeParse(actorId);
  if (!parsed.success) return null;
  const role = await getUserPlatformRole(db, parsed.data);
  if (role !== "admin") return null;
  return { actorId: parsed.data, role: "admin" as const };
}

export async function ensureGroupMembership(
  db: QueryConnection,
  groupId: string,
  userId: string,
  now = new Date().toISOString(),
) {
  await queryWithParameters(
    db,
    `INSERT INTO team_group_member (id, group_id, user_id, active, created_at, revoked_at)
     VALUES (?, ?, ?, 1, ?, NULL)
     ON CONFLICT (group_id, user_id) DO UPDATE SET active = 1, revoked_at = NULL`,
    [randomUUID(), groupId, userId, now],
  );
}

export async function deactivateGroupMembershipIfUnused(
  db: QueryConnection,
  groupId: string,
  userId: string,
  now = new Date().toISOString(),
) {
  const [group] = await queryWithParameters(
    db,
    `SELECT owner_user_id AS "ownerUserId", kind FROM team_group WHERE id = ?`,
    [groupId],
  );
  const parsed = z.object({ ownerUserId: z.string().min(1), kind: z.enum(["personal", "team"]) }).safeParse(group);
  if (!parsed.success) return;
  if (parsed.data.kind === "personal" && parsed.data.ownerUserId === userId) return;
  const [remaining] = await queryWithParameters(
    db,
    `SELECT count(*) AS n
     FROM brand_member_grant g
     JOIN brand_group bg ON bg.brand_id = g.brand_id
     WHERE bg.group_id = ? AND g.user_id = ? AND g.active = 1 AND (g.expires_at IS NULL OR g.expires_at > ?)`,
    [groupId, userId, now],
  );
  if (Number(remaining?.n ?? 0) > 0) return;
  await queryWithParameters(
    db,
    `UPDATE team_group_member SET active = 0, revoked_at = ?
     WHERE group_id = ? AND user_id = ? AND active = 1`,
    [now, groupId, userId],
  );
}

export async function ensurePersonalGroup(
  db: QueryConnection,
  userId: string,
  name?: string | null,
  now = new Date().toISOString(),
): Promise<string> {
  const [existing] = await queryWithParameters(
    db,
    `SELECT id FROM team_group WHERE owner_user_id = ? AND kind = 'personal'`,
    [userId],
  );
  if (existing) {
    const groupId = groupIdRow.parse(existing).id;
    await ensureGroupMembership(db, groupId, userId, now);
    return groupId;
  }
  let resolvedName = name;
  if (!resolvedName) {
    const [userRow] = await queryWithParameters(db, 'SELECT name FROM "user" WHERE id = ?', [userId]);
    resolvedName = typeof userRow?.name === "string" ? userRow.name : null;
  }
  const groupId = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO team_group (id, owner_user_id, kind, name, created_at)
     VALUES (?, ?, 'personal', ?, ?)
     ON CONFLICT (owner_user_id) WHERE kind = 'personal' DO NOTHING`,
    [groupId, userId, sanitizeGroupName(resolvedName), now],
  );
  const [loaded] = await queryWithParameters(
    db,
    `SELECT id FROM team_group WHERE owner_user_id = ? AND kind = 'personal'`,
    [userId],
  );
  if (!loaded) throw new Error("personal group creation failed");
  const finalGroupId = groupIdRow.parse(loaded).id;
  await ensureGroupMembership(db, finalGroupId, userId, now);
  return finalGroupId;
}

async function writePlatformAudit(
  db: QueryConnection,
  entry: {
    id: string;
    actorId: string | null;
    subjectId: string | null;
    role: PlatformRole | null;
    action: "grant" | "revoke";
    result: PlatformRoleAuditStatus;
    reason: string;
    occurredAt: string;
  },
) {
  await queryWithParameters(
    db,
    `INSERT INTO platform_role_audit (id, actor_id, subject_id, role, action, result, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.actorId, entry.subjectId, entry.role, entry.action, entry.result, entry.reason, entry.occurredAt],
  );
}

// Controlled server CLI only. Never expose via HTTP routes or Server Actions.
export async function changePlatformRole(
  connection: DatabaseConnection,
  input: unknown,
): Promise<PlatformRoleResult<{ userId: string; role: PlatformRole }>> {
  const traceId = randomUUID();
  const occurredAt = new Date().toISOString();
  const parsed = platformRoleCommandSchema.safeParse(input);
  if (!parsed.success) {
    const safe = z.object({
      operatorId: opaqueIdSchema.nullable().catch(null),
      userId: opaqueIdSchema.nullable().catch(null),
      action: z.enum(["grant", "revoke"]).catch("grant"),
    }).safeParse(input);
    const candidate = safe.success ? safe.data : { operatorId: null, userId: null, action: "grant" as const };
    try {
      await connection.transaction(async (tx) => {
        const ids = [candidate.operatorId, candidate.userId].filter((id): id is string => id !== null);
        const rows = ids.length
          ? await queryWithParameters(tx, `SELECT id FROM "user" WHERE id IN (${ids.map(() => "?").join(", ")})`, ids)
          : [];
        const present = new Set(rows.map((row) => String(row.id)));
        await writePlatformAudit(tx, {
          id: traceId,
          actorId: candidate.operatorId && present.has(candidate.operatorId) ? candidate.operatorId : null,
          subjectId: candidate.userId && present.has(candidate.userId) ? candidate.userId : null,
          role: null,
          action: candidate.action,
          result: "denied",
          reason: "invalid-input",
          occurredAt,
        });
      });
    } catch {
      return { status: "unavailable", traceId };
    }
    return { status: "denied", reason: "invalid-input", traceId };
  }

  const command = parsed.data;
  try {
    return await connection.transaction(async (tx) => {
      const lock = tx.kind === "postgresql" ? " FOR UPDATE OF u" : "";
      const ids = [...new Set([command.operatorId, command.userId])];
      const rows = await queryWithParameters(
        tx,
        `SELECT u.id, COALESCE(r.role, 'user') AS "platformRole"
         FROM "user" u
         LEFT JOIN platform_account_role r ON r.user_id = u.id
         WHERE u.id IN (${ids.map(() => "?").join(", ")})${lock}`,
        ids,
      );
      const users = new Map(rows.map((row) => {
        const parsedRow = userRoleRow.parse(row);
        return [parsedRow.id, parsedRow.platformRole];
      }));
      const operatorRole = users.get(command.operatorId) ?? null;
      const subjectRole = users.get(command.userId) ?? null;
      if (!operatorRole || !subjectRole) {
        await writePlatformAudit(tx, {
          id: traceId,
          actorId: operatorRole ? command.operatorId : null,
          subjectId: subjectRole ? command.userId : null,
          role: null,
          action: command.action,
          result: "denied",
          reason: "account-missing",
          occurredAt,
        });
        return { status: "denied", reason: "account-missing", traceId } as const;
      }

      const targetRole: PlatformRole = command.action === "grant" ? "admin" : "user";
      let authorized = operatorRole === "admin";
      if (!authorized && command.action === "grant" && command.operatorId === command.userId && command.reason === "initial-setup") {
        const [countRow] = await queryWithParameters(
          tx,
          `SELECT count(*) AS n FROM platform_account_role WHERE role = 'admin'`,
          [],
        );
        if (Number(countRow?.n ?? 0) === 0) authorized = true;
      }

      if (!authorized) {
        await writePlatformAudit(tx, {
          id: traceId,
          actorId: command.operatorId,
          subjectId: command.userId,
          role: targetRole,
          action: command.action,
          result: "denied",
          reason: "not-authorized",
          occurredAt,
        });
        return { status: "denied", reason: "not-authorized", traceId } as const;
      }

      await queryWithParameters(
        tx,
        `INSERT INTO platform_account_role (user_id, role, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
        [command.userId, targetRole, occurredAt],
      );
      await writePlatformAudit(tx, {
        id: traceId,
        actorId: command.operatorId,
        subjectId: command.userId,
        role: targetRole,
        action: command.action,
        result: "allowed",
        reason: command.reason,
        occurredAt,
      });
      return {
        status: "allowed",
        data: { userId: command.userId, role: targetRole },
        traceId,
      } as const;
    });
  } catch {
    try {
      await writePlatformAudit(connection, {
        id: traceId,
        actorId: null,
        subjectId: null,
        role: null,
        action: command.action,
        result: "failed",
        reason: "operation-failed",
        occurredAt,
      });
    } catch {
      console.error(JSON.stringify({ event: "platform-role-audit-unavailable", traceId, action: command.action }));
    }
    return { status: "unavailable", traceId };
  }
}
