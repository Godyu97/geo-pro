import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { approvalBrandLimit, approvalDutyLimit, type ApprovalAttemptReason, type ApprovalKind } from "./contracts.ts";

const flag = z.union([z.literal(0), z.literal(1)]);

const policyRow = z.object({
  brandId: brandIdSchema,
  version: z.number().int().positive(),
  dualControl: flag,
});

const dutyRow = policyRow.pick({ brandId: true }).extend({
  userId: z.string().min(1).max(128),
  factApprover: flag,
  contentApprover: flag,
});

const actorDutyRow = dutyRow.omit({ brandId: true });

const brandGateRow = z.object({
  ownerId: z.string().min(1).max(128),
  status: z.enum(["active", "archived"]),
  frozenAt: z.string().nullable(),
});

const contentGateRow = z.object({
  id: brandIdSchema,
  ownerId: z.string().min(1).max(128),
  status: z.enum(["draft", "in_review", "approved", "rejected", "invalidated"]),
  title: z.string(),
  bodyMarkdown: z.string(),
  claimsJson: z.string(),
  targetChannel: z.string().min(1),
  labelingProfileVersion: z.string().min(1),
  labelingProfileStatus: z.enum(["verified", "unverified"]),
  imageAssetIdsJson: z.string().min(2),
  factVersionIdsJson: z.string().min(2),
});

const approvalHitRow = z.object({
  id: brandIdSchema,
  contentFingerprint: z.string().min(1),
});

export type ApprovalPolicyRecord = z.infer<typeof policyRow>;
export type ApprovalDutyRecord = z.infer<typeof dutyRow>;
export type ApprovalContentGate = z.infer<typeof contentGateRow>;

const contentColumns = `id, owner_id AS "ownerId", status, title, body_markdown AS "bodyMarkdown",
  claims_json AS "claimsJson", target_channel AS "targetChannel",
  labeling_profile_version AS "labelingProfileVersion",
  labeling_profile_status AS "labelingProfileStatus",
  image_asset_ids_json AS "imageAssetIdsJson", fact_version_ids_json AS "factVersionIdsJson"`;

export function policyByBrandQuery(brandId: string) {
  return {
    sql: `SELECT brand_id AS "brandId", version, dual_control AS "dualControl"
      FROM approval_policy WHERE brand_id = ?`,
    values: [brandId] as QueryValue[],
  };
}

export function dutyByActorQuery(brandId: string, userId: string) {
  return {
    sql: `SELECT user_id AS "userId", fact_approver AS "factApprover", content_approver AS "contentApprover"
      FROM brand_approval_duty WHERE brand_id = ? AND user_id = ?`,
    values: [brandId, userId] as QueryValue[],
  };
}

export function attemptsByVersionQuery(brandId: string, versionId: string) {
  return {
    sql: `SELECT id, version_id AS "versionId", reason
      FROM approval_attempt
      WHERE brand_id = ? AND version_id = ?
      ORDER BY created_at, id
      LIMIT ?`,
    values: [brandId, versionId, approvalDutyLimit] as QueryValue[],
  };
}

