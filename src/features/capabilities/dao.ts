import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import {
  answerNetworkRecordSchema,
  capabilitySnapshotSchema,
  channelKindSchema,
  publicCapabilitySchema,
  type AnswerNetworkRecord,
  type CapabilityChange,
  type CapabilitySnapshot,
  type ChannelKind,
} from "./contracts.ts";

const flag = z.union([z.literal(0), z.literal(1), z.coerce.number().pipe(z.union([z.literal(0), z.literal(1)]))]);
const snapshotRow = capabilitySnapshotSchema.extend({
  searchRequired: flag,
  publicVisible: flag,
});
const publicRow = publicCapabilitySchema;
const evidenceRow = answerNetworkRecordSchema.extend({ qualifiesRequiredSearch: flag });

const versionColumns = `c.id AS "channelId", c.vendor_id AS "vendorId", c.kind, v.version, v.status, v.reason,
  v.display_name AS "displayName", v.product_entry AS "productEntry", v.mode, v.model_version AS "modelVersion",
  v.availability, v.search_required AS "searchRequired", v.citation_capability AS "citationCapability",
  v.region_target AS "regionTarget", v.region_actual AS "regionActual", v.limits_summary AS "limitsSummary",
  v.sop_summary AS "sopSummary", v.verified_at AS "verifiedAt", v.expires_at AS "expiresAt",
  v.public_visible AS "publicVisible", v.changed_at AS "changedAt"`;

const latestJoin = `FROM capability_channel c
  JOIN capability_version v ON v.channel_id = c.id AND v.version = (
    SELECT MAX(x.version) FROM capability_version x WHERE x.channel_id = c.id
  )`;

export class CapabilityDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.connection, sql, values);
  }

  async lockChannel(channelId: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR UPDATE" : "";
    const [row] = await this.query(
      `SELECT id, vendor_id AS "vendorId", kind FROM capability_channel WHERE id = ?${lock}`,
      [channelId],
    );
    return row ? z.object({ id: z.uuid(), vendorId: z.string().min(1), kind: channelKindSchema }).parse(row) : null;
  }

  async insertChannel(id: string, vendorId: string, kind: ChannelKind, createdAt: string) {
    await this.query(
      `INSERT INTO capability_channel (id, vendor_id, kind, created_at) VALUES (?, ?, ?, ?)`,
      [id, vendorId, kind, createdAt],
    );
  }

  async snapshot(channelId: string, version?: number) {
    const [row] = await this.query(
      `SELECT ${versionColumns}
       FROM capability_channel c JOIN capability_version v ON v.channel_id = c.id
       WHERE c.id = ? ${version === undefined ? "ORDER BY v.version DESC LIMIT 1" : "AND v.version = ?"}`,
      version === undefined ? [channelId] : [channelId, version],
    );
    return row ? snapshotRow.parse(row) : null;
  }

  async latest(channelId?: string) {
    const rows = await this.query(
      `SELECT ${versionColumns} ${latestJoin}${channelId ? " WHERE c.id = ?" : ""}
       ORDER BY c.vendor_id, c.kind, c.id`,
      channelId ? [channelId] : [],
    );
    return rows.map((row) => snapshotRow.parse(row));
  }

  async publicLatest(now: string) {
    const rows = await this.query(
      `SELECT c.id AS "channelId", c.vendor_id AS "vendorId", c.kind, v.display_name AS "displayName",
        v.product_entry AS "productEntry", v.mode, v.model_version AS "modelVersion", v.status,
        v.limits_summary AS "limitsSummary", v.verified_at AS "verifiedAt", v.expires_at AS "expiresAt"
       ${latestJoin}
       WHERE v.status = 'verified' AND v.public_visible = 1 AND v.verified_at IS NOT NULL
         AND v.expires_at IS NOT NULL AND v.expires_at > ?
       ORDER BY c.vendor_id, c.kind, c.id`,
      [now],
    );
    return rows.map((row) => publicRow.parse(row));
  }

  async latestByIds(channelIds: string[]) {
    if (channelIds.length === 0) return [];
    const rows = await this.query(
      `SELECT ${versionColumns} ${latestJoin} WHERE c.id IN (${channelIds.map(() => "?").join(", ")})
       ORDER BY c.vendor_id, c.kind, c.id`,
      channelIds,
    );
    return rows.map((row) => snapshotRow.parse(row));
  }

  async previousChange(operationId: string) {
    const [row] = await this.query(
      `SELECT fingerprint, ${versionColumns}
       FROM capability_version v JOIN capability_channel c ON c.id = v.channel_id
       WHERE v.operation_id = ?`,
      [operationId],
    );
    return row
      ? { fingerprint: z.string().parse(row.fingerprint), after: snapshotRow.parse(row) }
      : null;
  }

  async appendVersion(command: CapabilityChange, snapshot: CapabilitySnapshot, fingerprint: string) {
    await this.query(
      `INSERT INTO capability_version (
        channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name, product_entry,
        mode, model_version, availability, search_required, citation_capability, region_target, region_actual,
        limits_summary, sop_summary, verified_at, expires_at, public_visible, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.channelId, snapshot.version, command.operationId, fingerprint, command.actorId, command.reason,
        snapshot.status, snapshot.displayName, snapshot.productEntry, snapshot.mode, snapshot.modelVersion,
        snapshot.availability, snapshot.searchRequired, snapshot.citationCapability, snapshot.regionTarget,
        snapshot.regionActual, snapshot.limitsSummary, snapshot.sopSummary, snapshot.verifiedAt, snapshot.expiresAt,
        snapshot.publicVisible, snapshot.changedAt,
      ],
    );
  }

  async lockBrand(brandId: string, ownerId: string) {
    const lock = this.connection.kind === "postgresql" ? " FOR NO KEY UPDATE" : "";
    const [row] = await this.query(
      `SELECT id FROM brand WHERE id = ? AND owner_id = ? AND status = 'active' AND frozen_at IS NULL${lock}`,
      [brandId, ownerId],
    );
    return row ? z.uuid().parse(row.id) : null;
  }

  async insertAnswerNetwork(record: AnswerNetworkRecord, createdBy: string) {
    await this.query(
      `INSERT INTO sampling_answer_network (
        id, brand_id, channel_id, channel_version, requested_network_mode, actual_network, trigger_evidence,
        qualifies_required_search, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.brandId, record.channelId, record.channelVersion, record.requestedNetworkMode,
        record.actualNetwork, record.triggerEvidence, record.qualifiesRequiredSearch, record.createdAt, createdBy,
      ],
    );
  }

  async answerNetworkForOwner(ownerId: string, brandId: string) {
    const rows = await this.query(
      `SELECT n.id, n.brand_id AS "brandId", n.channel_id AS "channelId", n.channel_version AS "channelVersion",
        n.requested_network_mode AS "requestedNetworkMode", n.actual_network AS "actualNetwork",
        n.trigger_evidence AS "triggerEvidence", n.qualifies_required_search AS "qualifiesRequiredSearch",
        n.created_at AS "createdAt"
       FROM sampling_answer_network n
       JOIN brand b ON b.id = n.brand_id
       WHERE b.owner_id = ? AND n.brand_id = ?
       ORDER BY n.created_at DESC, n.id
       LIMIT 50`,
      [ownerId, brandId],
    );
    return rows.map((row) => evidenceRow.parse(row));
  }
}
