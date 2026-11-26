import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { brand } from "./brand-schema";
import { brandFactVersion } from "./brand-fact-schema";

export const contentPlan = pgTable("content_plan", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  questionCluster: text("question_cluster").notNull(),
  coverageJson: text("coverage_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("content_plan_brand_idx").on(table.brandId, table.updatedAt, table.id),
  index("content_plan_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  uniqueIndex("content_plan_cluster_uidx").on(table.brandId, table.questionCluster),
  check("content_plan_state_check", sql`length(${table.questionCluster}) > 0 and length(${table.coverageJson}) > 1`),
]);

export const contentBrief = pgTable("content_brief", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  planId: text("plan_id"),
  optimizationTaskId: text("optimization_task_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_brief_plan_fk",
    columns: [table.planId],
    foreignColumns: [contentPlan.id],
  }).onDelete("set null"),
  index("content_brief_brand_idx").on(table.brandId, table.updatedAt, table.id),
  index("content_brief_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("content_brief_state_check", sql`${table.status} in ('draft', 'confirmed', 'invalidated')`),
]);

export const contentBriefVersion = pgTable("content_brief_version", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  audience: text("audience").notNull(),
  targetGap: text("target_gap").notNull(),
  applicableBoundary: text("applicable_boundary").notNull(),
  primaryPage: text("primary_page").notNull(),
  conversionAction: text("conversion_action").notNull(),
  templateKind: text("template_kind").notNull(),
  titleCandidatesJson: text("title_candidates_json").notNull(),
  factVersionIdsJson: text("fact_version_ids_json").notNull(),
  competitorSource: text("competitor_source"),
  confirmedAt: text("confirmed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_brief_version_brief_fk",
    columns: [table.briefId],
    foreignColumns: [contentBrief.id],
  }).onDelete("cascade"),
  uniqueIndex("content_brief_version_rev_uidx").on(table.briefId, table.revision),
  index("content_brief_version_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("content_brief_version_state_check", sql`${table.revision} > 0
    and ${table.templateKind} in ('fact_faq', 'scenario_solution', 'verifiable_comparison')
    and length(${table.titleCandidatesJson}) > 1
    and length(${table.factVersionIdsJson}) > 1`),
]);

export const contentBatch = pgTable("content_batch", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull(),
  reservationId: text("reservation_id"),
  operationId: text("operation_id").notNull(),
  costLedgerJson: text("cost_ledger_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("content_batch_operation_uidx").on(table.brandId, table.operationId),
  index("content_batch_brand_idx").on(table.brandId, table.updatedAt, table.id),
  index("content_batch_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("content_batch_state_check", sql`${table.status} in ('queued', 'running', 'paused', 'partial', 'completed', 'cancelled')
    and length(${table.costLedgerJson}) > 1`),
]);

export const contentBatchUnit = pgTable("content_batch_unit", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  briefId: text("brief_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  contentVersionId: text("content_version_id"),
  lastError: text("last_error"),
  blockedReason: text("blocked_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_batch_unit_batch_fk",
    columns: [table.batchId],
    foreignColumns: [contentBatch.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "content_batch_unit_brief_fk",
    columns: [table.briefId],
    foreignColumns: [contentBrief.id],
  }).onDelete("restrict"),
  index("content_batch_unit_batch_idx").on(table.batchId, table.status, table.id),
  index("content_batch_unit_brand_idx").on(table.brandId, table.updatedAt, table.id),
  check("content_batch_unit_state_check", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'blocked')
    and ${table.attemptCount} >= 0`),
]);

export const contentVersion = pgTable("content_version", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  briefId: text("brief_id").notNull(),
  briefVersionId: text("brief_version_id").notNull(),
  batchUnitId: text("batch_unit_id").notNull(),
  templateKind: text("template_kind").notNull(),
  title: text("title").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  claimsJson: text("claims_json").notNull(),
  status: text("status").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
  targetChannel: text("target_channel").notNull().default("primary_page"),
  labelingProfileVersion: text("labeling_profile_version").notNull().default("unverified"),
  labelingProfileStatus: text("labeling_profile_status").notNull().default("unverified"),
  imageAssetIdsJson: text("image_asset_ids_json").notNull().default("[]"),
  factVersionIdsJson: text("fact_version_ids_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_version_brief_fk",
    columns: [table.briefId],
    foreignColumns: [contentBrief.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_version_brief_version_fk",
    columns: [table.briefVersionId],
    foreignColumns: [contentBriefVersion.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_version_unit_fk",
    columns: [table.batchUnitId],
    foreignColumns: [contentBatchUnit.id],
  }).onDelete("restrict"),
  index("content_version_brand_idx").on(table.brandId, table.createdAt, table.id),
  index("content_version_owner_idx").on(table.ownerId, table.createdAt, table.id),
  index("content_version_brief_idx").on(table.briefId, table.createdAt, table.id),
  check("content_version_state_check", sql`${table.status} in ('draft', 'in_review', 'approved', 'rejected', 'invalidated')
    and ${table.labelingProfileStatus} in ('verified', 'unverified')
    and length(${table.targetChannel}) > 0
    and length(${table.labelingProfileVersion}) > 0
    and length(${table.imageAssetIdsJson}) > 1
    and length(${table.factVersionIdsJson}) > 1
    and ${table.templateKind} in ('fact_faq', 'scenario_solution', 'verifiable_comparison')
    and length(${table.title}) > 0
    and length(${table.bodyMarkdown}) > 0
    and length(${table.claimsJson}) > 1
    and length(${table.fingerprint}) > 0`),
]);

