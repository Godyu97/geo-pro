import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const explorationListLimit = 50;
export const explorationExclusionReason = "custom_pipeline" as const;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

export const createExplorationSchema = z.strictObject({
  operationId: brandIdSchema,
  brandId: brandIdSchema,
  questionText: boundedText(4000),
  answerText: boundedText(8000),
  exclusionReason: z.literal(explorationExclusionReason),
});

export const explorationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  NATURAL_COPY_REJECTED: 409,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ExplorationError = keyof typeof explorationErrors;
export type CreateExplorationInput = z.infer<typeof createExplorationSchema>;

export type ExplorationObservationView = {
  id: string;
  brandId: string;
  questionText: string;
  answerText: string;
  exclusionReason: typeof explorationExclusionReason;
  excludedFromNatural: true;
  createdAt: string;
};

export type ExplorationList = {
  observations: ExplorationObservationView[];
};
