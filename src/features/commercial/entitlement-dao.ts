import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  entitlementListLimit,
  type EntitlementUsageView,
  type EntitlementView,
  type UsageView,
} from "./entitlement-contracts.ts";
import {
  entitlementKinds,
  entitlementQuotaMax,
  usageKinds,
  usageTotals,
  type EntitlementKind,
  type UsageKind,
} from "./entitlement.ts";

const quota = z.number().int().min(0).max(entitlementQuotaMax);

const entitlementRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  version: z.number().int().min(1).max(entitlementQuotaMax),
  kind: z.enum(entitlementKinds),
  monitoringQuota: quota,
  contentQuota: quota,
  laborQuota: quota,
  createdAt: z.string().min(20).max(40),
}).strict();

const joinedRow = entitlementRow.extend({
  usageId: brandIdSchema.nullable(),
  usageKind: z.enum(usageKinds).nullable(),
  usageQuantity: z.number().int().min(1).max(entitlementQuotaMax).nullable(),
}).strict();

const usageRow = z.object({
  id: brandIdSchema,
  entitlementId: brandIdSchema,
  kind: z.enum(usageKinds),
  quantity: z.number().int().min(1).max(entitlementQuotaMax),
  createdAt: z.string().min(20).max(40),
}).strict();

const brandOptionRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1).nullable(),
});

const entitlementColumns = `id, brand_id AS "brandId", version, kind,
  monitoring_quota AS "monitoringQuota", content_quota AS "contentQuota", labor_quota AS "laborQuota",
  created_at AS "createdAt"`;

export function ownerEntitlementsQuery(ownerId: string) {
  return {
    sql: `SELECT e.id, e.brand_id AS "brandId", e.version, e.kind,
        e.monitoring_quota AS "monitoringQuota", e.content_quota AS "contentQuota", e.labor_quota AS "laborQuota",
        e.created_at AS "createdAt",
        u.id AS "usageId", u.kind AS "usageKind", u.quantity AS "usageQuantity"
      FROM (
        SELECT id, brand_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at
        FROM service_entitlement
        WHERE owner_id = ?
        ORDER BY created_at, id
        LIMIT ?
      ) e
      LEFT JOIN entitlement_usage u ON u.entitlement_id = e.id
      ORDER BY e.created_at, e.id, u.created_at, u.id`,
    values: [ownerId, entitlementListLimit] as QueryValue[],
  };
}

export function ownerEntitlementQuery(entitlementId: string, ownerId: string) {
  return {
    sql: `SELECT e.id, e.brand_id AS "brandId", e.version, e.kind,
        e.monitoring_quota AS "monitoringQuota", e.content_quota AS "contentQuota", e.labor_quota AS "laborQuota",
        e.created_at AS "createdAt",
        u.id AS "usageId", u.kind AS "usageKind", u.quantity AS "usageQuantity"
      FROM service_entitlement e
      LEFT JOIN entitlement_usage u ON u.entitlement_id = e.id
      WHERE e.id = ? AND e.owner_id = ?
      ORDER BY u.created_at, u.id`,
    values: [entitlementId, ownerId] as QueryValue[],
  };
}

function versionConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("service_entitlement_brand_kind_version_uidx")
    || message.includes("service_entitlement.brand_id, service_entitlement.kind, service_entitlement.version");
}

function entitlementFrom(row: z.infer<typeof entitlementRow>, usages: EntitlementUsageView[]): EntitlementView {
  return {
    id: row.id,
    brandId: row.brandId,
    version: row.version,
    kind: row.kind,
    monitoringQuota: row.monitoringQuota,
    contentQuota: row.contentQuota,
    laborQuota: row.laborQuota,
    createdAt: row.createdAt,
    usages,
    usageTotals: usageTotals(usages),
  };
}

function groupEntitlements(rows: z.infer<typeof joinedRow>[]) {
  const entitlements: EntitlementView[] = [];
  const byId = new Map<string, EntitlementView>();
  for (const row of rows) {
    let entitlement = byId.get(row.id);
    if (!entitlement) {
      entitlement = entitlementFrom(row, []);
      byId.set(row.id, entitlement);
      entitlements.push(entitlement);
    }
    if (row.usageId && row.usageKind && row.usageQuantity !== null) {
      entitlement.usages.push({ id: row.usageId, kind: row.usageKind, quantity: row.usageQuantity });
      entitlement.usageTotals = usageTotals(entitlement.usages);
    }
  }
  return entitlements;
}

