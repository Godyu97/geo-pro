import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  approvalDecisionSchema,
  assetKindSchema,
  assetReviewStatusSchema,
  assetVisibilitySchema,
  batchStatusSchema,
  briefStatusSchema,
  exportJobStatusSchema,
  labelingStatusSchema,
  packageKindSchema,
  publicationActionKindSchema,
  publicationActionStatusSchema,
  publicationCheckMethodSchema,
  publicationEvidenceGradeSchema,
  publicationStatusSchema,
  maintenancePageStatusSchema,
  maintenanceReasonSchema,
  maintenanceTaskStatusSchema,
  templateKindSchema,
  unitStatusSchema,
  versionStatusSchema,
} from "./contracts.ts";

const planRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  questionCluster: z.string().min(1),
  coverageJson: z.string().min(2),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const briefRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  planId: brandIdSchema.nullable(),
  optimizationTaskId: brandIdSchema.nullable(),
  status: briefStatusSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const briefVersionRow = z.object({
  id: brandIdSchema,
  briefId: brandIdSchema,
  brandId: brandIdSchema,
  revision: z.int().positive(),
  audience: z.string(),
  targetGap: z.string(),
  applicableBoundary: z.string(),
  primaryPage: z.string(),
  conversionAction: z.string(),
  templateKind: templateKindSchema,
  titleCandidatesJson: z.string(),
  factVersionIdsJson: z.string(),
  competitorSource: z.string().nullable(),
  confirmedAt: z.iso.datetime({ precision: 3 }).nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const batchRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  status: batchStatusSchema,
  reservationId: z.string().nullable(),
  operationId: brandIdSchema,
  costLedgerJson: z.string().min(2),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const unitRow = z.object({
  id: brandIdSchema,
  batchId: brandIdSchema,
  briefId: brandIdSchema,
  brandId: brandIdSchema,
  status: unitStatusSchema,
  attemptCount: z.int().min(0),
  contentVersionId: brandIdSchema.nullable(),
  lastError: z.string().nullable(),
  blockedReason: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const versionRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  briefId: brandIdSchema,
  briefVersionId: brandIdSchema,
  batchUnitId: brandIdSchema,
  templateKind: templateKindSchema,
  title: z.string(),
  bodyMarkdown: z.string(),
  claimsJson: z.string(),
  status: versionStatusSchema,
  fingerprint: z.string(),
  targetChannel: z.string().min(1),
  labelingProfileVersion: z.string().min(1),
  labelingProfileStatus: labelingStatusSchema,
  imageAssetIdsJson: z.string().min(2),
  factVersionIdsJson: z.string().min(2),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const flag = z.union([z.literal(0), z.literal(1)]);

const approvalRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  contentVersionId: brandIdSchema,
  contentFingerprint: z.string().min(1),
  factVersionIdsJson: z.string().min(2),
  decision: approvalDecisionSchema,
  actorId: z.string().min(1),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const assetRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  kind: assetKindSchema,
  source: z.string(),
  rightsStatement: z.string(),
  visibility: assetVisibilitySchema,
  reviewStatus: assetReviewStatusSchema,
  contentRef: z.string().min(1),
  storedObjectId: z.string().min(1).nullable(),
  fingerprint: z.string().min(1),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const packageRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  contentVersionId: brandIdSchema,
  approvalId: brandIdSchema.nullable(),
  targetChannel: z.string().min(1),
  kind: packageKindSchema,
  contentFingerprint: z.string().min(1),
  factVersionIdsJson: z.string().min(2),
  labelingProfileVersion: z.string().min(1),
  doNotReuse: flag,
  nonPublishable: flag,
  manifestJson: z.string().min(2),
  filesJson: z.string().min(2),
  packageFingerprint: z.string().min(1),
  createdAt: z.iso.datetime({ precision: 3 }),
});

const exportJobRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  operationId: brandIdSchema,
  status: exportJobStatusSchema,
  selectionJson: z.string().min(2),
  preflightJson: z.string().min(2),
  chosenSubsetJson: z.string().min(2),
  resultPackageIdsJson: z.string().min(2),
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const publicationRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  contentVersionId: brandIdSchema,
  approvalId: brandIdSchema,
  contentFingerprint: z.string().min(1),
  targetAccount: z.string().min(1),
  pageUrl: z.string().min(1),
  publisherId: z.string().min(1),
  claimedPublishedAt: z.iso.datetime({ precision: 3 }),
  channelDeclaration: z.string().min(1),
  status: publicationStatusSchema,
  effectiveAt: z.iso.datetime({ precision: 3 }).nullable(),
  evidenceGrade: publicationEvidenceGradeSchema.nullable(),
  supersededBy: brandIdSchema.nullable(),
  operationId: brandIdSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const publicationCheckRow = z.object({
  id: brandIdSchema,
  publicationId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  method: publicationCheckMethodSchema,
  resultStatus: publicationStatusSchema,
  evidenceJson: z.string().min(2),
  actorId: z.string().min(1),
  checkedAt: z.iso.datetime({ precision: 3 }),
  notes: z.string().nullable(),
});

const publicationActionRow = z.object({
  id: brandIdSchema,
  publicationId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  kind: publicationActionKindSchema,
  status: publicationActionStatusSchema,
  reason: z.string().min(1),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const channelVariantRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  contentVersionId: brandIdSchema,
  channel: z.string().min(1),
  bodyMarkdown: z.string().min(1),
  approvalStatus: z.enum(["draft", "approved"]),
  approvalId: brandIdSchema.nullable(),
  needsOwnApproval: flag,
  blocked: flag,
  fingerprint: z.string().min(1),
  channelProfileVersionId: brandIdSchema.nullable(),
  profileVersionNumber: z.number().int().min(1).max(1_000_000).nullable(),
  profileMaxCharacters: z.number().int().min(1).max(1_000_000).nullable(),
  profileChannelKey: z.string().min(1).max(64).nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

export type PlanRow = z.infer<typeof planRow>;
export type BriefRow = z.infer<typeof briefRow>;
export type BriefVersionRow = z.infer<typeof briefVersionRow>;
export type BatchRow = z.infer<typeof batchRow>;
export type UnitRow = z.infer<typeof unitRow>;
export type ContentVersionRow = z.infer<typeof versionRow>;
export type ApprovalRow = z.infer<typeof approvalRow>;
export type AssetRow = z.infer<typeof assetRow>;
export type PackageRow = z.infer<typeof packageRow>;
export type ExportJobRow = z.infer<typeof exportJobRow>;
export type PublicationRow = z.infer<typeof publicationRow>;
export type PublicationCheckRow = z.infer<typeof publicationCheckRow>;
export type PublicationActionRow = z.infer<typeof publicationActionRow>;
export type ChannelVariantRow = z.infer<typeof channelVariantRow>;

const maintenanceTaskRow = z.object({
  id: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  factVersionId: brandIdSchema,
  status: maintenanceTaskStatusSchema,
  reason: maintenanceReasonSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const maintenancePageRow = z.object({
  id: brandIdSchema,
  taskId: brandIdSchema,
  brandId: brandIdSchema,
  ownerId: z.string().min(1),
  pageId: brandIdSchema,
  draftId: brandIdSchema,
  pageUrl: z.string().min(1),
  channel: z.string().min(1).max(64),
  plannedOn: calendarDate.nullable(),
  verifiedOn: calendarDate.nullable(),
  status: maintenancePageStatusSchema,
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

const affectedPublicationRow = z.object({
  pageId: brandIdSchema,
  draftId: brandIdSchema,
  pageUrl: z.string().min(1),
  channelDeclaration: z.string().min(1),
  targetChannel: z.string().min(1),
});

const dependencyDraftRow = z.object({
  id: brandIdSchema,
  title: z.string().min(1),
  status: z.enum(["draft", "in_review", "approved", "rejected", "invalidated"]),
});

const dependencyVariantRow = z.object({
  id: brandIdSchema,
  contentVersionId: brandIdSchema,
  channel: z.string().min(1),
});

const dependencyPublicationRow = z.object({
  id: brandIdSchema,
  contentVersionId: brandIdSchema,
  pageUrl: z.string().min(1),
});

export type FactDependencyList = {
  drafts: z.infer<typeof dependencyDraftRow>[];
  variants: z.infer<typeof dependencyVariantRow>[];
  publications: z.infer<typeof dependencyPublicationRow>[];
  more: boolean;
};

export type MaintenanceTaskRow = z.infer<typeof maintenanceTaskRow>;
export type MaintenancePageRow = z.infer<typeof maintenancePageRow>;
export type AffectedPublicationRow = z.infer<typeof affectedPublicationRow>;

const planColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", question_cluster AS "questionCluster",
  coverage_json AS "coverageJson", created_at AS "createdAt", updated_at AS "updatedAt"`;

const briefColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", plan_id AS "planId",
  optimization_task_id AS "optimizationTaskId", status, created_at AS "createdAt", updated_at AS "updatedAt"`;

const briefVersionColumns = `id, brief_id AS "briefId", brand_id AS "brandId", revision,
  audience, target_gap AS "targetGap", applicable_boundary AS "applicableBoundary",
  primary_page AS "primaryPage", conversion_action AS "conversionAction",
  template_kind AS "templateKind", title_candidates_json AS "titleCandidatesJson",
  fact_version_ids_json AS "factVersionIdsJson", competitor_source AS "competitorSource",
  confirmed_at AS "confirmedAt", created_at AS "createdAt"`;

const batchColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", status,
  reservation_id AS "reservationId", operation_id AS "operationId",
  cost_ledger_json AS "costLedgerJson", created_at AS "createdAt", updated_at AS "updatedAt"`;

const unitColumns = `id, batch_id AS "batchId", brief_id AS "briefId", brand_id AS "brandId", status,
  attempt_count AS "attemptCount", content_version_id AS "contentVersionId",
  last_error AS "lastError", blocked_reason AS "blockedReason",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const versionColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", brief_id AS "briefId",
  brief_version_id AS "briefVersionId", batch_unit_id AS "batchUnitId",
  template_kind AS "templateKind", title, body_markdown AS "bodyMarkdown",
  claims_json AS "claimsJson", status, fingerprint, target_channel AS "targetChannel",
  labeling_profile_version AS "labelingProfileVersion", labeling_profile_status AS "labelingProfileStatus",
  image_asset_ids_json AS "imageAssetIdsJson", fact_version_ids_json AS "factVersionIdsJson",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const approvalColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", content_version_id AS "contentVersionId",
  content_fingerprint AS "contentFingerprint", fact_version_ids_json AS "factVersionIdsJson",
  decision, actor_id AS "actorId", created_at AS "createdAt"`;

const assetColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", kind, source,
  rights_statement AS "rightsStatement", visibility, review_status AS "reviewStatus",
  content_ref AS "contentRef", stored_object_id AS "storedObjectId", fingerprint, created_at AS "createdAt"`;

const packageColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", content_version_id AS "contentVersionId",
  approval_id AS "approvalId", target_channel AS "targetChannel", kind,
  content_fingerprint AS "contentFingerprint", fact_version_ids_json AS "factVersionIdsJson",
  labeling_profile_version AS "labelingProfileVersion", do_not_reuse AS "doNotReuse",
  non_publishable AS "nonPublishable", manifest_json AS "manifestJson", files_json AS "filesJson",
  package_fingerprint AS "packageFingerprint", created_at AS "createdAt"`;

// List views omit the (potentially large) file bytes.
const packageSummaryColumns = packageColumns.replace('files_json AS "filesJson"', `'{}' AS "filesJson"`);

const exportJobColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", operation_id AS "operationId", status,
  selection_json AS "selectionJson", preflight_json AS "preflightJson",
  chosen_subset_json AS "chosenSubsetJson", result_package_ids_json AS "resultPackageIdsJson",
  error, created_at AS "createdAt", updated_at AS "updatedAt"`;

const publicationColumns = `id, brand_id AS "brandId", owner_id AS "ownerId", content_version_id AS "contentVersionId",
  approval_id AS "approvalId", content_fingerprint AS "contentFingerprint",
  target_account AS "targetAccount", page_url AS "pageUrl", publisher_id AS "publisherId",
  claimed_published_at AS "claimedPublishedAt", channel_declaration AS "channelDeclaration",
  status, effective_at AS "effectiveAt", evidence_grade AS "evidenceGrade",
  superseded_by AS "supersededBy", operation_id AS "operationId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const publicationCheckColumns = `id, publication_id AS "publicationId", brand_id AS "brandId", owner_id AS "ownerId",
  method, result_status AS "resultStatus", evidence_json AS "evidenceJson",
  actor_id AS "actorId", checked_at AS "checkedAt", notes`;

const publicationActionColumns = `id, publication_id AS "publicationId", brand_id AS "brandId", owner_id AS "ownerId",
  kind, status, reason, created_at AS "createdAt", updated_at AS "updatedAt"`;

const channelVariantColumns = `v.id, v.brand_id AS "brandId", v.owner_id AS "ownerId",
  v.content_version_id AS "contentVersionId", v.channel, v.body_markdown AS "bodyMarkdown",
  v.approval_status AS "approvalStatus", v.approval_id AS "approvalId",
  v.needs_own_approval AS "needsOwnApproval", v.blocked, v.fingerprint,
  v.channel_profile_version_id AS "channelProfileVersionId",
  p.version_number AS "profileVersionNumber", p.max_characters AS "profileMaxCharacters",
  p.channel_key AS "profileChannelKey",
  v.created_at AS "createdAt", v.updated_at AS "updatedAt"`;

const channelVariantFrom = `content_channel_variant v
  LEFT JOIN channel_profile_version p
    ON p.id = v.channel_profile_version_id AND p.owner_id = v.owner_id AND p.brand_id = v.brand_id`;

const maintenanceTaskColumns = `id, brand_id AS "brandId", owner_id AS "ownerId",
  fact_version_id AS "factVersionId", status, reason, created_at AS "createdAt", updated_at AS "updatedAt"`;

const maintenancePageColumns = `id, task_id AS "taskId", brand_id AS "brandId", owner_id AS "ownerId",
  page_id AS "pageId", draft_id AS "draftId", page_url AS "pageUrl", channel,
  planned_on AS "plannedOn", verified_on AS "verifiedOn", status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export class ContentDao {
  private readonly db: QueryConnection;

  constructor(db: QueryConnection) {
    this.db = db;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.db, sql, values);
  }

  async insertPlan(row: PlanRow) {
    await this.query(
      `INSERT INTO content_plan (id, brand_id, owner_id, question_cluster, coverage_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.questionCluster, row.coverageJson, row.createdAt, row.updatedAt],
    );
  }

  async updatePlanCoverage(id: string, coverageJson: string, updatedAt: string) {
    await this.query(
      `UPDATE content_plan SET coverage_json = ?, updated_at = ? WHERE id = ?`,
      [coverageJson, updatedAt, id],
    );
  }

  async getPlan(ownerId: string, brandId: string, planId: string) {
    const [row] = await this.query(
      `SELECT ${planColumns} FROM content_plan WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, planId],
    );
    return row ? planRow.parse(row) : null;
  }

  async getPlanByCluster(ownerId: string, brandId: string, questionCluster: string) {
    const [row] = await this.query(
      `SELECT ${planColumns} FROM content_plan WHERE owner_id = ? AND brand_id = ? AND question_cluster = ?`,
      [ownerId, brandId, questionCluster],
    );
    return row ? planRow.parse(row) : null;
  }

  async listPlans(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${planColumns} FROM content_plan
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => planRow.parse(row));
  }

  async deleteDraftBrief(ownerId: string, brandId: string, briefId: string) {
    await this.query(
      `DELETE FROM content_brief WHERE id = ? AND owner_id = ? AND brand_id = ? AND status = 'draft'`,
      [briefId, ownerId, brandId],
    );
  }

  async insertBrief(row: BriefRow) {
    await this.query(
      `INSERT INTO content_brief
        (id, brand_id, owner_id, plan_id, optimization_task_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.planId, row.optimizationTaskId, row.status, row.createdAt, row.updatedAt],
    );
  }

  async updateBriefStatus(id: string, status: string, updatedAt: string) {
    await this.query(
      `UPDATE content_brief SET status = ?, updated_at = ? WHERE id = ?`,
      [status, updatedAt, id],
    );
  }

  async getBrief(ownerId: string, brandId: string, briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefColumns} FROM content_brief WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, briefId],
    );
    return row ? briefRow.parse(row) : null;
  }

  async briefIdentity(briefId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM content_brief WHERE id = ?`,
      [briefId],
    );
    return row ? z.object({ brandId: brandIdSchema, ownerId: z.string().min(1) }).parse(row) : null;
  }

  async getBriefByIdForOwner(ownerId: string, briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefColumns} FROM content_brief WHERE owner_id = ? AND id = ?`,
      [ownerId, briefId],
    );
    return row ? briefRow.parse(row) : null;
  }

  async listBriefs(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${briefColumns} FROM content_brief
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => briefRow.parse(row));
  }

  async insertBriefVersion(row: BriefVersionRow) {
    await this.query(
      `INSERT INTO content_brief_version (
        id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary,
        primary_page, conversion_action, template_kind, title_candidates_json,
        fact_version_ids_json, competitor_source, confirmed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.briefId, row.brandId, row.revision, row.audience, row.targetGap,
        row.applicableBoundary, row.primaryPage, row.conversionAction, row.templateKind,
        row.titleCandidatesJson, row.factVersionIdsJson, row.competitorSource,
        row.confirmedAt, row.createdAt,
      ],
    );
  }

  async latestBriefVersion(briefId: string) {
    const [row] = await this.query(
      `SELECT ${briefVersionColumns} FROM content_brief_version
       WHERE brief_id = ? ORDER BY revision DESC LIMIT 1`,
      [briefId],
    );
    return row ? briefVersionRow.parse(row) : null;
  }

  async getBriefVersion(id: string) {
    const [row] = await this.query(
      `SELECT ${briefVersionColumns} FROM content_brief_version WHERE id = ?`,
      [id],
    );
    return row ? briefVersionRow.parse(row) : null;
  }

  async markBriefVersionConfirmed(id: string, confirmedAt: string) {
    await this.query(
      `UPDATE content_brief_version SET confirmed_at = ? WHERE id = ?`,
      [confirmedAt, id],
    );
  }

  async insertBatch(row: BatchRow) {
    await this.query(
      `INSERT INTO content_batch (
        id, brand_id, owner_id, status, reservation_id, operation_id, cost_ledger_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.status, row.reservationId, row.operationId,
        row.costLedgerJson, row.createdAt, row.updatedAt,
      ],
    );
  }

  async getBatchByOperation(brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE brand_id = ? AND operation_id = ?`,
      [brandId, operationId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async getBatch(ownerId: string, brandId: string, batchId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE owner_id = ? AND brand_id = ? AND id = ?`,
      [ownerId, brandId, batchId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async batchIdentity(batchId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM content_batch WHERE id = ?`,
      [batchId],
    );
    return row ? z.object({ brandId: brandIdSchema, ownerId: z.string().min(1) }).parse(row) : null;
  }

  async getBatchByIdForOwner(ownerId: string, batchId: string) {
    const [row] = await this.query(
      `SELECT ${batchColumns} FROM content_batch WHERE owner_id = ? AND id = ?`,
      [ownerId, batchId],
    );
    return row ? batchRow.parse(row) : null;
  }

  async updateBatch(row: Pick<BatchRow, "id" | "status" | "reservationId" | "costLedgerJson" | "updatedAt">) {
    await this.query(
      `UPDATE content_batch SET status = ?, reservation_id = ?, cost_ledger_json = ?, updated_at = ? WHERE id = ?`,
      [row.status, row.reservationId, row.costLedgerJson, row.updatedAt, row.id],
    );
  }

  async insertUnit(row: UnitRow) {
    await this.query(
      `INSERT INTO content_batch_unit (
        id, batch_id, brief_id, brand_id, status, attempt_count, content_version_id,
        last_error, blocked_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.batchId, row.briefId, row.brandId, row.status, row.attemptCount,
        row.contentVersionId, row.lastError, row.blockedReason, row.createdAt, row.updatedAt,
      ],
    );
  }

  async listUnits(batchId: string) {
    const rows = await this.query(
      `SELECT ${unitColumns} FROM content_batch_unit WHERE batch_id = ? ORDER BY created_at ASC, id ASC`,
      [batchId],
    );
    return rows.map((row) => unitRow.parse(row));
  }

  async updateUnit(row: UnitRow) {
    await this.query(
      `UPDATE content_batch_unit SET
        status = ?, attempt_count = ?, content_version_id = ?, last_error = ?,
        blocked_reason = ?, updated_at = ?
       WHERE id = ?`,
      [
        row.status, row.attemptCount, row.contentVersionId, row.lastError,
        row.blockedReason, row.updatedAt, row.id,
      ],
    );
  }

  async insertContentVersion(row: ContentVersionRow) {
    await this.query(
      `INSERT INTO content_version (
        id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id,
        template_kind, title, body_markdown, claims_json, status, fingerprint,
        target_channel, labeling_profile_version, labeling_profile_status,
        image_asset_ids_json, fact_version_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.briefId, row.briefVersionId, row.batchUnitId,
        row.templateKind, row.title, row.bodyMarkdown, row.claimsJson, row.status,
        row.fingerprint, row.targetChannel, row.labelingProfileVersion, row.labelingProfileStatus,
        row.imageAssetIdsJson, row.factVersionIdsJson, row.createdAt, row.updatedAt,
      ],
    );
  }

  async getContentVersion(ownerId: string, versionId: string) {
    const [row] = await this.query(
      `SELECT ${versionColumns} FROM content_version WHERE owner_id = ? AND id = ?`,
      [ownerId, versionId],
    );
    return row ? versionRow.parse(row) : null;
  }

  async contentVersionIdentity(versionId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM content_version WHERE id = ?`,
      [versionId],
    );
    return row ? z.object({ brandId: brandIdSchema, ownerId: z.string().min(1) }).parse(row) : null;
  }

  async getContentVersionById(versionId: string) {
    const [row] = await this.query(
      `SELECT ${versionColumns} FROM content_version WHERE id = ?`,
      [versionId],
    );
    return row ? versionRow.parse(row) : null;
  }

  async getContentVersionInBrand(brandId: string, versionId: string) {
    const [row] = await this.query(
      `SELECT ${versionColumns} FROM content_version WHERE brand_id = ? AND id = ?`,
      [brandId, versionId],
    );
    return row ? versionRow.parse(row) : null;
  }

  async listContentVersionsForBrand(ownerId: string, brandId: string, limit: number, statuses?: string[]) {
    const filter = statuses?.length ? ` AND status IN (${statuses.map(() => "?").join(", ")})` : "";
    const rows = await this.query(
      `SELECT ${versionColumns} FROM content_version
       WHERE owner_id = ? AND brand_id = ?${filter}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, ...(statuses?.length ? statuses : []), limit],
    );
    return rows.map((row) => versionRow.parse(row));
  }

  async getContentVersionsByIds(ownerId: string, brandId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.query(
      `SELECT ${versionColumns} FROM content_version
       WHERE owner_id = ? AND brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
      [ownerId, brandId, ...ids],
    );
    return rows.map((row) => versionRow.parse(row));
  }

  async updateContentVersionStatus(id: string, status: string, updatedAt: string) {
    await this.query(
      `UPDATE content_version SET status = ?, updated_at = ? WHERE id = ?`,
      [status, updatedAt, id],
    );
  }

  async updateContentVersionVariant(
    row: Pick<ContentVersionRow,
      "id" | "title" | "bodyMarkdown" | "targetChannel" | "labelingProfileVersion"
      | "labelingProfileStatus" | "imageAssetIdsJson" | "status" | "updatedAt">,
  ) {
    await this.query(
      `UPDATE content_version SET
        title = ?, body_markdown = ?, target_channel = ?, labeling_profile_version = ?,
        labeling_profile_status = ?, image_asset_ids_json = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        row.title, row.bodyMarkdown, row.targetChannel, row.labelingProfileVersion,
        row.labelingProfileStatus, row.imageAssetIdsJson, row.status, row.updatedAt, row.id,
      ],
    );
  }

  async insertApproval(row: ApprovalRow) {
    await this.query(
      `INSERT INTO content_approval (
        id, brand_id, owner_id, content_version_id, content_fingerprint,
        fact_version_ids_json, decision, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.contentVersionId, row.contentFingerprint,
        row.factVersionIdsJson, row.decision, row.actorId, row.createdAt,
      ],
    );
  }

  async listApprovals(ownerId: string, versionId: string) {
    const rows = await this.query(
      `SELECT ${approvalColumns} FROM content_approval
       WHERE owner_id = ? AND content_version_id = ?
       ORDER BY created_at DESC, id DESC`,
      [ownerId, versionId],
    );
    return rows.map((row) => approvalRow.parse(row));
  }

  async listApprovalsForVersions(ownerId: string, versionIds: string[]) {
    if (versionIds.length === 0) return [];
    const rows = await this.query(
      `SELECT ${approvalColumns} FROM content_approval
       WHERE owner_id = ? AND decision = 'approved'
         AND content_version_id IN (${versionIds.map(() => "?").join(", ")})
       ORDER BY created_at DESC, id DESC`,
      [ownerId, ...versionIds],
    );
    return rows.map((row) => approvalRow.parse(row));
  }

  async insertAsset(row: AssetRow) {
    await this.query(
      `INSERT INTO content_asset (
        id, brand_id, owner_id, kind, source, rights_statement, visibility,
        review_status, content_ref, stored_object_id, fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.kind, row.source, row.rightsStatement,
        row.visibility, row.reviewStatus, row.contentRef, row.storedObjectId, row.fingerprint, row.createdAt,
      ],
    );
  }

  async getAssetsByIds(ownerId: string, brandId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.query(
      `SELECT ${assetColumns} FROM content_asset
       WHERE owner_id = ? AND brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
      [ownerId, brandId, ...ids],
    );
    return rows.map((row) => assetRow.parse(row));
  }

  async listAssets(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${assetColumns} FROM content_asset
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return rows.map((row) => assetRow.parse(row));
  }

  async findAssetByObject(ownerId: string, brandId: string, objectId: string) {
    const rows = await this.query(
      `SELECT ${assetColumns} FROM content_asset
       WHERE stored_object_id = ? AND owner_id = ? AND brand_id = ?
       LIMIT 1`,
      [objectId, ownerId, brandId],
    );
    return rows[0] ? assetRow.parse(rows[0]) : null;
  }

  async insertPackage(row: PackageRow) {
    await this.query(
      `INSERT INTO content_delivery_package (
        id, brand_id, owner_id, content_version_id, approval_id, target_channel, kind,
        content_fingerprint, fact_version_ids_json, labeling_profile_version,
        do_not_reuse, non_publishable, manifest_json, files_json, package_fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.contentVersionId, row.approvalId, row.targetChannel,
        row.kind, row.contentFingerprint, row.factVersionIdsJson, row.labelingProfileVersion,
        row.doNotReuse, row.nonPublishable, row.manifestJson, row.filesJson,
        row.packageFingerprint, row.createdAt,
      ],
    );
  }

  async packageIdentity(packageId: string) {
    const [row] = await this.query(
      `SELECT brand_id AS "brandId", owner_id AS "ownerId" FROM content_delivery_package WHERE id = ?`,
      [packageId],
    );
    return row ? z.object({ brandId: brandIdSchema, ownerId: z.string().min(1) }).parse(row) : null;
  }

  async getPackage(ownerId: string, packageId: string) {
    const [row] = await this.query(
      `SELECT ${packageColumns} FROM content_delivery_package WHERE owner_id = ? AND id = ?`,
      [ownerId, packageId],
    );
    return row ? packageRow.parse(row) : null;
  }

  async getPackagesByIds(ownerId: string, brandId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.query(
      `SELECT ${packageColumns} FROM content_delivery_package
       WHERE owner_id = ? AND brand_id = ? AND id IN (${ids.map(() => "?").join(", ")})
       ORDER BY created_at ASC, id ASC`,
      [ownerId, brandId, ...ids],
    );
    return rows.map((row) => packageRow.parse(row));
  }

  async listPackagesForVersion(ownerId: string, versionId: string) {
    const rows = await this.query(
      `SELECT ${packageSummaryColumns} FROM content_delivery_package
       WHERE owner_id = ? AND content_version_id = ?
       ORDER BY created_at DESC, id DESC`,
      [ownerId, versionId],
    );
    return rows.map((row) => packageRow.parse(row));
  }

  /** Mark packages of a version as superseded unless they match the given fingerprint. */
  async markPackagesDoNotReuse(ownerId: string, versionId: string, exceptFingerprint: string | null) {
    if (exceptFingerprint === null) {
      await this.query(
        `UPDATE content_delivery_package SET do_not_reuse = 1
         WHERE owner_id = ? AND content_version_id = ? AND do_not_reuse = 0`,
        [ownerId, versionId],
      );
      return;
    }
    await this.query(
      `UPDATE content_delivery_package SET do_not_reuse = 1
       WHERE owner_id = ? AND content_version_id = ? AND do_not_reuse = 0 AND content_fingerprint <> ?`,
      [ownerId, versionId, exceptFingerprint],
    );
  }

  async insertExportJob(row: ExportJobRow) {
    await this.query(
      `INSERT INTO content_export_job (
        id, brand_id, owner_id, operation_id, status, selection_json, preflight_json,
        chosen_subset_json, result_package_ids_json, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.operationId, row.status, row.selectionJson,
        row.preflightJson, row.chosenSubsetJson, row.resultPackageIdsJson, row.error,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async getExportJobByOperation(ownerId: string, brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${exportJobColumns} FROM content_export_job
       WHERE owner_id = ? AND brand_id = ? AND operation_id = ?`,
      [ownerId, brandId, operationId],
    );
    return row ? exportJobRow.parse(row) : null;
  }

  async updateExportJob(
    row: Pick<ExportJobRow,
      "id" | "status" | "selectionJson" | "preflightJson" | "chosenSubsetJson"
      | "resultPackageIdsJson" | "error" | "updatedAt">,
  ) {
    await this.query(
      `UPDATE content_export_job SET
        status = ?, selection_json = ?, preflight_json = ?, chosen_subset_json = ?,
        result_package_ids_json = ?, error = ?, updated_at = ?
       WHERE id = ?`,
      [
        row.status, row.selectionJson, row.preflightJson, row.chosenSubsetJson,
        row.resultPackageIdsJson, row.error, row.updatedAt, row.id,
      ],
    );
  }

  async insertPublication(row: PublicationRow) {
    await this.query(
      `INSERT INTO content_publication (
        id, brand_id, owner_id, content_version_id, approval_id, content_fingerprint,
        target_account, page_url, publisher_id, claimed_published_at, channel_declaration,
        status, effective_at, evidence_grade, superseded_by, operation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.contentVersionId, row.approvalId, row.contentFingerprint,
        row.targetAccount, row.pageUrl, row.publisherId, row.claimedPublishedAt, row.channelDeclaration,
        row.status, row.effectiveAt, row.evidenceGrade, row.supersededBy, row.operationId,
        row.createdAt, row.updatedAt,
      ],
    );
  }

  async getPublication(ownerId: string, publicationId: string) {
    const [row] = await this.query(
      `SELECT ${publicationColumns} FROM content_publication WHERE owner_id = ? AND id = ?`,
      [ownerId, publicationId],
    );
    return row ? publicationRow.parse(row) : null;
  }

  async getPublicationById(publicationId: string) {
    const [row] = await this.query(
      `SELECT ${publicationColumns} FROM content_publication WHERE id = ?`,
      [publicationId],
    );
    return row ? publicationRow.parse(row) : null;
  }

  async getPublicationByOperation(ownerId: string, brandId: string, operationId: string) {
    const [row] = await this.query(
      `SELECT ${publicationColumns} FROM content_publication
       WHERE owner_id = ? AND brand_id = ? AND operation_id = ?`,
      [ownerId, brandId, operationId],
    );
    return row ? publicationRow.parse(row) : null;
  }

  async listPublicationsForVersion(ownerId: string, versionId: string) {
    const rows = await this.query(
      `SELECT ${publicationColumns} FROM content_publication
       WHERE owner_id = ? AND content_version_id = ?
       ORDER BY created_at DESC, id DESC`,
      [ownerId, versionId],
    );
    return z.array(publicationRow).parse(rows);
  }

  async listPublicationsForBrand(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT ${publicationColumns} FROM content_publication
       WHERE owner_id = ? AND brand_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [ownerId, brandId, limit],
    );
    return z.array(publicationRow).parse(rows);
  }

  async updatePublicationOutcome(
    row: Pick<PublicationRow, "id" | "status" | "effectiveAt" | "evidenceGrade" | "updatedAt">,
  ) {
    await this.query(
      `UPDATE content_publication SET
        status = ?, effective_at = ?, evidence_grade = ?, updated_at = ?
       WHERE id = ?`,
      [row.status, row.effectiveAt, row.evidenceGrade, row.updatedAt, row.id],
    );
  }

  async markPublicationsSuperseded(ownerId: string, versionId: string, successorId: string, updatedAt: string) {
    await this.query(
      `UPDATE content_publication SET superseded_by = ?, updated_at = ?
       WHERE owner_id = ? AND content_version_id = ? AND id <> ? AND superseded_by IS NULL`,
      [successorId, updatedAt, ownerId, versionId, successorId],
    );
  }

  async insertPublicationCheck(row: PublicationCheckRow) {
    await this.query(
      `INSERT INTO content_publication_check (
        id, publication_id, brand_id, owner_id, method, result_status,
        evidence_json, actor_id, checked_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.publicationId, row.brandId, row.ownerId, row.method, row.resultStatus,
        row.evidenceJson, row.actorId, row.checkedAt, row.notes,
      ],
    );
  }

  async listPublicationChecks(ownerId: string, publicationId: string) {
    const rows = await this.query(
      `SELECT ${publicationCheckColumns} FROM content_publication_check
       WHERE owner_id = ? AND publication_id = ?
       ORDER BY checked_at ASC, id ASC`,
      [ownerId, publicationId],
    );
    return z.array(publicationCheckRow).parse(rows);
  }

  async insertPublicationAction(row: PublicationActionRow) {
    await this.query(
      `INSERT INTO content_publication_action (
        id, publication_id, brand_id, owner_id, kind, status, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.publicationId, row.brandId, row.ownerId, row.kind, row.status,
        row.reason, row.createdAt, row.updatedAt,
      ],
    );
  }

  async listPublicationActions(ownerId: string, publicationId: string) {
    const rows = await this.query(
      `SELECT ${publicationActionColumns} FROM content_publication_action
       WHERE owner_id = ? AND publication_id = ?
       ORDER BY created_at DESC, id DESC`,
      [ownerId, publicationId],
    );
    return z.array(publicationActionRow).parse(rows);
  }

  async insertChannelVariant(row: ChannelVariantRow) {
    await this.query(
      `INSERT INTO content_channel_variant (
        id, brand_id, owner_id, content_version_id, channel, body_markdown,
        approval_status, approval_id, needs_own_approval, blocked, fingerprint,
        channel_profile_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.brandId, row.ownerId, row.contentVersionId, row.channel, row.bodyMarkdown,
        row.approvalStatus, row.approvalId, row.needsOwnApproval, row.blocked, row.fingerprint,
        row.channelProfileVersionId, row.createdAt, row.updatedAt,
      ],
    );
  }

  async updateChannelVariantBody(row: Pick<ChannelVariantRow,
    "id" | "ownerId" | "bodyMarkdown" | "approvalStatus" | "approvalId" | "needsOwnApproval" | "fingerprint" | "updatedAt">) {
    await this.query(
      `UPDATE content_channel_variant SET
        body_markdown = ?, approval_status = ?, approval_id = ?, needs_own_approval = ?,
        fingerprint = ?, updated_at = ?
       WHERE owner_id = ? AND id = ?`,
      [
        row.bodyMarkdown, row.approvalStatus, row.approvalId, row.needsOwnApproval,
        row.fingerprint, row.updatedAt, row.ownerId, row.id,
      ],
    );
  }

  async updateChannelVariantApproval(row: Pick<ChannelVariantRow,
    "id" | "ownerId" | "approvalStatus" | "approvalId" | "needsOwnApproval" | "updatedAt">) {
    await this.query(
      `UPDATE content_channel_variant SET
        approval_status = ?, approval_id = ?, needs_own_approval = ?, updated_at = ?
       WHERE owner_id = ? AND id = ?`,
      [row.approvalStatus, row.approvalId, row.needsOwnApproval, row.updatedAt, row.ownerId, row.id],
    );
  }

  async blockChannelVariant(ownerId: string, id: string, updatedAt: string) {
    await this.query(
      `UPDATE content_channel_variant SET blocked = 1, updated_at = ?
       WHERE owner_id = ? AND id = ? AND blocked = 0`,
      [updatedAt, ownerId, id],
    );
  }

  async getChannelVariant(ownerId: string, variantId: string) {
    const [row] = await this.query(
      `SELECT ${channelVariantColumns} FROM ${channelVariantFrom} WHERE v.owner_id = ? AND v.id = ?`,
      [ownerId, variantId],
    );
    return row ? channelVariantRow.parse(row) : null;
  }

  async getChannelVariantForVersion(ownerId: string, versionId: string, channel: string) {
    const [row] = await this.query(
      `SELECT ${channelVariantColumns} FROM ${channelVariantFrom}
       WHERE v.owner_id = ? AND v.content_version_id = ? AND v.channel = ?`,
      [ownerId, versionId, channel],
    );
    return row ? channelVariantRow.parse(row) : null;
  }

  async listChannelVariants(ownerId: string, versionId: string) {
    const rows = await this.query(
      `SELECT ${channelVariantColumns} FROM ${channelVariantFrom}
       WHERE v.owner_id = ? AND v.content_version_id = ?
       ORDER BY v.channel ASC, v.id ASC`,
      [ownerId, versionId],
    );
    return rows.map((row) => channelVariantRow.parse(row));
  }

  async listFactDependencies(ownerId: string, brandId: string, factVersionId: string): Promise<FactDependencyList> {
    const limit = 21;
    const [drafts, variants, publications] = await Promise.all([
      this.query(
        `SELECT v.id, v.title, v.status
         FROM brand_fact_use u
         JOIN content_version v
           ON v.id = u.content_version_id AND v.brand_id = u.brand_id AND v.owner_id = ?
         WHERE u.brand_id = ? AND u.fact_version_id = ?
         ORDER BY v.created_at ASC, v.id ASC
         LIMIT ?`,
        [ownerId, brandId, factVersionId, limit],
      ),
      this.query(
        `SELECT cv.id, cv.content_version_id AS "contentVersionId", cv.channel
         FROM brand_fact_use u
         JOIN content_channel_variant cv
           ON cv.content_version_id = u.content_version_id AND cv.brand_id = u.brand_id AND cv.owner_id = ?
         WHERE u.brand_id = ? AND u.fact_version_id = ?
         ORDER BY cv.channel ASC, cv.id ASC
         LIMIT ?`,
        [ownerId, brandId, factVersionId, limit],
      ),
      this.query(
        `SELECT p.id, p.content_version_id AS "contentVersionId", p.page_url AS "pageUrl"
         FROM brand_fact_use u
         JOIN content_publication p
           ON p.content_version_id = u.content_version_id AND p.brand_id = u.brand_id AND p.owner_id = ?
         WHERE u.brand_id = ? AND u.fact_version_id = ?
         ORDER BY p.created_at ASC, p.id ASC
         LIMIT ?`,
        [ownerId, brandId, factVersionId, limit],
      ),
    ]);
    const parsedDrafts = z.array(dependencyDraftRow).parse(drafts);
    const parsedVariants = z.array(dependencyVariantRow).parse(variants);
    const parsedPublications = z.array(dependencyPublicationRow).parse(publications);
    return {
      drafts: parsedDrafts.slice(0, 20),
      variants: parsedVariants.slice(0, 20),
      publications: parsedPublications.slice(0, 20),
      more: parsedDrafts.length > 20 || parsedVariants.length > 20 || parsedPublications.length > 20,
    };
  }

  async listFactPublications(ownerId: string, brandId: string, factVersionId: string) {
    const rows = await this.query(
      `SELECT p.id AS "pageId", p.content_version_id AS "draftId", p.page_url AS "pageUrl",
              p.channel_declaration AS "channelDeclaration", v.target_channel AS "targetChannel"
       FROM content_publication p
       JOIN content_version v
         ON v.id = p.content_version_id AND v.owner_id = p.owner_id AND v.brand_id = p.brand_id
       JOIN brand_fact_use u
         ON u.brand_id = p.brand_id AND u.content_version_id = p.content_version_id AND u.fact_version_id = ?
       WHERE p.owner_id = ? AND p.brand_id = ?
       ORDER BY p.created_at ASC, p.id ASC
       LIMIT 101`,
      [factVersionId, ownerId, brandId],
    );
    return z.array(affectedPublicationRow).parse(rows);
  }

  async findOpenMaintenanceTask(ownerId: string, brandId: string, factVersionId: string) {
    const [row] = await this.query(
      `SELECT ${maintenanceTaskColumns} FROM content_maintenance_task
       WHERE owner_id = ? AND brand_id = ? AND fact_version_id = ? AND status = 'open'`,
      [ownerId, brandId, factVersionId],
    );
    return row ? maintenanceTaskRow.parse(row) : null;
  }

  async getMaintenanceTask(ownerId: string, taskId: string) {
    const [row] = await this.query(
      `SELECT ${maintenanceTaskColumns} FROM content_maintenance_task
       WHERE owner_id = ? AND id = ?`,
      [ownerId, taskId],
    );
    return row ? maintenanceTaskRow.parse(row) : null;
  }

  async insertMaintenanceTask(row: MaintenanceTaskRow) {
    await this.query(
      `INSERT INTO content_maintenance_task (
        id, brand_id, owner_id, fact_version_id, status, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.brandId, row.ownerId, row.factVersionId, row.status, row.reason, row.createdAt, row.updatedAt],
    );
  }

  async touchMaintenanceTask(ownerId: string, taskId: string, updatedAt: string) {
    await this.query(
      `UPDATE content_maintenance_task SET updated_at = ?
       WHERE owner_id = ? AND id = ? AND status = 'open'`,
      [updatedAt, ownerId, taskId],
    );
  }

  async insertMaintenancePages(rows: MaintenancePageRow[]) {
    if (rows.length === 0) return;
    await this.query(
      `INSERT INTO content_maintenance_page (
        id, task_id, brand_id, owner_id, page_id, draft_id, page_url, channel,
        planned_on, verified_on, status, created_at, updated_at
      ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON CONFLICT (task_id, page_id) DO UPDATE SET
         planned_on = COALESCE(content_maintenance_page.planned_on, excluded.planned_on),
         updated_at = CASE
           WHEN content_maintenance_page.planned_on IS NULL AND excluded.planned_on IS NOT NULL
           THEN excluded.updated_at ELSE content_maintenance_page.updated_at END`,
      rows.flatMap((row) => [
        row.id, row.taskId, row.brandId, row.ownerId, row.pageId, row.draftId, row.pageUrl, row.channel,
        row.plannedOn, row.verifiedOn, row.status, row.createdAt, row.updatedAt,
      ]),
    );
  }

  async listMaintenanceTasks(ownerId: string, brandId: string, factVersionId: string | undefined, limit: number) {
    const factFilter = factVersionId ? " AND fact_version_id = ?" : "";
    const values: QueryValue[] = factVersionId
      ? [ownerId, brandId, factVersionId, limit]
      : [ownerId, brandId, limit];
    const rows = await this.query(
      `SELECT ${maintenanceTaskColumns} FROM content_maintenance_task
       WHERE owner_id = ? AND brand_id = ?${factFilter}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      values,
    );
    return rows.map((row) => maintenanceTaskRow.parse(row));
  }

  async listMaintenancePages(ownerId: string, taskIds: string[]) {
    if (taskIds.length === 0) return [];
    const rows = await this.query(
      `SELECT ${maintenancePageColumns} FROM content_maintenance_page
       WHERE owner_id = ? AND task_id IN (${taskIds.map(() => "?").join(", ")})
       ORDER BY channel ASC, id ASC`,
      [ownerId, ...taskIds],
    );
    return rows.map((row) => maintenancePageRow.parse(row));
  }

  async settleMaintenanceChannel(row: {
    ownerId: string;
    taskId: string;
    channel: string;
    status: "verified" | "blocked";
    verifiedOn: string | null;
    updatedAt: string;
  }) {
    await this.query(
      `UPDATE content_maintenance_page
       SET status = ?,
           verified_on = CASE WHEN ? = 'blocked' THEN verified_on ELSE COALESCE(?, verified_on) END,
           updated_at = ?
       WHERE owner_id = ? AND task_id = ? AND channel = ?`,
      [row.status, row.status, row.verifiedOn, row.updatedAt, row.ownerId, row.taskId, row.channel],
    );
  }

  async listPublicationFactVersionIds(ownerId: string, brandId: string, limit: number) {
    const rows = await this.query(
      `SELECT id FROM (
         SELECT DISTINCT u.fact_version_id AS id
         FROM brand_fact_use u
         JOIN content_publication p
           ON p.brand_id = u.brand_id
          AND p.content_version_id = u.content_version_id
          AND p.owner_id = ?
         JOIN brand b
           ON b.id = u.brand_id AND b.owner_id = ? AND b.frozen_at IS NULL
         WHERE u.brand_id = ?
       ) linked_facts
       ORDER BY id ASC
       LIMIT ?`,
      [ownerId, ownerId, brandId, limit],
    );
    return z.array(z.object({ id: brandIdSchema })).parse(rows).map((row) => row.id);
  }

  async listVariantLinks(ownerId: string, versionIds: string[]) {
    if (versionIds.length === 0) return [];
    const rows = await this.query(
      `SELECT id, content_version_id AS "contentVersionId", channel
       FROM content_channel_variant
       WHERE owner_id = ? AND content_version_id IN (${versionIds.map(() => "?").join(", ")})`,
      [ownerId, ...versionIds],
    );
    return z.array(z.object({
      id: brandIdSchema,
      contentVersionId: brandIdSchema,
      channel: z.string(),
    })).parse(rows);
  }
}

