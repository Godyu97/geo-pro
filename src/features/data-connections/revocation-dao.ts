import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  retainedRowLimit,
  syncAttemptPageLimit,
  syncAttemptResults,
  syncAuthorizationListLimit,
  type SyncAttemptResult,
} from "./revocation-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const timestampSchema = z.iso.datetime({ precision: 3 });
const resultSchema = z.enum(syncAttemptResults);

const authorizationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  sourceName: z.string().min(1).max(80),
  revoked: flag,
  retainedRows: z.number().int().min(0).max(retainedRowLimit),
  historyDeleted: z.literal(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const attemptRow = z.object({
  id: brandIdSchema,
  authorizationId: brandIdSchema,
  result: resultSchema,
  attemptedAt: timestampSchema,
});

export type SyncAuthorizationRecord = z.infer<typeof authorizationRow>;
export type SyncAttemptRecord = z.infer<typeof attemptRow>;

export type SyncAuthorizationInsert = {
  id: string;
  brandId: string;
  ownerId: string;
  sourceName: string;
  revoked: 0 | 1;
  retainedRows: number;
  historyDeleted: 0;
  createdAt: string;
  updatedAt: string;
};

export type SyncAttemptInsert = {
  id: string;
  authorizationId: string;
  brandId: string;
  ownerId: string;
  result: SyncAttemptResult;
  attemptedAt: string;
};

const authorizationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", source_name AS "sourceName",
  revoked, retained_rows AS "retainedRows", history_deleted AS "historyDeleted",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export function syncAuthorizationsForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT ${authorizationColumns} FROM sync_authorization
      WHERE owner_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT ?`,
    values: [ownerId, syncAuthorizationListLimit] as QueryValue[],
  };
}

export function syncAttemptsForOwnerQuery(ownerId: string, authorizationIds: readonly string[]) {
  const limit = Math.max(authorizationIds.length, 1) * syncAttemptPageLimit;
  if (authorizationIds.length === 0) {
    return {
      sql: `SELECT id, authorization_id AS "authorizationId", result, attempted_at AS "attemptedAt"
        FROM sync_attempt
        WHERE owner_id = ? AND 1 = 0
        LIMIT ?`,
      values: [ownerId, limit] as QueryValue[],
    };
  }
  return {
    sql: `SELECT id, "authorizationId", result, "attemptedAt"
      FROM (
        SELECT id,
          authorization_id AS "authorizationId",
          result,
          attempted_at AS "attemptedAt",
          row_number() OVER (
            PARTITION BY authorization_id
            ORDER BY attempted_at DESC, id ASC
          ) AS attempt_rank
        FROM sync_attempt
        WHERE owner_id = ? AND authorization_id IN (${authorizationIds.map(() => "?").join(", ")})
      ) ranked
      WHERE attempt_rank <= ?
      ORDER BY "attemptedAt" DESC, id ASC
      LIMIT ?`,
    values: [ownerId, ...authorizationIds, syncAttemptPageLimit, limit] as QueryValue[],
  };
}

export function syncAuthorizationForSourceQuery(ownerId: string, brandId: string, sourceName: string) {
  return {
    sql: `SELECT ${authorizationColumns} FROM sync_authorization
      WHERE owner_id = ? AND brand_id = ? AND source_name = ?
      ORDER BY revoked ASC, updated_at DESC, id ASC
      LIMIT 1`,
    values: [ownerId, brandId, sourceName] as QueryValue[],
  };
}

export class SyncAuthorizationDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  async activeBrandIds(ownerId: string) {
    const rows = await queryWithParameters(
      this.db,
      `SELECT id FROM brand
        WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
      [ownerId, 20],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows);
  }

  async insertAuthorization(row: SyncAuthorizationInsert) {
    await queryWithParameters(
      this.db,
      `INSERT INTO sync_authorization (
        id, brand_id, owner_id, source_name, revoked, retained_rows, history_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.sourceName, row.revoked, row.retainedRows, row.historyDeleted,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async insertAttempts(rows: readonly SyncAttemptInsert[]) {
    if (rows.length === 0) return;
    await queryWithParameters(
      this.db,
      `INSERT INTO sync_attempt (
        id, authorization_id, brand_id, owner_id, result, attempted_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      rows.flatMap((row) => [row.id, row.authorizationId, row.brandId, row.ownerId, row.result, row.attemptedAt]),
    );
  }

  async authorizationForOwner(ownerId: string, authorizationId: string, lock: boolean) {
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(
      this.db,
      `SELECT ${authorizationColumns} FROM sync_authorization
        WHERE id = ? AND owner_id = ?
        LIMIT 1${clause}`,
      [authorizationId, ownerId],
    );
    return row ? authorizationRow.parse(row) : null;
  }

  async authorizationsForOwner(ownerId: string) {
    const query = syncAuthorizationsForOwnerQuery(ownerId);
    return z.array(authorizationRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async attemptsForOwner(ownerId: string, authorizationIds: readonly string[]) {
    const query = syncAttemptsForOwnerQuery(ownerId, authorizationIds);
    return z.array(attemptRow).parse(await queryWithParameters(this.db, query.sql, query.values));
  }

  async authorizationForSource(ownerId: string, brandId: string, sourceName: string, lock: boolean) {
    const query = syncAuthorizationForSourceQuery(ownerId, brandId, sourceName);
    const clause = lock && this.db.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await queryWithParameters(this.db, query.sql + clause, query.values);
    return row ? authorizationRow.parse(row) : null;
  }

  async markRevoked(ownerId: string, authorizationId: string, retainedRows: number, updatedAt: string) {
    const rows = await queryWithParameters(
      this.db,
      `UPDATE sync_authorization
        SET revoked = 1, updated_at = ?
        WHERE id = ? AND owner_id = ? AND revoked = 0 AND history_deleted = 0 AND retained_rows = ?
        RETURNING id`,
      [updatedAt, authorizationId, ownerId, retainedRows],
    );
    return rows.length === 1;
  }
}
