import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { delegationActionStatuses, delegationListLimit } from "./contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);

const accessRow = z.object({
  organizationId: brandIdSchema,
  membershipActive: flag,
  delegationId: brandIdSchema.nullable(),
  brandId: brandIdSchema.nullable(),
  delegationActive: flag.nullable(),
  expiresAt: z.string().nullable(),
  scope: z.string().nullable(),
  actionId: brandIdSchema.nullable(),
  actionStatus: z.enum(delegationActionStatuses).nullable(),
});

const managedRow = z.object({
  delegationId: brandIdSchema,
  brandId: brandIdSchema,
  organizationId: brandIdSchema,
  delegationActive: flag,
  expiresAt: z.string(),
  actionId: brandIdSchema.nullable(),
  actionStatus: z.enum(delegationActionStatuses).nullable(),
});

const brandOptionRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1).nullable(),
});

const brandGateRow = z.object({
  ownerId: z.string().min(1).max(128),
  status: z.enum(["active", "archived"]),
  frozenAt: z.string().nullable(),
});

const delegationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  organizationId: brandIdSchema,
  active: flag,
  expiresAt: z.string(),
});

export type DelegationAccess = {
  memberships: { organizationId: string }[];
  delegations: {
    id: string;
    organizationId: string;
    brandId: string;
    active: boolean;
    expiresAt: string;
    scope: string;
    actions: { id: string; status: "queued" | "stopped" }[];
  }[];
};

// One statement for every organization the user belongs to. Brand id is not a parameter.
export function delegationAccessQuery(userId: string) {
  return {
    sql: `SELECT m.organization_id AS "organizationId", m.active AS "membershipActive",
        d.id AS "delegationId", d.brand_id AS "brandId", d.active AS "delegationActive",
        d.expires_at AS "expiresAt", d.scope AS "scope",
        a.id AS "actionId", a.status AS "actionStatus"
      FROM agency_membership m
      LEFT JOIN brand_delegation d ON d.organization_id = m.organization_id
      LEFT JOIN delegation_action a ON a.delegation_id = d.id
      WHERE m.user_id = ? AND m.active = 1
      ORDER BY d.brand_id, d.id, a.id
      LIMIT ?`,
    values: [userId, delegationListLimit] as QueryValue[],
  };
}

export function managedDelegationQuery(ownerId: string) {
  return {
    sql: `SELECT d.id AS "delegationId", d.brand_id AS "brandId", d.organization_id AS "organizationId",
        d.active AS "delegationActive", d.expires_at AS "expiresAt",
        a.id AS "actionId", a.status AS "actionStatus"
      FROM brand_delegation d
      JOIN brand b ON b.id = d.brand_id
      LEFT JOIN delegation_action a ON a.delegation_id = d.id
      WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
      ORDER BY d.brand_id, d.id, a.id
      LIMIT ?`,
    values: [ownerId, delegationListLimit] as QueryValue[],
  };
}

function groupAccess(rows: z.infer<typeof accessRow>[]): DelegationAccess {
  const memberships = new Map<string, { organizationId: string }>();
  const delegations = new Map<string, DelegationAccess["delegations"][number]>();
  for (const row of rows) {
    memberships.set(row.organizationId, { organizationId: row.organizationId });
    if (!row.delegationId || !row.brandId || row.delegationActive === null || !row.expiresAt || !row.scope) continue;
    let delegation = delegations.get(row.delegationId);
    if (!delegation) {
      delegation = {
        id: row.delegationId,
        organizationId: row.organizationId,
        brandId: row.brandId,
        active: row.delegationActive === 1,
        expiresAt: row.expiresAt,
        scope: row.scope,
        actions: [],
      };
      delegations.set(row.delegationId, delegation);
    }
    if (row.actionId && row.actionStatus && !delegation.actions.some((action) => action.id === row.actionId)) {
      delegation.actions.push({ id: row.actionId, status: row.actionStatus });
    }
  }
  return { memberships: [...memberships.values()], delegations: [...delegations.values()] };
}