export class ApprovalPolicyDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[] = []) {
    return queryWithParameters(this.db, sql, values);
  }

  async ownedBrandIds(ownerId: string) {
    const rows = await this.query(
      `SELECT id AS "brandId" FROM brand
       WHERE owner_id = ? AND status = 'active' AND frozen_at IS NULL
       ORDER BY id
       LIMIT ?`,
      [ownerId, approvalBrandLimit],
    );
    return rows.map((row) => brandIdSchema.parse(row.brandId));
  }

  async policiesForBrands(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const rows = await this.query(
      `SELECT brand_id AS "brandId", version, dual_control AS "dualControl"
       FROM approval_policy
       WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY brand_id`,
      [...brandIds],
    );
    return rows.map((row) => policyRow.parse(row));
  }

  async dutiesForBrands(brandIds: readonly string[]) {
    if (!brandIds.length) return [];
    const rows = await this.query(
      `SELECT brand_id AS "brandId", user_id AS "userId",
         fact_approver AS "factApprover", content_approver AS "contentApprover"
       FROM brand_approval_duty
       WHERE brand_id IN (${brandIds.map(() => "?").join(", ")})
       ORDER BY brand_id, user_id
       LIMIT ?`,
      [...brandIds, approvalBrandLimit * approvalDutyLimit],
    );
    return rows.map((row) => dutyRow.parse(row));
  }

  async policy(brandId: string) {
    const query = policyByBrandQuery(brandId);
    const [row] = await this.query(query.sql, query.values);
    return row ? policyRow.parse(row) : null;
  }

  async duty(brandId: string, userId: string) {
    const query = dutyByActorQuery(brandId, userId);
    const [row] = await this.query(query.sql, query.values);
    return row ? actorDutyRow.parse(row) : null;
  }

  async brandGate(brandId: string) {
    const [row] = await this.query(
      `SELECT owner_id AS "ownerId", status, frozen_at AS "frozenAt" FROM brand WHERE id = ?`,
      [brandId],
    );
    return row ? brandGateRow.parse(row) : null;
  }

  async contentVersion(brandId: string, versionId: string) {
    const [row] = await this.query(
      `SELECT ${contentColumns} FROM content_version WHERE brand_id = ? AND id = ?`,
      [brandId, versionId],
    );
    return row ? contentGateRow.parse(row) : null;
  }

  async matchingApproval(versionId: string, fingerprint: string) {
    const [row] = await this.query(
      `SELECT id, content_fingerprint AS "contentFingerprint"
       FROM content_approval
       WHERE content_version_id = ? AND decision = 'approved' AND content_fingerprint = ?
       ORDER BY created_at, id
       LIMIT 1`,
      [versionId, fingerprint],
    );
    return row ? approvalHitRow.parse(row) : null;
  }

  async hasApproval(versionId: string) {
    const [row] = await this.query(
      `SELECT id FROM content_approval WHERE content_version_id = ? LIMIT 1`,
      [versionId],
    );
    return Boolean(row);
  }

  async usersExist(userIds: readonly string[]) {
    if (!userIds.length) return true;
    const rows = await this.query(
      `SELECT id FROM "user" WHERE id IN (${userIds.map(() => "?").join(", ")})`,
      [...userIds],
    );
    return rows.length === userIds.length;
  }

  async upsertPolicy(row: { id: string; brandId: string; dualControl: 0 | 1; updatedAt: string; updatedBy: string }) {
    const [saved] = await this.query(
      `INSERT INTO approval_policy (id, brand_id, version, dual_control, updated_at, updated_by)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT (brand_id) DO UPDATE SET
         version = approval_policy.version + 1,
         dual_control = excluded.dual_control,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by
       RETURNING version, dual_control AS "dualControl"`,
      [row.id, row.brandId, row.dualControl, row.updatedAt, row.updatedBy],
    );
    return saved ? policyRow.pick({ version: true, dualControl: true }).parse({ ...saved, brandId: row.brandId }) : null;
  }

  async replaceDuties(brandId: string, duties: readonly { id: string; userId: string; factApprover: 0 | 1; contentApprover: 0 | 1 }[], updatedAt: string) {
    await this.query("DELETE FROM brand_approval_duty WHERE brand_id = ?", [brandId]);
    if (!duties.length) return;
    await this.query(
      `INSERT INTO brand_approval_duty
        (id, brand_id, user_id, fact_approver, content_approver, updated_at)
       VALUES ${duties.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      duties.flatMap((duty) => [duty.id, brandId, duty.userId, duty.factApprover, duty.contentApprover, updatedAt]),
    );
  }

  async insertAttempt(row: {
    id: string;
    brandId: string;
    versionId: string;
    kind: ApprovalKind;
    reason: ApprovalAttemptReason;
    actorId: string;
    createdAt: string;
  }) {
    await this.query(
      `INSERT INTO approval_attempt
        (id, brand_id, version_id, kind, reason, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.versionId, row.kind, row.reason, row.actorId, row.createdAt],
    );
  }

  async confirmFact(brandId: string, versionId: string, ownerId: string, actorId: string, confirmedAt: string) {
    const rows = await this.query(
      `UPDATE brand_fact_version
       SET state = 'approved', revision = revision + 1, confirmed_by = ?, confirmed_at = ?
       WHERE brand_id = ? AND id = ? AND state = 'pending_confirmation' AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM brand
           WHERE id = ? AND owner_id = ? AND status = 'active' AND frozen_at IS NULL
         )
       RETURNING id`,
      [actorId, confirmedAt, brandId, versionId, brandId, ownerId],
    );
    return rows.length === 1;
  }
}
