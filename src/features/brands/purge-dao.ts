import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema, quotaKindSchema } from "../quotas/contracts.ts";
import { brandIdSchema } from "./contracts.ts";

export const purgePageSize = 25;
export const purgeTimeSchema = z.iso.datetime({ precision: 3 });
export const purgeTargetSchema = z.strictObject({ ownerId: opaqueIdSchema, brandId: brandIdSchema });
export const purgeCursorSchema = z.strictObject({ at: purgeTimeSchema, id: brandIdSchema });
export const purgeMarkerSchema = purgeTargetSchema.extend({ frozenAt: purgeTimeSchema, startedAt: purgeTimeSchema });
export type PurgeTarget = z.infer<typeof purgeTargetSchema>;
export type PurgeMarker = z.infer<typeof purgeMarkerSchema>;
export type PurgeCursor = z.infer<typeof purgeCursorSchema>;
const purgeCandidateSchema = purgeTargetSchema.extend({ restoreUntil: purgeTimeSchema });
const receiptSchema = purgeMarkerSchema.extend({
  step: z.int().min(0).max(3),
  issue: z.enum(["contents-failed", "exports-failed", "costs-failed", "unresolved-costs"]).nullable(),
  completedAt: purgeTimeSchema.nullable(),
});
const costSchema = z.object({
  kind: quotaKindSchema, reservationId: z.uuid(), attemptId: z.uuid(),
  currency: quotaCurrencySchema, actualMinor: minorAmountSchema,
  startedAt: purgeTimeSchema, reconciledAt: purgeTimeSchema,
});
export const costCursorSchema = costSchema.pick({ kind: true, reservationId: true, attemptId: true }).strict();
type CostCursor = z.infer<typeof costCursorSchema>;
export type PurgeIssue = z.infer<typeof receiptSchema>["issue"];
const markerColumns = 'brand_id AS "brandId", owner_id AS "ownerId", frozen_at AS "frozenAt", started_at AS "startedAt"';
const receiptColumns = markerColumns + ', step, issue, completed_at AS "completedAt"';

