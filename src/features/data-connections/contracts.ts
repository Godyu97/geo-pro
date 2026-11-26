import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { leadEvidenceSchema } from "../business-feedback/contracts.ts";
import { connectorEventKeySchema, payloadDigestSchema } from "./event-contracts.ts";

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

export const syncCursorSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/).refine((value) => !secretWord.test(value) && !value.includes("://"));

const syncEventSchema = z.strictObject({
  eventKey: connectorEventKeySchema,
  payloadDigest: payloadDigestSchema,
  evidence: leadEvidenceSchema,
});

export const syncDataConnectionSchema = z.strictObject({
  expectedCursor: syncCursorSchema.nullable().optional(),
  cursor: syncCursorSchema,
  coverageComplete: z.boolean(),
  events: z.array(syncEventSchema).max(40),
});

export const dataConnectionErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  PULL_BLOCKED: 409,
  SYNC_BLOCKED: 409,
  SYNC_STOPPED: 409,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type DataConnectionError = keyof typeof dataConnectionErrors;
export type RegisterDataConnectionInput = z.infer<typeof registerDataConnectionSchema>;
export type SyncDataConnectionInput = z.infer<typeof syncDataConnectionSchema>;
export type DataConnectionStatus = (typeof connectionStatuses)[number];
export type DataConnectionSourceName = "csv" | "connector";

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
  syncCursor: string | null;
  coverageComplete: boolean | null;
  syncStopped: boolean;
  missingHistoricalReceipts: boolean;
  sources: { source: DataConnectionSourceName }[];
  preview: DataConnectionPreview;
  createdAt: string;
  updatedAt: string;
};

export type DataConnectionList = {
  brands: { id: string }[];
  connections: DataConnectionView[];
};

/** Fixture lines are `eventKey,digest,evidence`. Customer text and direct identifiers are not accepted. */
export function parseSyncEventLines(text: string): { events: SyncDataConnectionInput["events"] } | { error: "INVALID_INPUT" } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length > 40) return { error: "INVALID_INPUT" };
  const events: SyncDataConnectionInput["events"] = [];
  for (const line of lines) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 3) return { error: "INVALID_INPUT" };
    const [eventKey, payloadDigest, evidence] = parts;
    const parsed = syncEventSchema.safeParse({ eventKey, payloadDigest, evidence });
    if (!parsed.success) return { error: "INVALID_INPUT" };
    events.push(parsed.data);
  }
  return { events };
}