export const contentAsset = pgTable("content_asset", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  rightsStatement: text("rights_statement").notNull(),
  visibility: text("visibility").notNull(),
  reviewStatus: text("review_status").notNull(),
  contentRef: text("content_ref").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
  // Null keeps historical content_ref rows readable. Appended so ALTER matches a fresh table.
  // No foreign key: object tombstones and brand purge delete the asset and the bytes separately.
  storedObjectId: text("stored_object_id"),
}, (table) => [
  index("content_asset_brand_idx").on(table.brandId, table.createdAt, table.id),
  index("content_asset_owner_idx").on(table.ownerId, table.createdAt, table.id),
  uniqueIndex("content_asset_object_uidx").on(table.storedObjectId).where(sql`${table.storedObjectId} is not null`),
  check("content_asset_state_check", sql`${table.kind} in ('cover', 'inline', 'other')
    and ${table.visibility} in ('public', 'internal')
    and ${table.reviewStatus} in ('pending', 'approved', 'rejected')
    and length(${table.contentRef}) > 0
    and length(${table.fingerprint}) > 0`),
]);

export const contentApproval = pgTable("content_approval", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  contentVersionId: text("content_version_id").notNull(),
  contentFingerprint: text("content_fingerprint").notNull(),
  factVersionIdsJson: text("fact_version_ids_json").notNull(),
  decision: text("decision").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_approval_version_fk",
    columns: [table.contentVersionId],
    foreignColumns: [contentVersion.id],
  }).onDelete("restrict"),
  index("content_approval_version_idx").on(table.contentVersionId, table.createdAt, table.id),
  index("content_approval_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("content_approval_state_check", sql`${table.decision} in ('approved', 'rejected')
    and length(${table.contentFingerprint}) > 0
    and length(${table.factVersionIdsJson}) > 1`),
]);

export const contentDeliveryPackage = pgTable("content_delivery_package", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  contentVersionId: text("content_version_id").notNull(),
  approvalId: text("approval_id"),
  targetChannel: text("target_channel").notNull(),
  kind: text("kind").notNull(),
  contentFingerprint: text("content_fingerprint").notNull(),
  factVersionIdsJson: text("fact_version_ids_json").notNull(),
  labelingProfileVersion: text("labeling_profile_version").notNull(),
  doNotReuse: integer("do_not_reuse").notNull().default(0),
  nonPublishable: integer("non_publishable").notNull().default(0),
  manifestJson: text("manifest_json").notNull(),
  filesJson: text("files_json").notNull(),
  packageFingerprint: text("package_fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_delivery_package_version_fk",
    columns: [table.contentVersionId],
    foreignColumns: [contentVersion.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_delivery_package_approval_fk",
    columns: [table.approvalId],
    foreignColumns: [contentApproval.id],
  }).onDelete("restrict"),
  index("content_delivery_package_version_idx").on(table.contentVersionId, table.createdAt, table.id),
  index("content_delivery_package_brand_idx").on(table.brandId, table.createdAt, table.id),
  check("content_delivery_package_state_check", sql`${table.kind} in ('formal', 'review')
    and ${table.doNotReuse} in (0, 1)
    and ${table.nonPublishable} in (0, 1)
    and (${table.kind} = 'review' or (${table.nonPublishable} = 0 and ${table.approvalId} is not null))
    and length(${table.manifestJson}) > 1
    and length(${table.filesJson}) > 1
    and length(${table.packageFingerprint}) > 0`),
]);

export const contentExportJob = pgTable("content_export_job", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  operationId: text("operation_id").notNull(),
  status: text("status").notNull(),
  selectionJson: text("selection_json").notNull(),
  preflightJson: text("preflight_json").notNull(),
  chosenSubsetJson: text("chosen_subset_json").notNull(),
  resultPackageIdsJson: text("result_package_ids_json").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("content_export_job_operation_uidx").on(table.brandId, table.operationId),
  index("content_export_job_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("content_export_job_state_check", sql`${table.status} in ('queued', 'ready', 'failed')
    and length(${table.selectionJson}) > 1
    and length(${table.preflightJson}) > 1
    and length(${table.chosenSubsetJson}) > 1
    and length(${table.resultPackageIdsJson}) > 1`),
]);

export const contentPublication = pgTable("content_publication", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  contentVersionId: text("content_version_id").notNull(),
  approvalId: text("approval_id").notNull(),
  contentFingerprint: text("content_fingerprint").notNull(),
  targetAccount: text("target_account").notNull(),
  pageUrl: text("page_url").notNull(),
  publisherId: text("publisher_id").notNull(),
  claimedPublishedAt: text("claimed_published_at").notNull(),
  channelDeclaration: text("channel_declaration").notNull(),
  status: text("status").notNull(),
  effectiveAt: text("effective_at"),
  evidenceGrade: text("evidence_grade"),
  supersededBy: text("superseded_by"),
  operationId: text("operation_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  predecessorId: text("predecessor_id"),
}, (table) => [
  foreignKey({
    name: "content_publication_version_fk",
    columns: [table.contentVersionId],
    foreignColumns: [contentVersion.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_publication_approval_fk",
    columns: [table.approvalId],
    foreignColumns: [contentApproval.id],
  }).onDelete("restrict"),
  uniqueIndex("content_publication_operation_uidx").on(table.brandId, table.operationId),
  index("content_publication_version_idx").on(table.contentVersionId, table.createdAt, table.id),
  index("content_publication_brand_idx").on(table.brandId, table.updatedAt, table.id),
  index("content_publication_owner_idx").on(table.ownerId, table.updatedAt, table.id),
  check("content_publication_state_check", sql`${table.status} in (
      'prepared', 'submitted', 'draft_only', 'pending_check', 'verified_public',
      'verified_manual', 'mismatch', 'access_limited', 'removed')
    and (${table.evidenceGrade} is null or ${table.evidenceGrade} in ('public', 'manual'))
    and length(${table.contentFingerprint}) > 0
    and length(${table.pageUrl}) > 0
    and length(${table.targetAccount}) > 0
    and length(${table.channelDeclaration}) > 0`),
]);

export const contentPublicationCheck = pgTable("content_publication_check", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  method: text("method").notNull(),
  resultStatus: text("result_status").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  actorId: text("actor_id").notNull(),
  checkedAt: text("checked_at").notNull(),
  notes: text("notes"),
}, (table) => [
  foreignKey({
    name: "content_publication_check_publication_fk",
    columns: [table.publicationId],
    foreignColumns: [contentPublication.id],
  }).onDelete("cascade"),
  index("content_publication_check_publication_idx").on(table.publicationId, table.checkedAt, table.id),
  index("content_publication_check_brand_idx").on(table.brandId, table.checkedAt, table.id),
  check("content_publication_check_state_check", sql`${table.method} in ('public_fetch', 'manual_evidence')
    and ${table.resultStatus} in (
      'draft_only', 'pending_check', 'verified_public', 'verified_manual',
      'mismatch', 'access_limited', 'removed')
    and length(${table.evidenceJson}) > 1`),
]);

export const contentPublicationAction = pgTable("content_publication_action", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_publication_action_publication_fk",
    columns: [table.publicationId],
    foreignColumns: [contentPublication.id],
  }).onDelete("cascade"),
  index("content_publication_action_publication_idx").on(table.publicationId, table.createdAt, table.id),
  index("content_publication_action_brand_idx").on(table.brandId, table.updatedAt, table.id),
  check("content_publication_action_state_check", sql`${table.kind} in ('repair_mismatch', 'confirm_removal', 'reverify')
    and ${table.status} in ('open', 'done', 'cancelled')
    and length(${table.reason}) > 0`),
]);

// One profile per brand and channel key. Publishing appends a version and does not rewrite older limits.
export const channelProfile = pgTable("channel_profile", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  channelKey: text("channel_key").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("channel_profile_brand_channel_uidx").on(table.brandId, table.channelKey),
  index("channel_profile_owner_idx").on(table.ownerId, table.brandId, table.updatedAt, table.id),
  check("channel_profile_state_check", sql`length(${table.channelKey}) between 1 and 64
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

// Immutable layout snapshot. max_characters null means that version sets no length ceiling.
export const channelProfileVersion = pgTable("channel_profile_version", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  channelKey: text("channel_key").notNull(),
  maxCharacters: integer("max_characters"),
  note: text("note").notNull(),
  versionNumber: integer("version_number").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    name: "channel_profile_version_profile_fk",
    columns: [table.profileId],
    foreignColumns: [channelProfile.id],
  }).onDelete("cascade"),
  uniqueIndex("channel_profile_version_number_uidx").on(table.profileId, table.versionNumber),
  index("channel_profile_version_owner_idx").on(table.ownerId, table.brandId, table.channelKey, table.versionNumber, table.id),
  check("channel_profile_version_state_check", sql`length(${table.channelKey}) between 1 and 64
    and (${table.maxCharacters} is null or ${table.maxCharacters} between 1 and 1000000)
    and length(${table.note}) between 1 and 2000
    and ${table.versionNumber} between 1 and 1000000
    and length(${table.createdAt}) between 20 and 40`),
]);

