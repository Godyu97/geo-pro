import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const dataConnectionListLimit = 50;
export const dataConnectionFieldLimit = 40;

const secretWord = /password|token|secret|cookie|令牌|口令|密钥/i;

const displayNameSchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 80
    && value.isWellFormed()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !secretWord.test(value)
    && !value.includes("://");
});

const fieldNameSchema = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine((value) => !secretWord.test(value));

export const registerDataConnectionSchema = z.strictObject({
  brandId: brandIdSchema,
  displayName: displayNameSchema,
  fieldNames: z.array(fieldNameSchema).min(1).max(dataConnectionFieldLimit),
}).refine((value) => new Set(value.fieldNames).size === value.fieldNames.length);

export const connectionStatuses = ["preview", "approved"] as const;

export const dataConnectionErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  PULL_BLOCKED: 409,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type DataConnectionError = keyof typeof dataConnectionErrors;
export type RegisterDataConnectionInput = z.infer<typeof registerDataConnectionSchema>;
export type DataConnectionStatus = (typeof connectionStatuses)[number];

export type DataConnectionPreview = {
  pull: boolean;
  fields: string[];
};

export type DataConnectionView = {
  id: string;
  brandId: string;
  displayName: string;
  status: DataConnectionStatus;
  fieldCount: number;
  fieldNames: string[];
  pullAttemptedAt: string | null;
  preview: DataConnectionPreview;
  createdAt: string;
  updatedAt: string;
};

export type DataConnectionList = {
  brands: { id: string }[];
  connections: DataConnectionView[];
};
