import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const templateKinds = ["fact_faq", "scenario_solution", "verifiable_comparison"] as const;
export const templateKindSchema = z.enum(templateKinds);
export type TemplateKind = z.infer<typeof templateKindSchema>;

export const briefStatuses = ["draft", "confirmed", "invalidated"] as const;
export const briefStatusSchema = z.enum(briefStatuses);
export type BriefStatus = z.infer<typeof briefStatusSchema>;

export const batchStatuses = ["queued", "running", "paused", "partial", "completed", "cancelled"] as const;
export const batchStatusSchema = z.enum(batchStatuses);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const unitStatuses = ["queued", "running", "succeeded", "failed", "blocked"] as const;
export const unitStatusSchema = z.enum(unitStatuses);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

export const versionStatuses = ["draft", "in_review", "approved", "rejected", "invalidated"] as const;
export const versionStatusSchema = z.enum(versionStatuses);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const labelingStatuses = ["verified", "unverified"] as const;
export const labelingStatusSchema = z.enum(labelingStatuses);
export type LabelingStatus = z.infer<typeof labelingStatusSchema>;

export const assetKinds = ["cover", "inline", "other"] as const;
export const assetKindSchema = z.enum(assetKinds);
export const assetVisibilities = ["public", "internal"] as const;
export const assetVisibilitySchema = z.enum(assetVisibilities);
export const assetReviewStatuses = ["pending", "approved", "rejected"] as const;
export const assetReviewStatusSchema = z.enum(assetReviewStatuses);

export const approvalDecisions = ["approved", "rejected"] as const;
export const approvalDecisionSchema = z.enum(approvalDecisions);

export const packageKinds = ["formal", "review"] as const;
export const packageKindSchema = z.enum(packageKinds);
export type PackageKind = z.infer<typeof packageKindSchema>;

export const exportModes = ["auto", "formal", "review"] as const;
export const exportModeSchema = z.enum(exportModes);
export type ExportMode = z.infer<typeof exportModeSchema>;

export const exportJobStatuses = ["queued", "ready", "failed"] as const;
export const exportJobStatusSchema = z.enum(exportJobStatuses);

export const preflightBlockerCodes = ["APPROVAL_REQUIRED", "FACT_INVALID", "LABELING_UNVERIFIED"] as const;
export type PreflightBlockerCode = (typeof preflightBlockerCodes)[number];

export const defaultTargetChannel = "primary_page";
export const defaultLabelingProfileVersion = "unverified";
export const targetChannelSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/);

export const contentGapCodes = [
  "audienceMissing",
  "targetGapMissing",
  "boundaryMissing",
  "sourceMissing",
  "primaryPageMissing",
  "conversionActionMissing",
  "templateMissing",
  "titlesMissing",
  "factsMissing",
  "competitorSourceMissing",
] as const;
export const contentGapCodeSchema = z.enum(contentGapCodes);
export type ContentGapCode = z.infer<typeof contentGapCodeSchema>;

export const publicationStatuses = [
  "prepared",
  "submitted",
  "draft_only",
  "pending_check",
  "verified_public",
  "verified_manual",
  "mismatch",
  "access_limited",
  "removed",
] as const;
export const publicationStatusSchema = z.enum(publicationStatuses);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

export const publicationCheckMethods = ["public_fetch", "manual_evidence"] as const;
export const publicationCheckMethodSchema = z.enum(publicationCheckMethods);

export const publicationEvidenceGrades = ["public", "manual"] as const;
export const publicationEvidenceGradeSchema = z.enum(publicationEvidenceGrades);

export const publicationActionKinds = ["repair_mismatch", "confirm_removal", "reverify"] as const;
export const publicationActionKindSchema = z.enum(publicationActionKinds);

export const publicationActionStatuses = ["open", "done", "cancelled"] as const;
export const publicationActionStatusSchema = z.enum(publicationActionStatuses);

export const fixturePageSchema = z.strictObject({
  accessClass: z.enum(["public", "login_wall", "draft_box", "removed"]),
  httpStatus: z.int().min(100).max(599),
  title: z.string().max(500),
  bodyText: z.string().max(100_000),
  pageMarker: z.string().max(500).optional(),
});
export type FixturePageInput = z.infer<typeof fixturePageSchema>;