// One channel body per master version. Approval is the variant's own row, never the master's approval id.
// needs_own_approval stores variantNeedsOwnApproval; blocked does not rewrite other channels.
// channel_profile_version_id stays null for variants saved before a profile existed.
export const contentChannelVariant = pgTable("content_channel_variant", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  contentVersionId: text("content_version_id").notNull(),
  channel: text("channel").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  approvalStatus: text("approval_status").notNull(),
  approvalId: text("approval_id"),
  needsOwnApproval: integer("needs_own_approval").notNull(),
  blocked: integer("blocked").notNull().default(0),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // Appended so ALTER TABLE matches a fresh table's column order.
  channelProfileVersionId: text("channel_profile_version_id"),
}, (table) => [
  foreignKey({
    name: "content_channel_variant_version_fk",
    columns: [table.contentVersionId],
    foreignColumns: [contentVersion.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_channel_variant_approval_fk",
    columns: [table.approvalId],
    foreignColumns: [contentApproval.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "content_channel_variant_profile_fk",
    columns: [table.channelProfileVersionId],
    foreignColumns: [channelProfileVersion.id],
  }).onDelete("restrict"),
  uniqueIndex("content_channel_variant_channel_uidx").on(table.contentVersionId, table.channel),
  uniqueIndex("content_channel_variant_approval_uidx").on(table.approvalId),
  index("content_channel_variant_owner_idx").on(table.ownerId, table.brandId, table.updatedAt, table.id),
  check("content_channel_variant_state_check", sql`${table.approvalStatus} in ('draft', 'approved')
    and ${table.needsOwnApproval} in (0, 1)
    and ${table.blocked} in (0, 1)
    and length(${table.channel}) > 0
    and length(${table.bodyMarkdown}) > 0
    and length(${table.fingerprint}) > 0
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

// One open task per brand and fact version. Closing the task frees the partial unique key.
// Page rows keep each channel's plan date, verification date, and planned|verified|blocked state.
export const contentMaintenanceTask = pgTable("content_maintenance_task", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  factVersionId: text("fact_version_id").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_maintenance_task_fact_fk",
    columns: [table.brandId, table.factVersionId],
    foreignColumns: [brandFactVersion.brandId, brandFactVersion.id],
  }).onDelete("cascade"),
  uniqueIndex("content_maintenance_task_open_uidx").on(table.brandId, table.factVersionId)
    .where(sql`${table.status} = 'open'`),
  index("content_maintenance_task_owner_idx").on(table.ownerId, table.brandId, table.updatedAt, table.id),
  check("content_maintenance_task_state_check", sql`${table.status} in ('open', 'closed')
    and ${table.reason} in ('expired', 'revoked', 'mismatch', 'removed')
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);

export const contentMaintenancePage = pgTable("content_maintenance_page", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  brandId: text("brand_id").notNull().references(() => brand.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  pageId: text("page_id").notNull(),
  draftId: text("draft_id").notNull(),
  pageUrl: text("page_url").notNull(),
  channel: text("channel").notNull(),
  plannedOn: text("planned_on"),
  verifiedOn: text("verified_on"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  foreignKey({
    name: "content_maintenance_page_task_fk",
    columns: [table.taskId],
    foreignColumns: [contentMaintenanceTask.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "content_maintenance_page_version_fk",
    columns: [table.draftId],
    foreignColumns: [contentVersion.id],
  }).onDelete("restrict"),
  uniqueIndex("content_maintenance_page_page_uidx").on(table.taskId, table.pageId),
  index("content_maintenance_page_task_idx").on(table.ownerId, table.taskId, table.channel, table.id),
  check("content_maintenance_page_state_check", sql`${table.status} in ('planned', 'verified', 'blocked')
    and length(${table.channel}) between 1 and 64
    and length(${table.pageUrl}) > 0
    and length(${table.pageId}) > 0
    and (${table.plannedOn} is null or length(${table.plannedOn}) = 10)
    and (${table.verifiedOn} is null or length(${table.verifiedOn}) = 10)
    and (${table.status} <> 'verified' or ${table.verifiedOn} is not null)
    and (${table.status} <> 'planned' or ${table.verifiedOn} is null)
    and length(${table.createdAt}) between 20 and 40
    and length(${table.updatedAt}) between 20 and 40`),
]);
