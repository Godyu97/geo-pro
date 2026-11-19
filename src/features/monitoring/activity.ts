import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryWithParameters, type DatabaseConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema, quotaKindSchema } from "../quotas/contracts.ts";
import { QuotaDao } from "../quotas/dao.ts";
import { slotStatuses } from "./contracts.ts";

const pageSize = 20;
const rowSchema = z.object({
  brandId: brandIdSchema,
  kind: quotaKindSchema,
  id: brandIdSchema,
  state: z.enum(["reserved", "settled", "released"]),
  upperMinor: minorAmountSchema,
  createdAt: z.string(),
  finalizedAt: z.string().nullable(),
  currency: quotaCurrencySchema,
  slotId: brandIdSchema.nullable(),
  runId: brandIdSchema.nullable(),
  slotStatus: z.enum(slotStatuses).nullable(),
});
const attemptSchema = z.object({
  brandId: brandIdSchema,
  reservationId: brandIdSchema,
  id: brandIdSchema,
  state: z.enum(["pending", "unknown", "known"]),
  upperMinor: minorAmountSchema,
  actualMinor: minorAmountSchema.nullable(),
  startedAt: z.string(),
});
const summarySchema = z.object({
  currency: quotaCurrencySchema,
  reservedMinor: z.coerce.number().int().nonnegative(),
  actualMinor: z.coerce.number().int().nonnegative(),
  pendingMinor: z.coerce.number().int().nonnegative(),
  unresolved: z.coerce.number().int().nonnegative(),
});

export const usageFilterSchema = z.strictObject({
  kind: quotaKindSchema.optional(),
  state: z.enum(["reserved", "settled", "released"]).optional(),
  currency: quotaCurrencySchema.optional(),
  beforeCreatedAt: z.string().min(1).optional(),
  beforeId: brandIdSchema.optional(),
}).refine((value) => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId));

export type UsageFilter = z.infer<typeof usageFilterSchema>;

export async function readOwnerUsage(connection: DatabaseConnection, ownerId: string, filter: UsageFilter) {
  try {
    const parsed = usageFilterSchema.parse(filter);
    const brands = await queryWithParameters(connection, "SELECT id FROM brand WHERE owner_id = ?", [ownerId]);
    const brandIds = brands.map((row) => brandIdSchema.parse(row.id));
    const grants = await new QuotaDao(connection).ownerSummary(ownerId);
    if (!brandIds.length) {
      return { items: [], attempts: [], summaries: [], grants, next: null, customerPayableMinor: 0 as const };
    }
    const values: QueryValue[] = [...brandIds];
    let where = `WHERE r.brand_id IN (${brandIds.map(() => "?").join(", ")})`;
    if (parsed.kind) {
      where += " AND r.kind = ?";
      values.push(parsed.kind);
    }
    if (parsed.state) {
      where += " AND r.state = ?";
      values.push(parsed.state);
    }
    if (parsed.currency) {
      where += " AND g.currency = ?";
      values.push(parsed.currency);
    }
    if (parsed.beforeCreatedAt && parsed.beforeId) {
      where += " AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))";
      values.push(parsed.beforeCreatedAt, parsed.beforeCreatedAt, parsed.beforeId);
    }
    const rows = z.array(rowSchema).parse(await queryWithParameters(connection, `SELECT r.brand_id AS "brandId", r.kind, r.id,
      r.state, r.upper_minor AS "upperMinor", r.created_at AS "createdAt", r.finalized_at AS "finalizedAt", g.currency,
      s.id AS "slotId", s.run_id AS "runId", s.status AS "slotStatus"
      FROM quota_reservation r
      JOIN quota_grant g ON g.brand_id = r.brand_id AND g.kind = r.kind AND g.version = r.grant_version
      LEFT JOIN monitoring_slot s ON s.brand_id = r.brand_id AND s.reservation_id = r.id
      ${where}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, [...values, pageSize + 1]));
    const items = rows.slice(0, pageSize);
    const last = rows.length > pageSize ? items.at(-1) ?? null : null;
    const reservationIds = items.map((item) => item.id);
    const attempts = reservationIds.length ? z.array(attemptSchema).parse(await queryWithParameters(connection, `SELECT brand_id AS "brandId",
      reservation_id AS "reservationId", id, state, upper_minor AS "upperMinor", actual_minor AS "actualMinor", started_at AS "startedAt"
      FROM quota_attempt WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
        AND reservation_id IN (${reservationIds.map(() => "?").join(", ")})
      ORDER BY started_at, id`, [...brandIds, ...reservationIds])) : [];
    const summaries = z.array(summarySchema).parse(await queryWithParameters(connection, `SELECT g.currency,
      COALESCE(SUM(CASE WHEN r.state = 'reserved' THEN r.upper_minor ELSE 0 END), 0) AS "reservedMinor",
      COALESCE(SUM(CASE WHEN a.state = 'known' THEN a.actual_minor ELSE 0 END), 0) AS "actualMinor",
      COALESCE(SUM(CASE WHEN a.state IS NOT NULL AND a.state <> 'known' THEN a.upper_minor ELSE 0 END), 0) AS "pendingMinor",
      COALESCE(SUM(CASE WHEN a.state IS NOT NULL AND a.state <> 'known' THEN 1 ELSE 0 END), 0) AS unresolved
      FROM quota_reservation r
      JOIN quota_grant g ON g.brand_id = r.brand_id AND g.kind = r.kind AND g.version = r.grant_version
      LEFT JOIN quota_attempt a ON a.brand_id = r.brand_id AND a.kind = r.kind AND a.reservation_id = r.id
      WHERE r.brand_id IN (${brandIds.map(() => "?").join(", ")})
      GROUP BY g.currency ORDER BY g.currency`, brandIds));
    return {
      items, attempts, summaries, grants, customerPayableMinor: 0 as const,
      next: last ? { beforeCreatedAt: last.createdAt, beforeId: last.id } : null,
    };
  } catch (error) {
    const traceId = randomUUID();
    console.error("monitoring-usage-unavailable", { traceId, errorName: error instanceof Error ? error.name : "unknown" });
    return { traceId };
  }
}