export const contentErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  EVIDENCE_REQUIRED: 422,
  OPERATION_CONFLICT: 409,
  APPROVAL_REQUIRED: 422,
  FACT_INVALID: 422,
  UNGROUNDED_CLAIM: 422,
  INVALID_MODEL_OUTPUT: 422,
  AI_UNAVAILABLE: 503,
  AI_FAILED: 502,
  LABELING_UNVERIFIED: 422,
  PREFLIGHT_REQUIRED: 422,
  SUBSET_INVALID: 422,
  APPROVAL_INVALID: 422,
  PUBLICATION_CONFLICT: 409,
  ASSET_TYPE_REJECTED: 415,
  ASSET_TOO_LARGE: 413,
  ASSET_UNREVIEWED: 422,
  EVIDENCE_TYPE_REJECTED: 415,
  EVIDENCE_TOO_LARGE: 413,
  SCREENSHOT_REQUIRED: 422,
  SERVICE_UNAVAILABLE: 503,
  VARIANT_REAPPROVAL_REQUIRED: 422,
  VARIANT_CHANNEL_BLOCKED: 422,
} as const;
export type ContentError = keyof typeof contentErrors;

export const briefDraftFieldsSchema = z.strictObject({
  audience: z.string().max(500),
  targetGap: z.string().max(1000),
  applicableBoundary: z.string().max(1000),
  primaryPage: z.string().max(2000),
  conversionAction: z.string().max(500),
  templateKind: templateKindSchema,
  titleCandidates: z.array(z.string().min(1).max(200)).max(3),
  factVersionIds: z.array(brandIdSchema).max(20),
  competitorSource: z.string().max(2000).nullable().optional(),
});
export type BriefDraftFields = z.infer<typeof briefDraftFieldsSchema>;

