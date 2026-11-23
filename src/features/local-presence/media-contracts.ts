import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const mediaReviewListLimit = 50;
export const approvedFactListLimit = 50;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
  });
}

export const mediaValueSchema = boundedText(4000);
export const mediaKindSchema = z.enum(["image", "script"]);
export const mediaReasonSchema = z.enum(["ok", "fact_mismatch", "not_proof"]);

export const recordMediaReviewSchema = z.strictObject({
  brandId: brandIdSchema,
  kind: mediaKindSchema,
  shownValue: mediaValueSchema,
  factVersionId: brandIdSchema,
  presentedAsCustomerProof: z.boolean(),
});

export const mediaReviewErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type MediaReviewError = keyof typeof mediaReviewErrors;
export type RecordMediaReviewInput = z.infer<typeof recordMediaReviewSchema>;
export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaReason = z.infer<typeof mediaReasonSchema>;

/** The comparable approved text. JSON facts use `claim`; a plain fixture uses the stored text. */
export function approvedFactValue(content: string): string | null {
  const direct = mediaValueSchema.safeParse(content);
  if (direct.success && !content.trimStart().startsWith("{")) return direct.data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return direct.success ? direct.data : null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("claim" in parsed)) return null;
  const claim = mediaValueSchema.safeParse(parsed.claim);
  return claim.success ? claim.data : null;
}

export type ApprovedFactOption = {
  id: string;
  brandId: string;
  version: number;
  approvedValue: string;
};

export type MediaReviewView = {
  id: string;
  brandId: string;
  kind: MediaKind;
  shownValue: string;
  approvedValue: string;
  factVersionId: string;
  reason: MediaReason;
  deliver: boolean;
  recordedAt: string;
};

export type MediaReviewList = {
  brands: { id: string }[];
  facts: ApprovedFactOption[];
  reviews: MediaReviewView[];
};