export class DelegationDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async accessForUser(userId: string) {
    const query = delegationAccessQuery(userId);
    const rows = await this.query(query.sql, query.values);
    return groupAccess(rows.map((row) => accessRow.parse(row)));
  }

  async managedForOwner(ownerId: string) {
    const query = managedDelegationQuery(ownerId);
    const rows = await this.query(query.sql, query.values);
    const delegations = new Map<string, z.infer<typeof managedRow> & { actions: { id: string; status: "queued" | "stopped" }[] }>();
    for (const raw of rows) {
      const row = managedRow.parse(raw);
      let delegation = delegations.get(row.delegationId);
      if (!delegation) {
        delegation = { ...row, actions: [] };
        delegations.set(row.delegationId, delegation);
      }
      if (row.actionId && row.actionStatus && !delegation.actions.some((action) => action.id === row.actionId)) {
        delegation.actions.push({ id: row.actionId, status: row.actionStatus });
      }
    }
    return [...delegations.values()];
  }

  async ownedBrands(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, delegationListLimit],
    );
    return rows.map((row) => brandOptionRow.parse(row));
  }

  async userExists(userId: string) {
    const [row] = await this.query('SELECT id FROM "user" WHERE id = ?', [userId]);
    return Boolean(row);
  }

  async activeMember(organizationId: string, userId: string) {
    const [row] = await this.query(
      `SELECT id FROM agency_membership WHERE organization_id = ? AND user_id = ? AND active = 1`,
      [organizationId, userId],
    );
    return Boolean(row);
  }

  async organizationHasMember(organizationId: string) {
    const [row] = await this.query(
      `SELECT id FROM agency_membership WHERE organization_id = ? AND active = 1 LIMIT 1`,
      [organizationId],
    );
    return Boolean(row);
  }

  async brandGate(brandId: string) {
    const [row] = await this.query(
      `SELECT owner_id AS "ownerId", status, frozen_at AS "frozenAt" FROM brand WHERE id = ?`,
      [brandId],
    );
    return row ? brandGateRow.parse(row) : null;
  }

  async insertMembership(row: { id: string; organizationId: string; userId: string; createdAt: string }) {
    await this.query(
      `INSERT INTO agency_membership (id, organization_id, user_id, active, created_at) VALUES (?, ?, ?, 1, ?)`,
      [row.id, row.organizationId, row.userId, row.createdAt],
    );
  }

  async insertDelegation(row: {
    id: string;
    brandId: string;
    organizationId: string;
    expiresAt: string;
    scope: string;
    createdAt: string;
  }) {
    await this.query(
      `INSERT INTO brand_delegation
        (id, brand_id, organization_id, active, expires_at, scope, created_at, expired_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, NULL)`,
      [row.id, row.brandId, row.organizationId, row.expiresAt, row.scope, row.createdAt],
    );
  }

  async insertAction(row: { id: string; delegationId: string; createdAt: string }) {
    await this.query(
      `INSERT INTO delegation_action (id, delegation_id, status, created_at) VALUES (?, ?, 'queued', ?)`,
      [row.id, row.delegationId, row.createdAt],
    );
  }

  async delegationForOwner(id: string) {
    const [row] = await this.query(
      `SELECT d.id, d.brand_id AS "brandId", d.organization_id AS "organizationId", d.active, d.expires_at AS "expiresAt",
          b.owner_id AS "ownerId"
       FROM brand_delegation d
       JOIN brand b ON b.id = d.brand_id
       WHERE d.id = ?`,
      [id],
    );
    if (!row) return null;
    const ownerId = z.string().min(1).max(128).parse(row.ownerId);
    const delegation = delegationRow.parse(row);
    return { ...delegation, ownerId };
  }

  async expire(id: string, now: string) {
    const rows = await this.query(
      `UPDATE brand_delegation SET active = 0, expired_at = ? WHERE id = ? AND active = 1 RETURNING id`,
      [now, id],
    );
    return rows.length === 1;
  }

  async stopQueued(delegationId: string) {
    await this.query(
      `UPDATE delegation_action SET status = 'stopped' WHERE delegation_id = ? AND status = 'queued'`,
      [delegationId],
    );
  }

  async stopAction(id: string) {
    await this.query(
      `UPDATE delegation_action SET status = 'stopped' WHERE id = ? AND status = 'queued'`,
      [id],
    );
  }
}