export class PurgeDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async due(now: string, limit: number, cursor?: PurgeCursor) {
    const rows = await this.query(`SELECT owner_id AS "ownerId", id AS "brandId", restore_until AS "restoreUntil"
      FROM brand WHERE restore_until <= ? AND frozen_at IS NOT NULL
      ${cursor ? "AND (restore_until, id) > (?, ?)" : ""} ORDER BY restore_until, id LIMIT ?`,
    cursor ? [now, cursor.at, cursor.id, limit] : [now, limit]);
    return z.array(purgeCandidateSchema).parse(rows);
  }

  async lockBrand(brandId: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR NO KEY UPDATE" : "";
    const [row] = await this.query(`SELECT owner_id AS "ownerId", created_at AS "createdAt",
      frozen_at AS "frozenAt", restore_until AS "restoreUntil" FROM brand WHERE id = ?${lock}`, [brandId]);
    return row ? z.object({
      ownerId: opaqueIdSchema, createdAt: purgeTimeSchema,
      frozenAt: purgeTimeSchema.nullable(), restoreUntil: purgeTimeSchema.nullable(),
    }).parse(row) : null;
  }

  async receipt(target: PurgeTarget) {
    const [row] = await this.query(`SELECT ${receiptColumns} FROM brand_purge WHERE brand_id = ? AND owner_id = ?`,
      [target.brandId, target.ownerId]);
    return row ? receiptSchema.parse(row) : null;
  }

  async start(marker: PurgeMarker) {
    await this.query(`INSERT INTO brand_purge (brand_id, owner_id, frozen_at, started_at, step)
      VALUES (?, ?, ?, ?, 0)`, [marker.brandId, marker.ownerId, marker.frozenAt, marker.startedAt]);
  }

  async checkpoint(target: PurgeTarget, step: number, issue: PurgeIssue, completedAt: string | null) {
    const [row] = await this.query(`UPDATE brand_purge SET step = ?, issue = ?, completed_at = ?
      WHERE brand_id = ? AND owner_id = ? RETURNING ${receiptColumns}`,
    [step, issue, completedAt, target.brandId, target.ownerId]);
    return receiptSchema.parse(row);
  }

  async freezeRestoredBrand(marker: PurgeMarker) {
    await this.query(`UPDATE brand SET frozen_at = ?, restore_until = ?, revision = revision + 1
      WHERE id = ? AND owner_id = ?`, [marker.frozenAt, marker.startedAt, marker.brandId, marker.ownerId]);
  }

  async clearContents(target: PurgeTarget, createdAt: string | null) {
    const { ownerId, brandId } = target;
    await this.query("DELETE FROM brand_draft WHERE owner_id = ? AND scope = ?", [ownerId, brandId]);
    await this.query("DELETE FROM prompt_reference WHERE brand_id = ?", [brandId]);
    await this.query("DELETE FROM prompt_set WHERE brand_id = ?", [brandId]);
    await this.query("DELETE FROM prompt_draft WHERE brand_id = ?", [brandId]);
    await this.query("DELETE FROM brand_version WHERE brand_id = ?", [brandId]);
    await this.query("DELETE FROM brand_fact_paste WHERE brand_id = ?", [brandId]);

    // Before scope was recorded, only brand/deletion outcomes identified the
    // brand. A 'new' draft used during onboarding can also predate this brand.
    const id = this.connection.kind === "postgresql" ? "CAST(result AS jsonb) ->> 'id'" : "json_extract(result, '$.id')";
    const kind = this.connection.kind === "postgresql" ? "CAST(result AS jsonb) ->> 'kind'" : "json_extract(result, '$.kind')";
    await this.query(`UPDATE brand_operation SET fingerprint = ''
      WHERE owner_id = ? AND fingerprint <> '' AND
      (scope = ? OR (scope = 'new' AND created_at <= ?) OR (scope IS NULL AND ((${id}) = ? OR (${kind}) = 'draft')))`,
    [ownerId, brandId, createdAt, brandId]);
  }

  async clearExports(marker: PurgeMarker) {
    // B05 persists one fingerprint per owner and rebuilds bytes on download.
    // A brand export generated while the brand was frozen excludes its content.
    await this.query(`DELETE FROM user_data_export WHERE owner_id = ? AND (included & 2) <> 0 AND created_at <= ?`,
      [marker.ownerId, marker.frozenAt]);
  }

  async clearLedger(target: PurgeTarget) {
    const [unresolved] = await this.query(`SELECT id FROM quota_attempt WHERE brand_id = ? AND state <> 'known' LIMIT 1`,
      [target.brandId]);
    if (unresolved) return false;

    await this.query(`INSERT INTO brand_purged_cost
      (brand_id, kind, reservation_id, attempt_id, currency, actual_minor, started_at, reconciled_at)
      SELECT a.brand_id, a.kind, a.reservation_id, a.id, g.currency, a.actual_minor, a.started_at, a.reconciled_at
      FROM quota_attempt a JOIN quota_reservation r
        ON (r.brand_id, r.kind, r.id) = (a.brand_id, a.kind, a.reservation_id)
      JOIN quota_grant g ON (g.brand_id, g.kind, g.version) = (r.brand_id, r.kind, r.grant_version)
      WHERE a.brand_id = ? ON CONFLICT (brand_id, kind, reservation_id, attempt_id) DO NOTHING`, [target.brandId]);
    await this.query("DELETE FROM brand WHERE id = ? AND owner_id = ?", [target.brandId, target.ownerId]);
    return true;
  }

  async costPage(target: PurgeTarget, cursor?: CostCursor) {
    const rows = await this.query(`SELECT kind, reservation_id AS "reservationId", attempt_id AS "attemptId",
      currency, actual_minor AS "actualMinor", c.started_at AS "startedAt", reconciled_at AS "reconciledAt"
      FROM brand_purged_cost c JOIN brand_purge p USING (brand_id) WHERE brand_id = ? AND p.owner_id = ?
      ${cursor ? "AND (kind, reservation_id, attempt_id) > (?, ?, ?)" : ""}
      ORDER BY kind, reservation_id, attempt_id LIMIT ?`,
    cursor
      ? [target.brandId, target.ownerId, cursor.kind, cursor.reservationId, cursor.attemptId, purgePageSize + 1]
      : [target.brandId, target.ownerId, purgePageSize + 1]);
    return z.array(costSchema).parse(rows);
  }

  async markers(after?: string) {
    const rows = await this.query(`SELECT ${markerColumns} FROM brand_purge
      ${after ? "WHERE brand_id > ?" : ""} ORDER BY brand_id LIMIT ?`, after ? [after, purgePageSize + 1] : [purgePageSize + 1]);
    return z.array(purgeMarkerSchema).parse(rows);
  }
}
