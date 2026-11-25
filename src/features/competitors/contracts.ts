import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const competitorErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type CompetitorError = keyof typeof competitorErrors;

const labelSchema = z.string().trim().min(1).max(80);

export const saveCompetitorSetSchema = z.strictObject({
  brandId: brandIdSchema,
  labels: z.array(labelSchema).max(5),
});
export type SaveCompetitorSetInput = z.infer<typeof saveCompetitorSetSchema>;

export const mentionStates = ["true", "false", "unknown"] as const;
export const mentionStateSchema = z.enum(mentionStates);
export type MentionStateValue = z.infer<typeof mentionStateSchema>;

export const recordMentionsSchema = z.strictObject({
  brandId: brandIdSchema,
  setId: brandIdSchema,
  observationId: brandIdSchema,
  ordered: z.boolean(),
  mentions: z.array(z.strictObject({
    label: labelSchema,
    state: mentionStateSchema.optional(),
    position: z.int().positive().optional(),
  })).min(0).max(5),
}).superRefine((input, context) => {
  const labels = input.mentions.map((item) => item.label);
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: "custom", path: ["mentions"], message: "duplicate label" });
  }
  for (const [index, mention] of input.mentions.entries()) {
    const state = mention.state ?? "true";
    if (state !== "true" && mention.position !== undefined) {
      context.addIssue({ code: "custom", path: ["mentions", index, "position"], message: "only mentioned brand has position" });
    }
    if (input.ordered && state === "true" && mention.position === undefined) {
      context.addIssue({ code: "custom", path: ["mentions", index, "position"], message: "position required" });
    }
    if (!input.ordered && mention.position !== undefined) {
      context.addIssue({ code: "custom", path: ["mentions", index, "position"], message: "unordered has no position" });
    }
  }
});
export type RecordMentionsInput = z.infer<typeof recordMentionsSchema>;

export const inspectCitationSchema = z.strictObject({
  brandId: brandIdSchema,
  citationId: brandIdSchema,
  pageLive: z.boolean(),
  readable: z.boolean(),
  authorKnown: z.boolean(),
  supportsBrand: z.boolean(),
  supportedClaim: z.string().trim().max(500).optional(),
  factVersionId: brandIdSchema.nullable().optional(),
});
export type InspectCitationInput = z.infer<typeof inspectCitationSchema>;

export const briefStatuses = ["proposed", "accepted", "dismissed"] as const;

export const proposeBriefSchema = z.strictObject({
  brandId: brandIdSchema,
  questionCluster: z.string().trim().min(1).max(200),
  gap: z.string().trim().min(1).max(2000),
  facts: z.array(z.string().trim().min(1).max(500)).max(20),
  sourceIds: z.array(brandIdSchema).min(1).max(10),
  sourceText: z.string().max(8000),
  briefText: z.string().max(8000),
  sourceBrand: z.string().trim().max(80),
  ownBrand: z.string().trim().max(80),
});
export type ProposeBriefInput = z.infer<typeof proposeBriefSchema>;

export const briefStatusSchema = z.strictObject({
  brandId: brandIdSchema,
  briefId: brandIdSchema,
  status: z.enum(["accepted", "dismissed"]),
});
export type BriefStatusInput = z.infer<typeof briefStatusSchema>;

export const researchHandoffSchema = z.strictObject({
  brandId: brandIdSchema,
  briefId: brandIdSchema,
});
export type ResearchHandoffInput = z.infer<typeof researchHandoffSchema>;

export function normalizeCompetitorLabels(labels: readonly string[]) {
  const unique = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (unique.length > 5 || unique.some((label) => [...label].length > 80 || label.includes("\0"))) return null;
  return unique;
}
