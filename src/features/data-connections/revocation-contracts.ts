import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const syncAuthorizationListLimit = 50;
export const syncAttemptPageLimit = 20;
export const retainedRowLimit = 1_000_000_000;
export const syncAttemptResults = ["allowed", "stopped"] as const;

const secretWord = /password|token|secret|cookie|令牌|口令|密钥/i;

const sourceNameSchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 80
    && value.isWellFormed()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !secretWord.test(value)
    && !value.includes("://");
});

export const registerSyncAuthorizationSchema = z.strictObject({
  brandId: brandIdSchema,
  sourceName: sourceNameSchema,
  retainedRows: z.number().int().min(0).max(retainedRowLimit),
});

export const syncAuthorizationErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type SyncAuthorizationError = keyof typeof syncAuthorizationErrors;
export type RegisterSyncAuthorizationInput = z.infer<typeof registerSyncAuthorizationSchema>;
export type SyncAttemptResult = (typeof syncAttemptResults)[number];

export type SyncAttemptView = {
  id: string;
  result: SyncAttemptResult;
  attemptedAt: string;
};

export type SyncAuthorizationView = {
  id: string;
  brandId: string;
  sourceName: string;
  revoked: boolean;
  retainedRows: number;
  historyDeleted: false;
  pull: boolean;
  attempts: SyncAttemptView[];
  createdAt: string;
  updatedAt: string;
};

export type SyncAuthorizationList = {
  brands: { id: string }[];
  authorizations: SyncAuthorizationView[];
};
