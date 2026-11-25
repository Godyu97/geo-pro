import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";

export const triStates = ["true", "false", "unknown"] as const;
export const triStateSchema = z.enum(triStates);
export type TriState = z.infer<typeof triStateSchema>;

const regionCodePattern = /^[A-Za-z]{2}$/;

export const observedRegionSchema = z.union([
  z.literal("unknown"),
  z.string().regex(regionCodePattern),
]);

function samplingTriState(value: string | null | undefined): TriState | null {
  if (value === undefined || value === null) return "unknown";
  if (value === "true" || value === "false" || value === "unknown") return value;
  return null;
}

export function resolveSamplingConditions(input: {
  region: string;
  targetRegion?: string | null;
  observedRegion?: string | null;
  newSession?: string | null;
  productMode?: string | null;
}): {
  region: string;
  targetRegion: string;
  observedRegion: string;
  newSession: TriState;
  productMode: TriState;
} | null {
  if (input.region.length !== 2) return null;
  const requestedTarget = input.targetRegion ?? input.region;
  if (requestedTarget.length !== 2 || requestedTarget.toUpperCase() !== input.region.toUpperCase()) return null;
  const observedSource = input.observedRegion ?? "unknown";
  if (observedSource.length === 0) return null;
  const observedRegion = observedSource.toLowerCase() === "unknown" ? "unknown" : observedSource.toUpperCase();
  if (observedRegion !== "unknown" && !/^[A-Z]{2}$/.test(observedRegion)) return null;
  const newSession = samplingTriState(input.newSession);
  const productMode = samplingTriState(input.productMode);
  if (!newSession || !productMode) return null;
  const region = input.region.toUpperCase();
  return {
    region,
    targetRegion: region,
    observedRegion,
    newSession,
    productMode,
  };
}

export const evidenceStates = ["draft_evidence", "complete", "incomplete", "contested"] as const;
export const citationSetStates = ["complete", "partial", "unsupported", "missing"] as const;
export const citationOrigins = [
  "provider_native", "consumer_visible", "search_candidate", "analyst_found", "custom_pipeline",
] as const;
export const ownershipStates = ["owned_domain", "owned_account", "competitor", "third_party", "unknown"] as const;
export const pageStatuses = ["unknown", "reachable", "restricted", "not_applicable"] as const;
export const analysisStatuses = ["pending", "classified", "needs_review", "revised"] as const;
export const analysisDraftStatuses = ["draft", "applied", "dismissed"] as const;
export const sourceModes = ["model_api", "consumer_ui"] as const;
export const networkTriggers = ["triggered", "not_triggered", "unknown"] as const;
export const captureMethods = ["official_api", "manual", "assisted", "isolated"] as const;

export const evidenceErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  NOT_ENTITLED: 409,
  VERSION_CONFLICT: 409,
  EVIDENCE_INCOMPLETE: 409,
  EVIDENCE_LOCKED: 409,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  INVALID_MODEL_OUTPUT: 422,
  AI_FAILED: 502,
  DRAFT_CONFLICT: 409,
} as const;
export type EvidenceError = keyof typeof evidenceErrors;

const citationInputSchema = z.strictObject({
  rawUrl: z.string().url().max(2000),
  normalizedUrl: z.string().url().max(2000).optional(),
  citationOrigin: z.enum(citationOrigins),
  positionLabel: z.string().max(120).nullable().optional(),
  ownership: z.enum(ownershipStates).default("unknown"),
  pageStatus: z.enum(pageStatuses).default("unknown"),
});

export const ingestAdoptedSchema = z.strictObject({
  action: z.literal("ingest-adopted"),
  brandId: brandIdSchema,
  slotId: brandIdSchema,
  operationId: brandIdSchema,
  officialWebsite: z.string().url().max(500).nullable().optional(),
  brandName: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1).max(80)).max(20).default([]),
  mentioned: triStateSchema.optional(),
  recommended: triStateSchema.optional(),
  officialSiteCited: triStateSchema.optional(),
  evidenceSpan: z.string().max(2000).nullable().optional(),
  citations: z.array(citationInputSchema).max(50).optional(),
  citationSetState: z.enum(citationSetStates).optional(),
  targetRegion: z.string().length(2).optional(),
  observedRegion: observedRegionSchema.optional(),
  newSession: triStateSchema.optional(),
  productMode: triStateSchema.optional(),
});
export type IngestAdoptedInput = z.infer<typeof ingestAdoptedSchema>;