export class EntitlementDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async entitlementsForOwner(ownerId: string) {
    const query = ownerEntitlementsQuery(ownerId);
    const rows = await this.query(query.sql, query.values);
    return groupEntitlements(rows.map((row) => joinedRow.parse(row)));
  }

  async entitlementForOwner(entitlementId: string, ownerId: string) {
    const query = ownerEntitlementQuery(entitlementId, ownerId);
    const rows = await this.query(query.sql, query.values);
    const [entitlement] = groupEntitlements(rows.map((row) => joinedRow.parse(row)));
    return entitlement ?? null;
  }

  async ownedBrands(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, entitlementListLimit],
    );
    return rows.map((row) => {
      const parsed = brandOptionRow.parse(row);
      return { id: parsed.brandId, name: parsed.name ?? parsed.brandId };
    });
  }

  async insertRegistered(row: {
    id: string;
    brandId: string;
    ownerId: string;
    kind: EntitlementKind;
    monitoringQuota: number;
    contentQuota: number;
    laborQuota: number;
    createdAt: string;
  }) {
    try {
      const rows = await this.query(
        `INSERT INTO service_entitlement
          (id, brand_id, owner_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at)
         SELECT ?, b.id, b.owner_id,
           COALESCE((SELECT MAX(version) FROM service_entitlement WHERE brand_id = b.id AND kind = ?), 0) + 1,
           ?, ?, ?, ?, ?
         FROM brand b
         WHERE b.id = ? AND b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
         RETURNING ${entitlementColumns}`,
        [
          row.id,
          row.kind,
          row.kind,
          row.monitoringQuota,
          row.contentQuota,
          row.laborQuota,
          row.createdAt,
          row.brandId,
          row.ownerId,
        ],
      );
      const [saved] = rows;
      return saved ? entitlementFrom(entitlementRow.parse(saved), []) : null;
    } catch (error) {
      if (versionConflict(error)) return "CONFLICT" as const;
      throw error;
    }
  }

  async insertRevision(row: {
    id: string;
    sourceId: string;
    ownerId: string;
    kind: EntitlementKind;
    monitoringQuota: number;
    contentQuota: number;
    laborQuota: number;
    createdAt: string;
  }) {
    try {
      const rows = await this.query(
        `INSERT INTO service_entitlement
          (id, brand_id, owner_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at)
         SELECT ?, e.brand_id, e.owner_id,
           COALESCE((SELECT MAX(version) FROM service_entitlement WHERE brand_id = e.brand_id AND kind = ?), 0) + 1,
           ?, ?, ?, ?, ?
         FROM service_entitlement e
         WHERE e.id = ? AND e.owner_id = ?
         RETURNING ${entitlementColumns}`,
        [
          row.id,
          row.kind,
          row.kind,
          row.monitoringQuota,
          row.contentQuota,
          row.laborQuota,
          row.createdAt,
          row.sourceId,
          row.ownerId,
        ],
      );
      const [saved] = rows;
      return saved ? entitlementFrom(entitlementRow.parse(saved), []) : null;
    } catch (error) {
      if (versionConflict(error)) return "CONFLICT" as const;
      throw error;
    }
  }

  async insertUsage(row: {
    id: string;
    entitlementId: string;
    ownerId: string;
    kind: UsageKind;
    quantity: number;
    createdAt: string;
  }) {
    const rows = await this.query(
      `INSERT INTO entitlement_usage (id, entitlement_id, kind, quantity, created_at)
       SELECT ?, e.id, ?, ?, ?
       FROM service_entitlement e
       WHERE e.id = ? AND e.owner_id = ?
       RETURNING id, entitlement_id AS "entitlementId", kind, quantity, created_at AS "createdAt"`,
      [row.id, row.kind, row.quantity, row.createdAt, row.entitlementId, row.ownerId],
    );
    const [saved] = rows;
    return saved ? usageRow.parse(saved) satisfies UsageView : null;
  }
}
