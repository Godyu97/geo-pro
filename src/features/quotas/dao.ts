import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { grantSnapshotSchema, minorAmountSchema, quotaCurrencySchema, quotaKindSchema, type GrantSnapshot, type QuotaChange, type QuotaKind } from "./contracts.ts";

const total = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ledgerSchema = z.object({
  reserved: total, settled: total, committedMinor: total, actualMinor: total, unresolved: total, records: total,
});
export const emptyLedger = { reserved: 0, settled: 0, committedMinor: 0, actualMinor: 0, unresolved: 0, records: 0 };
const reservationSchema = z.object({
  grantVersion: z.int().positive(),
  currency: quotaCurrencySchema,
  upperMinor: minorAmountSchema,
  state: z.enum(["reserved", "settled", "released"]),
});
const attemptSchema = z.object({
  upperMinor: minorAmountSchema,
  actualMinor: minorAmountSchema.nullable(),
  state: z.enum(["pending", "unknown", "known"]),
});

const grantColumns = `version, action, count_limit AS "countLimit", budget_minor AS "budgetMinor", currency,
  expires_at AS "expiresAt", changed_at AS "changedAt"`;
// target is always a single brand chosen by owner scope or a locked brand ID.
const ledgerQuery = `attempt_cost AS (
  SELECT a.kind, a.reservation_id, SUM(COALESCE(a.actual_minor, 0)) AS actual,
    SUM(CASE WHEN a.state <> 'known' THEN a.upper_minor ELSE 0 END) AS upper,
    SUM(CASE WHEN a.state <> 'known' THEN 1 ELSE 0 END) AS unresolved
  FROM quota_attempt a WHERE a.brand_id = (SELECT id FROM target)
  GROUP BY a.kind, a.reservation_id
), ledger AS (
  SELECT r.kind,
    SUM(CASE WHEN r.state = 'reserved' THEN 1 ELSE 0 END) AS reserved,
    SUM(CASE WHEN r.state = 'settled' THEN 1 ELSE 0 END) AS settled,
    SUM(COALESCE(a.actual, 0)) AS actual,
    SUM(COALESCE(a.unresolved, 0)) AS unresolved,
    SUM(CASE WHEN (r.state = 'reserved' OR COALESCE(a.unresolved, 0) > 0)
          AND r.upper_minor > COALESCE(a.actual, 0) + COALESCE(a.upper, 0)
      THEN r.upper_minor ELSE COALESCE(a.actual, 0) + COALESCE(a.upper, 0) END) AS committed,
    COUNT(*) AS records
  FROM quota_reservation r LEFT JOIN attempt_cost a ON a.kind = r.kind AND a.reservation_id = r.id
  WHERE r.brand_id = (SELECT id FROM target)
  GROUP BY r.kind
)`;
const ledgerColumns = `l.reserved, l.settled, l.actual AS "actualMinor", l.unresolved,
  l.committed AS "committedMinor", l.records`;

export type ReservationScope = { brandId: string; kind: QuotaKind; reservationId: string };
export type AttemptScope = ReservationScope & { attemptId: string };

