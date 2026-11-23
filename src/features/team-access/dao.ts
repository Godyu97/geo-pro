import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { teamActionStatuses, teamInviteStatuses, teamListLimit, teamRoles, type TeamRole } from "./contracts.ts";

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

const transferRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  fromUserId: z.string().min(1).max(128),
  toUserId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(128),
  createdAt: z.string().min(20).max(40),
});

const invitationListRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  inviteeUserId: z.string().min(1).max(128),
  role: z.literal("member"),
  expiresAt: z.string().min(20).max(40),
  status: z.enum(teamInviteStatuses),
  createdAt: z.string().min(20).max(40),
  replacedBy: z.string().min(1).max(128).nullable(),
});

const invitationTokenRow = invitationListRow.extend({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type TeamGrantRecord = z.infer<typeof grantRow>;
export type TeamAccessRecord = z.infer<typeof accessRow>;
export type TeamActionRecord = z.infer<typeof actionRow>;
export type OwnerTransferRecord = z.infer<typeof transferRow>;
export type TeamInvitationRecord = z.infer<typeof invitationListRow>;
export type TeamInvitationTokenRecord = z.infer<typeof invitationTokenRow>;

const invitationColumns = `id, brand_id AS "brandId", invitee_user_id AS "inviteeUserId", role,
  expires_at AS "expiresAt", status, created_at AS "createdAt", replaced_by AS "replacedBy"`;

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

export function ownerTransfersByBrandQuery(brandId: string) {
  return {
    sql: `SELECT id, brand_id AS "brandId", from_user_id AS "fromUserId", to_user_id AS "toUserId",
        actor_id AS "actorId", created_at AS "createdAt"
      FROM brand_owner_transfer
      WHERE brand_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [brandId, teamListLimit] as QueryValue[],
  };
}

export function invitationsForInviteeQuery(userId: string) {
  return {
    sql: `SELECT ${invitationColumns}
      FROM team_invitation
      WHERE invitee_user_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [userId, teamListLimit] as QueryValue[],
  };
}

export function invitationsForBrandQuery(brandId: string) {
  return {
    sql: `SELECT ${invitationColumns}
      FROM team_invitation
      WHERE brand_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [brandId, teamListLimit] as QueryValue[],
  };
}

export function invitationByTokenHashQuery(tokenHash: string) {
  return {
    sql: `SELECT ${invitationColumns}, token_hash AS "tokenHash"
      FROM team_invitation
      WHERE token_hash = ?`,
    values: [tokenHash] as QueryValue[],
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

  async promoteMemberToOwner(id: string, now: string) {
    const rows = await this.query(
      `UPDATE brand_member_grant SET role = 'owner'
       WHERE id = ? AND role = 'member' AND active = 1
         AND (expires_at IS NULL OR expires_at > ?)
       RETURNING id`,
      [id, now],
    );
    return rows.length === 1;
  }

  async insertOwnerTransfer(row: { id: string; brandId: string; fromUserId: string; toUserId: string; actorId: string; createdAt: string }) {
    await this.query(
      `INSERT INTO brand_owner_transfer (id, brand_id, from_user_id, to_user_id, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.fromUserId, row.toUserId, row.actorId, row.createdAt],
    );
  }

  async ownerTransferById(id: string) {
    const [row] = await this.query(
      `SELECT id, brand_id AS "brandId", from_user_id AS "fromUserId", to_user_id AS "toUserId",
        actor_id AS "actorId", created_at AS "createdAt"
       FROM brand_owner_transfer WHERE id = ?`,
      [id],
    );
    return row ? transferRow.parse(row) : null;
  }

  async invitationsForInvitee(userId: string) {
    const query = invitationsForInviteeQuery(userId);
    const rows = await this.query(query.sql, query.values);
    return rows.map((row) => invitationListRow.parse(row));
  }

  async invitationsForBrands(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const rows = await this.query(
      `SELECT ${invitationColumns}
       FROM team_invitation
       WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY created_at, id
       LIMIT ?`,
      [...brandIds, teamListLimit],
    );
    return rows.map((row) => invitationListRow.parse(row));
  }

  async invitationById(id: string) {
    const [row] = await this.query(
      `SELECT ${invitationColumns} FROM team_invitation WHERE id = ?`,
      [id],
    );
    return row ? invitationListRow.parse(row) : null;
  }

  async invitationByTokenHash(tokenHash: string) {
    const query = invitationByTokenHashQuery(tokenHash);
    const [row] = await this.query(query.sql, query.values);
    return row ? invitationTokenRow.parse(row) : null;
  }

  async insertInvitation(row: {
    id: string;
    brandId: string;
    inviteeUserId: string;
    createdBy: string;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
  }) {
    await this.query(
      `INSERT INTO team_invitation
        (id, brand_id, invitee_user_id, created_by, role, token_hash, expires_at, status, created_at, replaced_by)
       VALUES (?, ?, ?, ?, 'member', ?, ?, 'open', ?, NULL)`,
      [row.id, row.brandId, row.inviteeUserId, row.createdBy, row.tokenHash, row.expiresAt, row.createdAt],
    );
  }

  async claimInvitationResend(id: string, replacementId: string) {
    const rows = await this.query(
      `UPDATE team_invitation SET status = 'expired', replaced_by = ?
       WHERE id = ? AND replaced_by IS NULL AND status IN ('open', 'expired')
       RETURNING id`,
      [replacementId, id],
    );
    return rows.length === 1;
  }

  async acceptInvitation(id: string, now: string) {
    const rows = await this.query(
      `UPDATE team_invitation SET status = 'accepted'
       WHERE id = ? AND status = 'open' AND replaced_by IS NULL AND expires_at > ?
       RETURNING id`,
      [id, now],
    );
    return rows.length === 1;
  }

  async expireInvitation(id: string, now: string) {
    const rows = await this.query(
      `UPDATE team_invitation SET status = 'expired'
       WHERE id = ? AND status = 'open' AND replaced_by IS NULL AND expires_at <= ?
       RETURNING id`,
      [id, now],
    );
    return rows.length === 1;
  }

  async stopAction(id: string) {
    const rows = await this.query(
      `UPDATE queued_brand_action SET status = 'stopped' WHERE id = ? AND status = 'queued' RETURNING id`,
      [id],
    );
    return rows.length === 1;
  }
}
