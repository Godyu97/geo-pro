import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

const id = brandIdSchema;
const revision = z.number().int().positive();
export const timestamp = z.iso.datetime({ precision: 3 });

function bounded(min: number, max: number) {
  return z.string().trim().refine((value) => {
    const length = Array.from(value).length;
    return length >= min && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

function canonicalLanguage(value: string) {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

export const questionType = z.enum(["discovery", "scenario", "constraint", "comparison", "brand_fact", "exploration"]);
export const buyingStage = z.enum(["awareness", "consider", "compare", "decide"]);
export const questionSource = z.enum(["manual", "paste", "generated", "consultation"]);
export const questionStatus = z.enum(["candidate", "confirmed", "inactive"]);
export const primaryTypes = new Set<z.infer<typeof questionType>>(["discovery", "scenario", "constraint"]);

export const promptCluster = z.strictObject({
  id,
  audience: bounded(0, 120),
  intent: bounded(0, 120),
  primaryPage: bounded(0, 2048),
  conversionAction: bounded(0, 200),
});

export const promptQuestion = z.strictObject({
  id,
  clusterId: id,
  text: bounded(5, 500),
  source: questionSource,
  sourceNote: bounded(0, 200),
  type: questionType,
  stage: buyingStage,
  region: bounded(2, 2).regex(/^[a-z]{2}$/i).transform((value) => value.toUpperCase()),
  language: bounded(2, 40).transform((value, context) => {
    const canonical = canonicalLanguage(value);
    if (canonical) return canonical;
    context.addIssue({ code: "custom", message: "Invalid business language" });
    return z.NEVER;
  }),
  status: questionStatus,
  acceptSimilar: z.boolean(),
  primary: z.boolean(),
});

export const maxDraftQuestions = 80;
export const draftContent = z.strictObject({
  clusters: z.array(promptCluster).max(10),
  questions: z.array(promptQuestion).max(maxDraftQuestions),
});

export const promptCommand = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("saveDraft"), revision: revision.nullable(), baseSetId: id.nullable(), content: draftContent,
  }),
  z.strictObject({
    action: z.literal("freeze"), id, revision: revision.nullable(), setId: id, baseSetId: id.nullable(), content: draftContent,
  }),
  z.strictObject({ action: z.literal("reference"), setVersionId: id, consumerId: id }),
]);

export const cursorSchema = z.object({ at: timestamp, id });
export const promptScope = z.strictObject({ ownerId: z.string().min(1).max(128), brandId: id });

export const suggestionCandidate = z.strictObject({
  text: promptQuestion.shape.text,
  type: questionType,
  stage: buyingStage,
  warnings: z.array(z.literal("similar")).max(1),
});

export const suggestionCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("generate"), promptSetId: id.nullable() }),
  z.strictObject({ action: z.literal("accept"), id }),
  z.strictObject({ action: z.literal("dismiss"), id }),
]);

export type DraftContent = z.infer<typeof draftContent>;
export type PromptQuestion = z.infer<typeof promptQuestion>;
export type PromptCluster = z.infer<typeof promptCluster>;
export type PromptCommand = z.infer<typeof promptCommand>;
export type PromptCursor = z.infer<typeof cursorSchema>;
export type PromptScope = z.infer<typeof promptScope>;
export type SuggestionCandidate = z.infer<typeof suggestionCandidate>;
export type SuggestionCommand = z.infer<typeof suggestionCommand>;
export type PromptSuggestion = {
  id: string;
  promptSetId: string | null;
  createdAt: string;
  candidate: SuggestionCandidate;
};