export class QuotaDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async lockBrand(brandId: string, ownerId?: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR NO KEY UPDATE" : "";
    const [row] = await this.query(`SELECT status FROM brand WHERE id = ?${ownerId === undefined ? "" : " AND owner_id = ?"}${lock}`,
      ownerId === undefined ? [brandId] : [brandId, ownerId]);
    return row ? z.enum(["active", "archived"]).parse(row.status) : null;
  }

  async grant(brandId: string, kind: QuotaKind, version?: number) {
    const [row] = await this.query(`SELECT ${grantColumns} FROM quota_grant WHERE brand_id = ? AND kind = ?
      ${version === undefined ? "ORDER BY version DESC LIMIT 1" : "AND version = ?"}`,
    version === undefined ? [brandId, kind] : [brandId, kind, version]);
    return row ? grantSnapshotSchema.parse(row) : null;
  }

  async previousChange(command: QuotaChange) {
    const [row] = await this.query(`SELECT fingerprint, ${grantColumns} FROM quota_grant
      WHERE brand_id = ? AND kind = ? AND operation_id = ?`, [command.brandId, command.kind, command.operationId]);
    return row ? { fingerprint: z.string().parse(row.fingerprint), after: grantSnapshotSchema.parse(row) } : null;
  }

  async appendGrant(command: QuotaChange, snapshot: GrantSnapshot, fingerprint: string) {
    await this.query(`INSERT INTO quota_grant
      (brand_id, kind, version, operation_id, fingerprint, actor_id, reason, count_limit, budget_minor, currency, expires_at, changed_at, action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [command.brandId, command.kind, snapshot.version, command.operationId, fingerprint, command.actorId, command.reason,
      snapshot.countLimit, snapshot.budgetMinor, snapshot.currency, snapshot.expiresAt, snapshot.changedAt, snapshot.action]);
  }

  async ledger(brandId: string, kind: QuotaKind) {
    const [row] = await this.query(`WITH target AS (SELECT id FROM brand WHERE id = ?), ${ledgerQuery}
      SELECT ${ledgerColumns} FROM ledger l WHERE l.kind = ?`, [brandId, kind]);
    return row ? ledgerSchema.parse(row) : emptyLedger;
  }

  async ownerSummary(ownerId: string) {
    const rows = await this.query(`WITH target AS (SELECT id FROM brand WHERE owner_id = ? AND status = 'active'),
      kinds(kind) AS (VALUES ('sampling'), ('generation')), ${ledgerQuery}
      SELECT k.kind, ${grantColumns}, ${ledgerColumns} FROM target t CROSS JOIN kinds k
      LEFT JOIN quota_grant g ON g.brand_id = t.id AND g.kind = k.kind AND g.version = (
        SELECT q.version FROM quota_grant q WHERE q.brand_id = t.id AND q.kind = k.kind ORDER BY q.version DESC LIMIT 1
      )
      LEFT JOIN ledger l ON l.kind = k.kind`, [ownerId]);
    return rows.map((row) => ({
      kind: quotaKindSchema.parse(row.kind),
      grant: row.version === null ? null : grantSnapshotSchema.parse(row),
      ledger: row.records === null ? emptyLedger : ledgerSchema.parse(row),
    }));
  }

  async reservation(scope: ReservationScope) {
    const [row] = await this.query(`SELECT r.grant_version AS "grantVersion", g.currency, r.upper_minor AS "upperMinor", r.state
      FROM quota_reservation r JOIN quota_grant g
        ON g.brand_id = r.brand_id AND g.kind = r.kind AND g.version = r.grant_version
      WHERE r.brand_id = ? AND r.kind = ? AND r.id = ?`, [scope.brandId, scope.kind, scope.reservationId]);
    return row ? reservationSchema.parse(row) : null;
  }

  async insertReservation(scope: ReservationScope, version: number, upperMinor: number, time: string) {
    await this.query(`INSERT INTO quota_reservation
      (brand_id, kind, id, grant_version, upper_minor, state, created_at) VALUES (?, ?, ?, ?, ?, 'reserved', ?)`,
    [scope.brandId, scope.kind, scope.reservationId, version, upperMinor, time]);
  }

  async attemptTotals(scope: ReservationScope) {
    const [row] = await this.query(`SELECT COALESCE(SUM(actual_minor), 0) AS actual,
      COALESCE(SUM(CASE WHEN state <> 'known' THEN 1 ELSE 0 END), 0) AS unresolved, COUNT(*) AS attempts
      FROM quota_attempt WHERE brand_id = ? AND kind = ? AND reservation_id = ?`,
    [scope.brandId, scope.kind, scope.reservationId]);
    return z.object({ actual: total, unresolved: total, attempts: total }).parse(row);
  }

  async attempt(scope: AttemptScope) {
    const [row] = await this.query(`SELECT upper_minor AS "upperMinor", actual_minor AS "actualMinor", state FROM quota_attempt
      WHERE brand_id = ? AND kind = ? AND reservation_id = ? AND id = ?`,
    [scope.brandId, scope.kind, scope.reservationId, scope.attemptId]);
    return row ? attemptSchema.parse(row) : null;
  }

  async insertAttempt(scope: AttemptScope, upperMinor: number, time: string) {
    await this.query(`INSERT INTO quota_attempt
      (brand_id, kind, reservation_id, id, upper_minor, state, started_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [scope.brandId, scope.kind, scope.reservationId, scope.attemptId, upperMinor, time]);
  }

  async updateAttempt(scope: AttemptScope, actualMinor: number | null, time: string) {
    await this.query(`UPDATE quota_attempt SET actual_minor = ?, state = ?, reconciled_at = ?
      WHERE brand_id = ? AND kind = ? AND reservation_id = ? AND id = ?`,
    [actualMinor, actualMinor === null ? "unknown" : "known", actualMinor === null ? null : time,
      scope.brandId, scope.kind, scope.reservationId, scope.attemptId]);
  }

  async finalize(scope: ReservationScope, state: "settled" | "released", time: string) {
    await this.query(`UPDATE quota_reservation SET state = ?, finalized_at = ? WHERE brand_id = ? AND kind = ? AND id = ?`,
    [state, time, scope.brandId, scope.kind, scope.reservationId]);
  }
}
