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

export const recordMentionsSchema = z.strictObject({
  brandId: brandIdSchema,
  setId: brandIdSchema,
  observationId: brandIdSchema,
  ordered: z.boolean(),
  mentions: z.array(z.strictObject({
    label: labelSchema,
    position: z.int().positive().optional(),
  })).min(1).max(5),
}).superRefine((input, context) => {
  const labels = input.mentions.map((item) => item.label);
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: "custom", path: ["mentions"], message: "duplicate label" });
  }
  for (const [index, mention] of input.mentions.entries()) {
    if (input.ordered && mention.position === undefined) {
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
});
export type InspectCitationInput = z.infer<typeof inspectCitationSchema>;

export function normalizeCompetitorLabels(labels: readonly string[]) {
  const unique = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (unique.length > 5 || unique.some((label) => [...label].length > 80 || label.includes("\0"))) return null;
  return unique;
}
