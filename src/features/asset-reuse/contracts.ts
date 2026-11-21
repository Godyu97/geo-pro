import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const SOURCE_STATUSES = ["ready", "partial", "failed"] as const;
export const SOURCE_REASONS = ["encrypted", "oversized", "unrecognized", "batch_limit", "unavailable"] as const;
export const SOURCE_RIGHTS = ["active", "revoked", "expired"] as const;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type SourceReason = (typeof SOURCE_REASONS)[number];
export type SourceRights = (typeof SOURCE_RIGHTS)[number];

export const sourceErrors = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
} as const;

export type SourceError = keyof typeof sourceErrors;

const pageSchema = z.strictObject({
  page: z.number().int().positive().max(100_000).nullable(),
  text: z.string().max(50_000).nullable(),
});

export const sourceFileSchema = z.strictObject({
  name: z.string().min(1).max(400),
  contentType: z.string().min(1).max(255),
  chars: z.number().int().min(0).max(10_000_000),
  encrypted: z.boolean(),
  byteSize: z.number().int().min(0).max(2_147_483_647).optional(),
  pages: z.array(pageSchema).max(200),
});

export const importSourceOriginalsSchema = z.strictObject({
  brandId: brandIdSchema,
  files: z.array(sourceFileSchema).min(1).max(20),
});

export const setSourceRightsSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
  rights: z.enum(["revoked", "expired"]),
});

export const readSourceOriginalSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
});

export type SourceFileInput = z.infer<typeof sourceFileSchema>;
export type ImportSourceOriginalsInput = z.infer<typeof importSourceOriginalsSchema>;
export type SetSourceRightsInput = z.infer<typeof setSourceRightsSchema>;
export type ReadSourceOriginalInput = z.infer<typeof readSourceOriginalSchema>;
