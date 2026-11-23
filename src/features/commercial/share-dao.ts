import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { shareListLimit, type ShareView } from "./share-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const token = (max: number) => z.string().regex(new RegExp(`^[a-z0-9_]{1,${max}}$`));
const stamp = z.string().min(20).max(40);

const shareRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  track: token(64),
  sampleSize: z.number().int().min(0).max(2_000_000_000),
  grade: token(32),
  expiresAt: stamp,
  revoked: flag,
  createdAt: stamp,
});

const joinedRow = shareRow.extend({
  accessId: brandIdSchema.nullable(),
  visitorId: z.string().min(1).max(128).nullable(),
  accessedAt: stamp.nullable(),
});

const brandOptionRow = z.object({
  brandId: brandIdSchema,
  name: z.string().min(1).nullable(),
});

export function sharesForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT s.id AS "id", s.brand_id AS "brandId", s.track AS "track",
        s.sample_size AS "sampleSize", s.grade AS "grade", s.expires_at AS "expiresAt",
        s.revoked AS "revoked", s.created_at AS "createdAt",
        a.id AS "accessId", a.visitor_id AS "visitorId", a.accessed_at AS "accessedAt"
      FROM whitelabel_share s
      LEFT JOIN whitelabel_share_access a ON a.share_id = s.id
      WHERE s.owner_id = ?
      ORDER BY s.created_at, s.id, a.accessed_at, a.id
      LIMIT ?`,
    values: [ownerId, shareListLimit] as QueryValue[],
  };
}

export function shareForOwnerQuery(shareId: string, ownerId: string) {
  return {
    sql: `SELECT id, brand_id AS "brandId", track, sample_size AS "sampleSize", grade,
        expires_at AS "expiresAt", revoked, created_at AS "createdAt"
      FROM whitelabel_share
      WHERE id = ? AND owner_id = ?`,
    values: [shareId, ownerId] as QueryValue[],
  };
}

function groupShares(rows: z.infer<typeof joinedRow>[]): ShareView[] {
  const shares = new Map<string, ShareView>();
  for (const row of rows) {
    let share = shares.get(row.id);
    if (!share) {
      share = {
        id: row.id,
        brandId: row.brandId,
        track: row.track,
        sampleSize: row.sampleSize,
        grade: row.grade,
        expiresAt: row.expiresAt,
        revoked: row.revoked,
        createdAt: row.createdAt,
        accesses: [],
      };
      shares.set(row.id, share);
    }
    if (row.accessId && row.visitorId && row.accessedAt && !share.accesses.some((access) => access.id === row.accessId)) {
      share.accesses.push({ id: row.accessId, visitorId: row.visitorId, accessedAt: row.accessedAt });
    }
  }
  return [...shares.values()];
}

export class ShareDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async sharesForOwner(ownerId: string) {
    const query = sharesForOwnerQuery(ownerId);
    const rows = await this.query(query.sql, query.values);
    return groupShares(rows.map((row) => joinedRow.parse(row)));
  }

  async shareForOwner(shareId: string, ownerId: string) {
    const query = shareForOwnerQuery(shareId, ownerId);
    const [row] = await this.query(query.sql, query.values);
    if (!row) return null;
    const parsed = shareRow.parse(row);
    return {
      id: parsed.id,
      brandId: parsed.brandId,
      track: parsed.track,
      sampleSize: parsed.sampleSize,
      grade: parsed.grade,
      expiresAt: parsed.expiresAt,
      revoked: parsed.revoked,
      createdAt: parsed.createdAt,
    };
  }

  async ownedBrands(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, shareListLimit],
    );
    return rows.map((row) => {
      const parsed = brandOptionRow.parse(row);
      return { id: parsed.brandId, name: parsed.name ?? parsed.brandId };
    });
  }

  async insertForOwner(row: {
    id: string;
    brandId: string;
    ownerId: string;
    track: string;
    sampleSize: number;
    grade: string;
    expiresAt: string;
    createdAt: string;
  }) {
    const rows = await this.query(
      `INSERT INTO whitelabel_share
        (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
       SELECT ?, b.id, b.owner_id, ?, ?, ?, ?, 0, ?
       FROM brand b
       WHERE b.id = ? AND b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       RETURNING id`,
      [row.id, row.track, row.sampleSize, row.grade, row.expiresAt, row.createdAt, row.brandId, row.ownerId],
    );
    return rows.length === 1;
  }

  async revokeForOwner(shareId: string, ownerId: string) {
    const rows = await this.query(
      `UPDATE whitelabel_share SET revoked = 1
       WHERE id = ? AND owner_id = ?
       RETURNING id`,
      [shareId, ownerId],
    );
    return rows.length === 1;
  }

  async insertAccess(row: { id: string; shareId: string; ownerId: string; accessedAt: string }) {
    const rows = await this.query(
      `INSERT INTO whitelabel_share_access (id, share_id, visitor_id, accessed_at)
       SELECT ?, s.id, s.owner_id, ?
       FROM whitelabel_share s
       WHERE s.id = ? AND s.owner_id = ? AND s.revoked = 0 AND s.expires_at > ?
       RETURNING id`,
      [row.id, row.accessedAt, row.shareId, row.ownerId, row.accessedAt],
    );
    return rows.length === 1;
  }
}
