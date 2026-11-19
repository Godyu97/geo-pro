import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const channelKinds = ["consumer_ui", "model_api", "custom_pipeline"] as const;
export const channelKindSchema = z.enum(channelKinds);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const capabilityStatuses = ["candidate", "verified", "degraded", "disabled"] as const;
export const capabilityStatusSchema = z.enum(capabilityStatuses);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

export const capabilityReasons = [
  "initial-record", "verification", "significant-change", "disable", "restore", "expiry-review",
] as const;
export const citationCapabilities = ["complete", "partial", "unsupported"] as const;
export const networkModes = ["on", "off", "unknown"] as const;
export const actualNetworkStates = ["true", "false", "unknown"] as const;
export const triggerEvidenceStates = ["none", "observed"] as const;
export const runSpaces = ["formal", "demo"] as const;

const label = z.string().trim().min(1).max(80);
const summary = z.string().trim().min(1).max(500);
const sop = z.string().trim().min(1).max(2000);
const flag = z.union([z.literal(0), z.literal(1)]);

export const capabilityValues = z.object({
  displayName: label,
  productEntry: z.string().trim().min(1).max(200),
  mode: label,
  modelVersion: label,
  availability: z.string().trim().min(1).max(200),
  searchRequired: flag,
  citationCapability: z.enum(citationCapabilities),
  regionTarget: label,
  regionActual: label,
  limitsSummary: summary,
  sopSummary: sop,
  verifiedAt: z.iso.datetime({ precision: 3 }).nullable(),
  expiresAt: z.iso.datetime({ precision: 3 }).nullable(),
  publicVisible: flag,
});

export const capabilityChangeSchema = z.strictObject({
  action: z.literal("record"),
  actorId: opaqueIdSchema,
  operationId: z.uuid(),
  expectedVersion: z.int().positive().nullable(),
  channelId: z.uuid().nullable(),
  vendorId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  kind: channelKindSchema,
  reason: z.enum(capabilityReasons),
  status: capabilityStatusSchema,
  ...capabilityValues.shape,
});
export type CapabilityChange = z.infer<typeof capabilityChangeSchema>;

export const capabilitySnapshotSchema = capabilityValues.extend({
  channelId: z.uuid(),
  vendorId: z.string().min(1).max(80),
  kind: channelKindSchema,
  version: z.int().positive(),
  status: capabilityStatusSchema,
  reason: z.enum(capabilityReasons),
  changedAt: z.iso.datetime(),
});
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;

export const publicCapabilitySchema = z.object({
  channelId: z.uuid(),
  vendorId: z.string().min(1).max(80),
  kind: channelKindSchema,
  displayName: label,
  productEntry: z.string().min(1).max(200),
  mode: label,
  modelVersion: label,
  status: z.literal("verified"),
  limitsSummary: summary,
  verifiedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type PublicCapability = z.infer<typeof publicCapabilitySchema>;

export const userCapabilitySchema = capabilitySnapshotSchema.omit({ sopSummary: true }).extend({
  eligibility: z.enum(["eligible", "unverified", "expired", "degraded", "disabled", "missing"]),
});
export type UserCapability = z.infer<typeof userCapabilitySchema>;

export const formalRunSchema = z.strictObject({
  channelIds: z.array(z.uuid()).min(1).max(20),
  space: z.enum(runSpaces),
});
export type FormalRunRequest = z.infer<typeof formalRunSchema>;

export const answerNetworkInputSchema = z.strictObject({
  brandId: brandIdSchema,
  channelId: z.uuid(),
  requestedNetworkMode: z.enum(networkModes),
  triggerEvidence: z.enum(triggerEvidenceStates),
});
export type AnswerNetworkInput = z.infer<typeof answerNetworkInputSchema>;

export const answerNetworkRecordSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  channelId: z.uuid(),
  channelVersion: z.int().positive(),
  requestedNetworkMode: z.enum(networkModes),
  actualNetwork: z.enum(actualNetworkStates),
  triggerEvidence: z.enum(triggerEvidenceStates),
  qualifiesRequiredSearch: flag,
  createdAt: z.iso.datetime(),
});
export type AnswerNetworkRecord = z.infer<typeof answerNetworkRecordSchema>;

export const capabilityErrors = {
  SESSION_REQUIRED: 401, SESSION_CHANGED: 409, FORBIDDEN: 403, NOT_FOUND: 404,
  INVALID_INPUT: 400, VERSION_CONFLICT: 409, OPERATION_CONFLICT: 409,
  CHANNEL_UNVERIFIED: 409, RUN_NOT_OPEN: 409, SERVICE_UNAVAILABLE: 503,
} as const;
export type CapabilityError = keyof typeof capabilityErrors;
