import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { alertKindSchema, alertReasonSchema, alertStatusSchema, alertWindowIdSchema } from "./contracts.ts";

const alertRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  kind: alertKindSchema,
  windowId: alertWindowIdSchema,
  status: alertStatusSchema,
  claimBrandDecline: z.union([z.literal(0), z.literal(1)]),
  reason: alertReasonSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const eventRow = z.object({
  id: brandIdSchema,
  alertId: brandIdSchema,
  occurredAt: z.iso.datetime({ precision: 3 }),
});

const alertIdentityRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
});

export type QualityAlertRecord = z.infer<typeof alertRow>;
export type QualityAlertEventRecord = z.infer<typeof eventRow>;

const alertColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", kind, window_id AS "windowId",
  status, claim_brand_decline AS "claimBrandDecline", reason, created_at AS "createdAt", updated_at AS "updatedAt"`;

const eventColumns = `id, alert_id AS "alertId", occurred_at AS "occurredAt"`;

export function qualityAlertListQuery(ownerId: string, brandId: string) {
  return {
    sql: `SELECT ${alertColumns} FROM quality_alert
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY updated_at DESC, id ASC`,
    values: [ownerId, brandId] as QueryValue[],
  };
}

export function qualityAlertEventQuery(ownerId: string, alertIds: readonly string[]) {
  if (alertIds.length === 0) return null;
  return {
    sql: `SELECT ${eventColumns} FROM quality_alert_event
      WHERE owner_id = ? AND alert_id IN (${alertIds.map(() => "?").join(", ")})
      ORDER BY alert_id ASC, occurred_at ASC, id ASC`,
    values: [ownerId, ...alertIds] as QueryValue[],
  };
}

export class QualityAlertDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async insertAlerts(rows: readonly QualityAlertRecord[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(
        row.id, row.brandId, row.ownerId, row.kind, row.windowId, row.status,
        row.claimBrandDecline, row.reason, row.createdAt, row.updatedAt,
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO quality_alert (
        id, brand_id, owner_id, kind, window_id, status, claim_brand_decline, reason, created_at, updated_at
      ) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async insertEvents(rows: readonly (QualityAlertEventRecord & { brandId: string; ownerId: string })[]) {
    if (rows.length === 0) return;
    const values: QueryValue[] = [];
    const groups = rows.map((row) => {
      values.push(row.id, row.alertId, row.brandId, row.ownerId, row.occurredAt);
      return "(?, ?, ?, ?, ?)";
    });
    await queryWithParameters(
      this.db,
      `INSERT INTO quality_alert_event (id, alert_id, brand_id, owner_id, occurred_at) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  async openAlert(ownerId: string, brandId: string, kind: QualityAlertRecord["kind"], windowId: string) {
    const lock = this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${alertColumns} FROM quality_alert
       WHERE owner_id = ? AND brand_id = ? AND kind = ? AND window_id = ? AND status <> 'resolved'
       LIMIT 1${lock}`,
      [ownerId, brandId, kind, windowId],
    );
    return row ? alertRow.parse(row) : null;
  }

  async alertIdentity(alertId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT id, brand_id AS "brandId", owner_id AS "ownerId" FROM quality_alert WHERE id = ?`,
      [alertId],
    );
    return row ? alertIdentityRow.parse(row) : null;
  }

  async alertForOwner(ownerId: string, alertId: string) {
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${alertColumns} FROM quality_alert WHERE id = ? AND owner_id = ?`,
      [alertId, ownerId],
    );
    return row ? alertRow.parse(row) : null;
  }

  async alertsForBrand(ownerId: string, brandId: string) {
    const query = qualityAlertListQuery(ownerId, brandId);
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(alertRow).parse(rows);
  }

  async eventsFor(ownerId: string, alertIds: readonly string[]) {
    const query = qualityAlertEventQuery(ownerId, alertIds);
    if (!query) return [];
    const rows = await queryWithParameters(this.db, query.sql, query.values);
    return z.array(eventRow).parse(rows);
  }

  async touch(ownerId: string, alertId: string, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE quality_alert SET updated_at = ? WHERE id = ? AND owner_id = ? RETURNING id`,
      [updatedAt, alertId, ownerId],
    );
    return rows.length === 1;
  }

  async setStatus(
    ownerId: string,
    alertId: string,
    from: QualityAlertRecord["status"],
    to: QualityAlertRecord["status"],
    updatedAt: string,
  ) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE quality_alert SET status = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = ?
       RETURNING id`,
      [to, updatedAt, alertId, ownerId, from],
    );
    return rows.length === 1;
  }
}
