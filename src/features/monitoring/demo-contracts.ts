import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const demoListLimit = 50;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

export const createDemoObservationSchema = z.strictObject({
  operationId: brandIdSchema,
  brandId: brandIdSchema,
  questionText: boundedText(4000),
  answerText: boundedText(8000),
});

export const demoErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  COPY_REJECTED: 409,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type DemoError = keyof typeof demoErrors;
export type CreateDemoObservationInput = z.infer<typeof createDemoObservationSchema>;

export type DemoObservationView = {
  id: string;
  brandId: string;
  questionText: string;
  answerText: string;
  is_demo: true;
  createdAt: string;
};

export type DemoObservationList = {
  is_demo: true;
  observations: DemoObservationView[];
};
