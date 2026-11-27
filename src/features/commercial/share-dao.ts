import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  hasGuaranteeCopy,
  shareListLimit,
  shareSampleSummarySchema,
  type ShareSampleSummary,
  type ShareSnapshotOption,
  type ShareView,
} from "./share-contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);
const token = (max: number) => z.string().regex(new RegExp(`^[a-z0-9_]{1,${max}}$`));
const stamp = z.string().min(20).max(40);

const shareRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  snapshotId: brandIdSchema.nullable(),
  track: token(64),
  sampleSize: z.number().int().min(0).max(2_000_000_000),
  grade: token(32),
  limitationsJson: z.string().nullable(),
  sampleSummaryJson: z.string().nullable(),
  expiresAt: stamp,
  revoked: flag,
  createdAt: stamp,
});

const shareDetailRow = shareRow.extend({
  brandName: z.string().min(1).nullable(),
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

const snapshotOptionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  status: z.enum(["created", "superseded"]),
  grade: z.enum(["exploratory", "incomparable"]),
  intent: z.enum(["business_loop", "diagnostic"]),
  loopCompleted: flag,
  sourceMissing: flag,
  track: z.enum(["model_api", "consumer_ui"]),
  createdAt: stamp,
});

function parseLimitations(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = z.array(z.string().min(1).max(500)).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.filter((line) => !hasGuaranteeCopy(line));
  } catch {
    return [];
  }
}

