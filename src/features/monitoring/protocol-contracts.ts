import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const samplingProtocolListLimit = 50;
export const samplingProtocolFamilyLimit = 50;
export const samplingProtocolPinListLimit = 50;

export const samplingRegionSchema = z.string().regex(/^[A-Z]{2}$/);

export const samplingTimezoneSchema = z.string().trim().refine((value) => {
  if (value.length < 1 || value.length > 64 || !value.isWellFormed()) return false;
  if (!/^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

const protocolFields = {
  newSessionRequired: z.boolean(),
  searchRequired: z.boolean(),
  targetRegion: samplingRegionSchema,
  timezone: samplingTimezoneSchema,
};

export const createSamplingProtocolSchema = z.strictObject({
  operationId: brandIdSchema,
  brandId: brandIdSchema,
  ...protocolFields,
});

export const freezeSamplingProtocolSchema = z.strictObject({
  operationId: brandIdSchema,
  ...protocolFields,
});

export const pinSamplingProtocolSchema = z.strictObject({
  protocolId: brandIdSchema,
  version: z.number().int().positive().max(2_147_483_647),
});

export const samplingProtocolErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  NOT_FROZEN: 409,
  OPERATION_CONFLICT: 409,
  PIN_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type SamplingProtocolError = keyof typeof samplingProtocolErrors;
export type CreateSamplingProtocolInput = z.infer<typeof createSamplingProtocolSchema>;
export type FreezeSamplingProtocolInput = z.infer<typeof freezeSamplingProtocolSchema>;
export type PinSamplingProtocolInput = z.infer<typeof pinSamplingProtocolSchema>;
export type SamplingProtocolStatus = "draft" | "frozen";

export type SamplingProtocolView = {
  id: string;
  protocolId: string;
  brandId: string;
  version: number;
  status: SamplingProtocolStatus;
  newSessionRequired: boolean;
  searchRequired: boolean;
  targetRegion: string;
  timezone: string;
  createdAt: string;
};

export type SamplingProtocolPinView = {
  runId: string;
  protocolId: string;
  version: number;
  searchRequired: boolean;
};

export type SamplingProtocolList = {
  brands: { id: string }[];
  protocols: SamplingProtocolView[];
  pins: SamplingProtocolPinView[];
};