export const saveBriefDraftSchema = z.strictObject({
  action: z.literal("save-brief-draft"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  briefId: brandIdSchema.optional(),
  planId: brandIdSchema.nullable().optional(),
  optimizationTaskId: brandIdSchema.nullable().optional(),
  questionCluster: z.string().min(1).max(128).optional(),
  fields: briefDraftFieldsSchema,
});
export type SaveBriefDraftInput = z.infer<typeof saveBriefDraftSchema>;

export const confirmBriefSchema = z.strictObject({
  action: z.literal("confirm-brief"),
  brandId: brandIdSchema,
  briefId: brandIdSchema,
  operationId: brandIdSchema,
});
export type ConfirmBriefInput = z.infer<typeof confirmBriefSchema>;

export const generateBatchSchema = z.strictObject({
  action: z.literal("generate-batch"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  briefIds: z.array(brandIdSchema).min(1).max(5),
  fixtures: z.strictObject({
    failBriefIds: z.array(brandIdSchema).max(5).optional(),
    /** Process this many units then leave the rest queued and pause the batch. */
    pauseAfter: z.int().min(0).max(5).optional(),
  }).optional(),
});
export type GenerateBatchInput = z.infer<typeof generateBatchSchema>;

export const draftFromFactsSchema = z.strictObject({
  action: z.literal("draft-from-facts"),
  brandId: brandIdSchema,
  briefId: brandIdSchema,
  operationId: brandIdSchema,
});
export type DraftFromFactsInput = z.infer<typeof draftFromFactsSchema>;

export const batchControlSchema = z.strictObject({
  action: z.enum(["pause-batch", "resume-batch", "cancel-batch", "retry-failed"]),
  brandId: brandIdSchema,
  batchId: brandIdSchema,
  operationId: brandIdSchema,
});
export type BatchControlInput = z.infer<typeof batchControlSchema>;

const versionCommandBase = {
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  versionId: brandIdSchema,
};

export const submitReviewSchema = z.strictObject({ action: z.literal("submit-review"), ...versionCommandBase });
export const approveContentSchema = z.strictObject({ action: z.literal("approve-content"), ...versionCommandBase });
export const rejectContentSchema = z.strictObject({ action: z.literal("reject-content"), ...versionCommandBase });
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type ApproveContentInput = z.infer<typeof approveContentSchema>;
export type RejectContentInput = z.infer<typeof rejectContentSchema>;

export const updateVariantSchema = z.strictObject({
  action: z.literal("update-variant"),
  ...versionCommandBase,
  title: z.string().trim().min(1).max(200).optional(),
  bodyMarkdown: z.string().min(1).max(50_000).optional(),
  imageAssetIds: z.array(brandIdSchema).max(10).optional(),
  targetChannel: targetChannelSchema.optional(),
  labelingProfileVersion: z.string().trim().min(1).max(64).optional(),
  labelingProfileStatus: labelingStatusSchema.optional(),
}).refine((value) => value.title !== undefined || value.bodyMarkdown !== undefined
  || value.imageAssetIds !== undefined || value.targetChannel !== undefined
  || value.labelingProfileVersion !== undefined || value.labelingProfileStatus !== undefined);
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const registerAssetSchema = z.strictObject({
  action: z.literal("register-asset"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  kind: assetKindSchema,
  source: z.string().trim().min(1).max(500),
  rightsStatement: z.string().trim().min(1).max(1000),
  visibility: assetVisibilitySchema,
  reviewStatus: assetReviewStatusSchema.default("pending"),
  contentRef: z.string().trim().min(1).max(2000),
});
export type RegisterAssetInput = z.infer<typeof registerAssetSchema>;

export const exportPreflightSchema = z.strictObject({
  action: z.literal("export-preflight"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  versionIds: z.array(brandIdSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
  mode: exportModeSchema.default("auto"),
});
export type ExportPreflightInput = z.infer<typeof exportPreflightSchema>;

export const exportConfirmSchema = z.strictObject({
  action: z.literal("export-confirm"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  chosenVersionIds: z.array(brandIdSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
});
export type ExportConfirmInput = z.infer<typeof exportConfirmSchema>;

const channelVariantCommand = {
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  versionId: brandIdSchema,
  channel: targetChannelSchema,
};

export const saveChannelVariantSchema = z.strictObject({
  action: z.literal("save-channel-variant"),
  ...channelVariantCommand,
  bodyMarkdown: z.string().min(1).max(50_000),
});
export type SaveChannelVariantInput = z.infer<typeof saveChannelVariantSchema>;

export const approveChannelVariantSchema = z.strictObject({
  action: z.literal("approve-channel-variant"),
  ...channelVariantCommand,
});
export type ApproveChannelVariantInput = z.infer<typeof approveChannelVariantSchema>;

export const blockChannelVariantSchema = z.strictObject({
  action: z.literal("block-channel-variant"),
  ...channelVariantCommand,
});
export type BlockChannelVariantInput = z.infer<typeof blockChannelVariantSchema>;

export const exportChannelVariantSchema = z.strictObject({
  action: z.literal("export-channel-variant"),
  ...channelVariantCommand,
});
export type ExportChannelVariantInput = z.infer<typeof exportChannelVariantSchema>;

export const submitPublicationSchema = z.strictObject({
  action: z.literal("submit-publication"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  versionId: brandIdSchema,
  targetAccount: z.string().trim().min(1).max(200),
  pageUrl: z.string().trim().url().max(2000),
  publisherId: z.string().trim().min(1).max(200),
  claimedPublishedAt: z.iso.datetime({ precision: 3 }),
  channelDeclaration: z.string().trim().min(1).max(500),
  fixturePage: fixturePageSchema.optional(),
});
export type SubmitPublicationInput = z.infer<typeof submitPublicationSchema>;

export const verifyPublicationSchema = z.strictObject({
  action: z.literal("verify-publication"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  publicationId: brandIdSchema,
  fixturePage: fixturePageSchema.optional(),
});
export type VerifyPublicationInput = z.infer<typeof verifyPublicationSchema>;

export const submitManualEvidenceSchema = z.strictObject({
  action: z.literal("submit-manual-evidence"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  publicationId: brandIdSchema,
  screenshotRef: z.string().trim().min(1).max(2000),
  pageMarker: z.string().trim().min(1).max(500),
  observedAt: z.iso.datetime({ precision: 3 }),
  bodyExcerpt: z.string().trim().min(1).max(50_000),
  reviewerNote: z.string().trim().max(2000).optional(),
});
export type SubmitManualEvidenceInput = z.infer<typeof submitManualEvidenceSchema>;

export const markPublicationRemovedSchema = z.strictObject({
  action: z.literal("mark-publication-removed"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  publicationId: brandIdSchema,
  reason: z.string().trim().min(1).max(1000),
});
export type MarkPublicationRemovedInput = z.infer<typeof markPublicationRemovedSchema>;

export const contentWriteSchema = z.discriminatedUnion("action", [
  saveBriefDraftSchema,
  confirmBriefSchema,
  generateBatchSchema,
  draftFromFactsSchema,
  batchControlSchema,
  submitReviewSchema,
  approveContentSchema,
  rejectContentSchema,
  updateVariantSchema,
  registerAssetSchema,
  exportPreflightSchema,
  exportConfirmSchema,
  saveChannelVariantSchema,
  approveChannelVariantSchema,
  blockChannelVariantSchema,
  exportChannelVariantSchema,
  submitPublicationSchema,
  verifyPublicationSchema,
  submitManualEvidenceSchema,
  markPublicationRemovedSchema,
]);
export type ContentWriteInput = z.infer<typeof contentWriteSchema>;


export const listContentQuerySchema = z.strictObject({
  brandId: brandIdSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListContentQuery = z.infer<typeof listContentQuerySchema>;