export const submitManualSchema = z.strictObject({
  action: z.literal("submit-manual"),
  brandId: brandIdSchema,
  operationId: brandIdSchema,
  slotId: brandIdSchema.nullable().optional(),
  questionText: z.string().min(1).max(4000),
  answerText: z.string().max(8000).default(""),
  region: z.string().length(2),
  language: z.string().min(2).max(40),
  requestedNetworkMode: z.enum(networkModes),
  targetRegion: z.string().length(2).optional(),
  observedRegion: observedRegionSchema.optional(),
  newSession: triStateSchema.optional(),
  productMode: triStateSchema.optional(),
  entityVersion: z.int().positive(),
  citationSetState: z.enum(citationSetStates),
  citations: z.array(citationInputSchema).max(50).default([]),
  locatorRef: z.string().max(500).nullable().optional(),
  collectorId: z.string().min(1).max(128).nullable().optional(),
  contested: z.boolean().default(false),
  brandName: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1).max(80)).max(20).default([]),
  officialWebsite: z.string().url().max(500).nullable().optional(),
  mentioned: triStateSchema.optional(),
  recommended: triStateSchema.optional(),
  officialSiteCited: triStateSchema.optional(),
  evidenceSpan: z.string().max(2000).nullable().optional(),
});
export type SubmitManualInput = z.infer<typeof submitManualSchema>;

export const completeManualSchema = submitManualSchema.extend({
  action: z.literal("complete-manual"),
  observationId: brandIdSchema,
});
export type CompleteManualInput = z.infer<typeof completeManualSchema>;

export const reviseAnalysisSchema = z.strictObject({
  action: z.literal("revise-analysis"),
  brandId: brandIdSchema,
  observationId: brandIdSchema,
  expectedVersion: z.int().positive(),
  operationId: brandIdSchema,
  mentioned: triStateSchema,
  recommended: triStateSchema,
  officialSiteCited: triStateSchema,
  evidenceSpan: z.string().max(2000).nullable().optional(),
  reason: z.string().min(1).max(1000),
});
export type ReviseAnalysisInput = z.infer<typeof reviseAnalysisSchema>;

export const generateAnalysisDraftSchema = z.strictObject({
  action: z.literal("generate"),
});

export const applyAnalysisDraftSchema = z.strictObject({
  action: z.literal("apply"),
  draftId: brandIdSchema,
  expectedVersion: z.int().positive(),
  operationId: brandIdSchema,
  mentioned: triStateSchema,
  recommended: triStateSchema,
  officialSiteCited: triStateSchema,
  reason: z.string().min(1).max(1000),
});

export const dismissAnalysisDraftSchema = z.strictObject({
  action: z.literal("dismiss"),
  draftId: brandIdSchema,
});

export const analysisDraftCommandSchema = z.discriminatedUnion("action", [
  generateAnalysisDraftSchema,
  applyAnalysisDraftSchema,
  dismissAnalysisDraftSchema,
]);
export type AnalysisDraftCommand = z.infer<typeof analysisDraftCommandSchema>;

export const evidenceWriteSchema = z.discriminatedUnion("action", [
  ingestAdoptedSchema,
  submitManualSchema,
  completeManualSchema,
  reviseAnalysisSchema,
]);
export type EvidenceWriteInput = z.infer<typeof evidenceWriteSchema>;

export function qualifiesForC(citationSetState: (typeof citationSetStates)[number]) {
  return citationSetState === "complete";
}

export function nativeCited(citations: Array<{ citationOrigin: string }>) {
  return citations.some((item) => item.citationOrigin === "provider_native" || item.citationOrigin === "consumer_visible");
}