function parseSampleSummary(raw: string | null): ShareSampleSummary | null {
  if (!raw) return null;
  try {
    const parsed = shareSampleSummarySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function sharesForOwnerQuery(ownerId: string) {
  return {
    sql: `SELECT s.id AS "id", s.brand_id AS "brandId", s.owner_id AS "ownerId",
        s.snapshot_id AS "snapshotId", s.track AS "track",
        s.sample_size AS "sampleSize", s.grade AS "grade",
        s.limitations_json AS "limitationsJson", s.sample_summary_json AS "sampleSummaryJson",
        s.expires_at AS "expiresAt", s.revoked AS "revoked", s.created_at AS "createdAt",
        a.id AS "accessId", a.visitor_id AS "visitorId", a.accessed_at AS "accessedAt"
      FROM whitelabel_share s
      LEFT JOIN whitelabel_share_access a ON a.share_id = s.id
      WHERE s.owner_id = ?
      ORDER BY s.created_at DESC, s.id, a.accessed_at, a.id
      LIMIT ?`,
    values: [ownerId, shareListLimit] as QueryValue[],
  };
}

export function sharesForBrandsQuery(brandIds: readonly string[]) {
  return {
    sql: `SELECT s.id AS "id", s.brand_id AS "brandId", s.owner_id AS "ownerId",
        s.snapshot_id AS "snapshotId", s.track AS "track",
        s.sample_size AS "sampleSize", s.grade AS "grade",
        s.limitations_json AS "limitationsJson", s.sample_summary_json AS "sampleSummaryJson",
        s.expires_at AS "expiresAt", s.revoked AS "revoked", s.created_at AS "createdAt",
        a.id AS "accessId", a.visitor_id AS "visitorId", a.accessed_at AS "accessedAt"
      FROM whitelabel_share s
      LEFT JOIN whitelabel_share_access a ON a.share_id = s.id
      WHERE s.brand_id IN (${brandIds.map(() => "?").join(", ")})
      ORDER BY s.created_at DESC, s.id, a.accessed_at, a.id
      LIMIT ?`,
    values: [...brandIds, shareListLimit] as QueryValue[],
  };
}

export function shareByIdQuery(shareId: string) {
  return {
    sql: `SELECT s.id, s.brand_id AS "brandId", s.owner_id AS "ownerId",
        s.snapshot_id AS "snapshotId", s.track, s.sample_size AS "sampleSize", s.grade,
        s.limitations_json AS "limitationsJson", s.sample_summary_json AS "sampleSummaryJson",
        s.expires_at AS "expiresAt", s.revoked, s.created_at AS "createdAt",
        v.name AS "brandName"
      FROM whitelabel_share s
      JOIN brand b ON b.id = s.brand_id
      LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
      WHERE s.id = ?`,
    values: [shareId] as QueryValue[],
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
        snapshotId: row.snapshotId,
        track: row.track,
        sampleSize: row.sampleSize,
        sampleSummary: parseSampleSummary(row.sampleSummaryJson),
        grade: row.grade,
        limitations: parseLimitations(row.limitationsJson),
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

  async sharesForBrands(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const query = sharesForBrandsQuery(brandIds);
    const rows = await this.query(query.sql, query.values);
    return groupShares(rows.map((row) => joinedRow.parse(row)));
  }

  async shareById(shareId: string) {
    const query = shareByIdQuery(shareId);
    const [row] = await this.query(query.sql, query.values);
    if (!row) return null;
    const parsed = shareDetailRow.parse(row);
    return {
      id: parsed.id,
      brandId: parsed.brandId,
      ownerId: parsed.ownerId,
      brandName: parsed.brandName ?? parsed.brandId,
      snapshotId: parsed.snapshotId,
      track: parsed.track,
      sampleSize: parsed.sampleSize,
      sampleSummary: parseSampleSummary(parsed.sampleSummaryJson),
      grade: parsed.grade,
      limitations: parseLimitations(parsed.limitationsJson),
      expiresAt: parsed.expiresAt,
      revoked: parsed.revoked,
      createdAt: parsed.createdAt,
    };
  }

  async archivedOwnedBrandIds(ownerId: string) {
    const rows = await this.query(
      `SELECT b.id AS "brandId", v.name AS "name"
       FROM brand b
       LEFT JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
       WHERE b.owner_id = ? AND b.status = 'archived' AND b.frozen_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM brand_member_grant g WHERE g.brand_id = b.id)
       ORDER BY b.id
       LIMIT ?`,
      [ownerId, shareListLimit],
    );
    return rows.map((row) => {
      const parsed = brandOptionRow.parse(row);
      return { id: parsed.brandId, name: parsed.name ?? parsed.brandId };
    });
  }

  async snapshotsForBrands(brandIds: readonly string[]): Promise<ShareSnapshotOption[]> {
    if (!brandIds.length) return [];
    const rows = await this.query(
      `SELECT rs.id, rs.brand_id AS "brandId", rs.status, rs.grade, rs.intent,
          rs.loop_completed AS "loopCompleted", rs.source_missing AS "sourceMissing",
          rs.created_at AS "createdAt", rr.track
       FROM report_snapshot rs
       JOIN report_retest rr ON rr.id = rs.retest_id
       WHERE rs.brand_id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY CASE WHEN rs.status = 'created' THEN 0 ELSE 1 END, rs.created_at DESC, rs.id DESC
       LIMIT ?`,
      [...brandIds, shareListLimit],
    );
    return rows.map((row) => snapshotOptionRow.parse(row));
  }

  async insertForBrand(row: {
    id: string;
    brandId: string;
    ownerId: string;
    snapshotId: string;
    track: string;
    sampleSize: number;
    grade: string;
    limitationsJson: string;
    sampleSummaryJson: string;
    expiresAt: string;
    createdAt: string;
  }) {
    const rows = await this.query(
      `INSERT INTO whitelabel_share
        (id, brand_id, owner_id, snapshot_id, track, sample_size, grade,
         limitations_json, sample_summary_json, expires_at, revoked, created_at)
       SELECT ?, b.id, b.owner_id, rs.id, ?, ?, ?, ?, ?, ?, 0, ?
       FROM brand b
       JOIN report_snapshot rs ON rs.id = ? AND rs.brand_id = b.id
       WHERE b.id = ? AND b.owner_id = ? AND b.status = 'active' AND b.frozen_at IS NULL
       RETURNING id`,
      [
        row.id, row.track, row.sampleSize, row.grade,
        row.limitationsJson, row.sampleSummaryJson, row.expiresAt, row.createdAt,
        row.snapshotId, row.brandId, row.ownerId,
      ],
    );
    return rows.length === 1;
  }

  async revokeForBrand(shareId: string, brandId: string) {
    const rows = await this.query(
      `UPDATE whitelabel_share SET revoked = 1
       WHERE id = ? AND brand_id = ?
       RETURNING id`,
      [shareId, brandId],
    );
    return rows.length === 1;
  }

  async insertAccess(row: { id: string; shareId: string; visitorId: string; accessedAt: string }) {
    const rows = await this.query(
      `INSERT INTO whitelabel_share_access (id, share_id, visitor_id, accessed_at)
       SELECT ?, s.id, ?, ?
       FROM whitelabel_share s
       WHERE s.id = ? AND s.revoked = 0 AND s.expires_at > ?
       RETURNING id`,
      [row.id, row.visitorId, row.accessedAt, row.shareId, row.accessedAt],
    );
    return rows.length === 1;
  }
}
