import "server-only";

import { z } from "zod";
import type { QueryConnection, QueryValue } from "../../lib/db/connection.ts";
import { auditSchema, opaqueIdSchema, permissionSchema, type GrantCommand, type MaintenanceAudit } from "./contracts.ts";

export class MaintenanceDao {
  private transaction: QueryConnection;

  constructor(transaction: QueryConnection) {
    this.transaction = transaction;
  }

  query(sql: string, values: QueryValue[] = []) {
    let parameter = 0;
    return this.transaction.query(
      this.transaction.kind === "postgresql" ? sql.replace(/\?/g, () => `$${++parameter}`) : sql,
      values,
    );
  }

  async lockAccounts(ids: string[]) {
    const uniqueIds = [...new Set(ids.map((id) => opaqueIdSchema.parse(id)))].sort();
    if (!uniqueIds.length) return [];
    const rows = await this.query(
      `SELECT id FROM "user" WHERE id IN (${uniqueIds.map(() => "?").join(", ")}) ORDER BY id${this.transaction.kind === "postgresql" ? " FOR UPDATE" : ""}`,
      uniqueIds,
    );
    return z.array(z.object({ id: opaqueIdSchema })).parse(rows).map((row) => row.id);
  }

  async permissions(userId: string) {
    const rows = await this.query("SELECT permission FROM maintenance_grant WHERE user_id = ? AND revoked_at IS NULL ORDER BY permission LIMIT 3", [opaqueIdSchema.parse(userId)]);
    return z.array(z.object({ permission: permissionSchema })).parse(rows).map((row) => row.permission);
  }

  async changeGrant(command: GrantCommand, time: string) {
    if (command.action === "grant") {
      await this.query(`INSERT INTO maintenance_grant (user_id, permission, granted_at, revoked_at, operator_id) VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT (user_id, permission) DO UPDATE SET
          granted_at = CASE WHEN maintenance_grant.revoked_at IS NULL THEN maintenance_grant.granted_at ELSE excluded.granted_at END,
          revoked_at = NULL, operator_id = excluded.operator_id`,
      [command.userId, command.permission, time, command.operatorId]);
    } else {
      await this.query("UPDATE maintenance_grant SET revoked_at = COALESCE(revoked_at, ?), operator_id = ? WHERE user_id = ? AND permission = ?", [time, command.operatorId, command.userId, command.permission]);
    }
  }

  async audit(event: MaintenanceAudit) {
    const entry = auditSchema.parse(event);
    await this.query("INSERT INTO maintenance_audit (id, actor_id, subject_id, permission, action, result, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [entry.id, entry.actorId, entry.subjectId, entry.permission, entry.action, entry.result, entry.reason, entry.occurredAt]);
  }
}
