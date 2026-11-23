import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { channelProfileVersionLimit } from "./contracts.ts";

const versionRow = z.object({
  id: brandIdSchema,
  profileId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  channelKey: z.string().min(1).max(64),
  maxCharacters: z.number().int().min(1).max(1_000_000).nullable(),
  note: z.string().min(1).max(2000),
  versionNumber: z.number().int().min(1).max(1_000_000),
  createdAt: z.iso.datetime({ precision: 3 }),
});
export type ChannelProfileVersionRow = z.infer<typeof versionRow>;

const profileHead = z.object({
  id: brandIdSchema,
  latest: z.number().int().min(0),
});

const versionColumns = `id, profile_id AS "profileId", brand_id AS "brandId", owner_id AS "ownerId",
  channel_key AS "channelKey", max_characters AS "maxCharacters", note,
  version_number AS "versionNumber", created_at AS "createdAt"`;

export function channelProfileVersionListQuery(ownerId: string, brandId: string, limit = channelProfileVersionLimit) {
  return {
    sql: `SELECT ${versionColumns} FROM channel_profile_version
      WHERE owner_id = ? AND brand_id = ?
      ORDER BY channel_key ASC, version_number DESC, id DESC
      LIMIT ?`,
    values: [ownerId, brandId, limit] as QueryValue[],
  };
}

export class ChannelProfileDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.db, sql, values);
  }

  async findProfile(ownerId: string, brandId: string, channelKey: string) {
    const [row] = await this.query(
      `SELECT p.id AS "id", COALESCE(MAX(v.version_number), 0) AS "latest"
       FROM channel_profile p
       LEFT JOIN channel_profile_version v ON v.profile_id = p.id
       WHERE p.owner_id = ? AND p.brand_id = ? AND p.channel_key = ?
       GROUP BY p.id`,
      [ownerId, brandId, channelKey],
    );
    return row ? profileHead.parse(row) : null;
  }

  async insertProfile(row: {
    id: string;
    brandId: string;
    ownerId: string;
    channelKey: string;
    createdAt: string;
    updatedAt: string;
  }) {
    await this.query(
      `INSERT INTO channel_profile (
        id, brand_id, owner_id, channel_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.channelKey, row.createdAt, row.updatedAt],
    );
  }

  async touchProfile(ownerId: string, profileId: string, updatedAt: string) {
    await this.query(
      `UPDATE channel_profile SET updated_at = ? WHERE owner_id = ? AND id = ?`,
      [updatedAt, ownerId, profileId],
    );
  }

  async insertVersion(row: ChannelProfileVersionRow) {
    await this.query(
      `INSERT INTO channel_profile_version (
        id, profile_id, brand_id, owner_id, channel_key, max_characters, note, version_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.profileId, row.brandId, row.ownerId, row.channelKey, row.maxCharacters,
        row.note, row.versionNumber, row.createdAt,
      ],
    );
  }

  async getVersion(ownerId: string, versionId: string) {
    const [row] = await this.query(
      `SELECT ${versionColumns} FROM channel_profile_version WHERE owner_id = ? AND id = ?`,
      [ownerId, versionId],
    );
    return row ? versionRow.parse(row) : null;
  }

  async listVersions(ownerId: string, brandId: string) {
    const query = channelProfileVersionListQuery(ownerId, brandId);
    const rows = await this.query(query.sql, query.values);
    return z.array(versionRow).parse(rows);
  }
}
