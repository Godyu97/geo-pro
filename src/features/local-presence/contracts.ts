import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const localObservationListLimit = 50;
export const unknownSampledPlace = "unknown" as const;

function cityName(value: string) {
  const length = [...value].length;
  return length >= 1 && length <= 80 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
}

export const citySchema = z.string().trim().refine(cityName);

export const registerLocalObservationSchema = z.strictObject({
  brandId: brandIdSchema,
  targetCity: citySchema,
  sampledCity: citySchema.nullable().optional(),
});

export const localObservationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type LocalObservationError = keyof typeof localObservationErrors;
export type RegisterLocalObservationInput = z.infer<typeof registerLocalObservationSchema>;

export type LocalObservationView = {
  id: string;
  brandId: string;
  targetCity: string;
  sampledCity: string | null;
  actualStatus: typeof unknownSampledPlace | "sampled";
  ranked: false;
  claimedLocalUsers: false;
  recordedAt: string;
};

export type LocalObservationList = {
  brands: { id: string }[];
  observations: LocalObservationView[];
};
