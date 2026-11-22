import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { teamActionStatuses, teamListLimit, teamRoles, type TeamRole } from "./contracts.ts";

const grantRow = z.object({
  id: brandIdSchema,
  userId: z.string().min(1).max(128),
  brandId: brandIdSchema,
  role: z.enum(teamRoles),
  active: z.union([z.literal(0), z.literal(1)]),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

const accessRow = grantRow.extend({
  id: brandIdSchema.nullable(),
  source: z.enum(["grant", "implicit"]),
});

const actionRow = z.object({
  id: brandIdSchema,
  grantId: brandIdSchema,
  status: z.enum(teamActionStatuses),
});

const brandGateRow = z.object({
  ownerId: z.string().min(1).max(128),
  status: z.enum(["active", "archived"]),
  frozenAt: z.string().nullable(),
});

const labelRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1),
});

const countRow = z.object({
  brandId: brandIdSchema,
  others: z.coerce.number().int().nonnegative(),
});

export type TeamGrantRecord = z.infer<typeof grantRow>;
export type TeamAccessRecord = z.infer<typeof accessRow>;
export type TeamActionRecord = z.infer<typeof actionRow>;

const grantColumns = `id, user_id AS "userId", brand_id AS "brandId", role, active,
  expires_at AS "expiresAt", revoked_at AS "revokedAt"`;

export function validGrantQuery(userId: string, now: string) {
  return {
    sql: `SELECT g.id, g.user_id AS "userId", g.brand_id AS "brandId", g.role, g.active,
        g.expires_at AS "expiresAt", g.revoked_at AS "revokedAt", 'grant' AS "source"
      FROM brand_member_grant g
      WHERE g.user_id = ? AND g.active = 1 AND (g.expires_at IS NULL OR g.expires_at > ?)
      UNION ALL
      SELECT NULL, b.owner_id, b.id, 'owner', 1, NULL, NULL, 'implicit'
      FROM brand b
      WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM brand_member_grant g WHERE g.brand_id = b.id)`,
    values: [userId, now, userId] as QueryValue[],
  };
}

export function membersByBrandQuery(brandIds: readonly string[]) {
  return {
    sql: `SELECT ${grantColumns} FROM brand_member_grant
      WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
      ORDER BY brand_id, user_id
      LIMIT ?`,
    values: [...brandIds, teamListLimit] as QueryValue[],
  };
}

export class TeamAccessDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async validAccess(userId: string, now: string) {
    const query = validGrantQuery(userId, now);
    const rows = await this.query(query.sql, query.values);
    return rows.map((row) => accessRow.parse(row));
  }

  async grantsForUser(userId: string) {
    const rows = await this.query(
      `SELECT ${grantColumns} FROM brand_member_grant WHERE user_id = ? ORDER BY brand_id, id LIMIT ?`,
      [userId, teamListLimit],
    );
    return rows.map((row) => grantRow.parse(row));
  }

  async membersForBrands(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const query = membersByBrandQuery(brandIds);
    const rows = await this.query(query.sql, query.values);
    return rows.map((row) => grantRow.parse(row));
  }

  async actionsForUser(userId: string) {
    const rows = await this.query(
      `SELECT a.id, a.grant_id AS "grantId", a.status
       FROM queued_brand_action a
       JOIN brand_member_grant g ON g.id = a.grant_id
       WHERE g.user_id = ?
       ORDER BY a.created_at, a.id
       LIMIT ?`,
      [userId, teamListLimit],
    );
    return rows.map((row) => actionRow.parse(row));
  }

  async brandLabels(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY b.id`,
      [...brandIds],
    );
    return rows.map((row) => labelRow.parse(row));
  }

  async userExists(userId: string) {
    const [row] = await this.query('SELECT id FROM "user" WHERE id = ?', [userId]);
    return Boolean(row);
  }

  async brandGate(brandId: string) {
    const [row] = await this.query(
      `SELECT owner_id AS "ownerId", status, frozen_at AS "frozenAt" FROM brand WHERE id = ?`,
      [brandId],
    );
    return row ? brandGateRow.parse(row) : null;
  }

  async pair(userId: string, brandId: string) {
    const [row] = await this.query(
      `SELECT ${grantColumns} FROM brand_member_grant WHERE user_id = ? AND brand_id = ?`,
      [userId, brandId],
    );
    return row ? grantRow.parse(row) : null;
  }

  async grantById(id: string) {
    const [row] = await this.query(`SELECT ${grantColumns} FROM brand_member_grant WHERE id = ?`, [id]);
    return row ? grantRow.parse(row) : null;
  }

  async insertGrant(row: { id: string; userId: string; brandId: string; role: TeamRole; expiresAt: string | null; createdAt: string }) {
    await this.query(
      `INSERT INTO brand_member_grant (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
      [row.id, row.userId, row.brandId, row.role, row.expiresAt, row.createdAt],
    );
  }

  async reactivate(id: string, role: TeamRole, expiresAt: string | null) {
    const rows = await this.query(
      `UPDATE brand_member_grant SET role = ?, active = 1, expires_at = ?, revoked_at = NULL
       WHERE id = ? RETURNING id`,
      [role, expiresAt, id],
    );
    return rows.length === 1;
  }

  async revoke(id: string, now: string) {
    const rows = await this.query(
      `UPDATE brand_member_grant SET active = 0, revoked_at = ? WHERE id = ? AND active = 1 RETURNING id`,
      [now, id],
    );
    return rows.length === 1;
  }

  async revokeAllForUser(userId: string, now: string) {
    await this.query(
      `UPDATE brand_member_grant SET active = 0, revoked_at = ? WHERE user_id = ? AND active = 1`,
      [now, userId],
    );
  }

  async otherOwnerCounts(brandIds: readonly string[], userId: string, now: string) {
    const counts = new Map<string, number>();
    if (!brandIds.length) return counts;
    const rows = await this.query(
      `SELECT brand_id AS "brandId", count(*) AS "others"
       FROM brand_member_grant
       WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
         AND role = 'owner' AND active = 1 AND user_id <> ?
         AND (expires_at IS NULL OR expires_at > ?)
       GROUP BY brand_id`,
      [...brandIds, userId, now],
    );
    for (const row of rows) {
      const parsed = countRow.parse(row);
      counts.set(parsed.brandId, parsed.others);
    }
    return counts;
  }

  async insertAction(row: { id: string; grantId: string; attachment: string; createdAt: string }) {
    await this.query(
      `INSERT INTO queued_brand_action (id, grant_id, status, attachment, created_at)
       VALUES (?, ?, 'queued', ?, ?)`,
      [row.id, row.grantId, row.attachment, row.createdAt],
    );
  }

  async actionMeta(id: string) {
    const [row] = await this.query(
      `SELECT id, grant_id AS "grantId", status FROM queued_brand_action WHERE id = ?`,
      [id],
    );
    return row ? actionRow.parse(row) : null;
  }

  async attachment(id: string) {
    const [row] = await this.query(
      `SELECT attachment FROM queued_brand_action WHERE id = ? AND status = 'queued'`,
      [id],
    );
    const parsed = z.object({ attachment: z.string().min(16).max(64) }).safeParse(row);
    return parsed.success ? parsed.data.attachment : null;
  }

  async stopAction(id: string) {
    const rows = await this.query(
      `UPDATE queued_brand_action SET status = 'stopped' WHERE id = ? AND status = 'queued' RETURNING id`,
      [id],
    );
    return rows.length === 1;
  }
}
