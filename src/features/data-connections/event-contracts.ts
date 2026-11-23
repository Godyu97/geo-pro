import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import type { SyncSource } from "./sync.ts";

export const connectorEventListLimit = 50;
export const connectorEventSources = ["csv", "connector"] as const satisfies readonly SyncSource[];
export const connectorEventKeySchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
export const payloadDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const connectorEventRowSchema = z.strictObject({
  eventKey: connectorEventKeySchema,
  source: z.enum(connectorEventSources),
  payloadDigest: payloadDigestSchema,
});

export const importConnectorEventsSchema = z.strictObject({
  brandId: brandIdSchema,
  rows: z.array(connectorEventRowSchema).min(1).max(40),
});

export const connectorEventErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ConnectorEventError = keyof typeof connectorEventErrors;
export type ImportConnectorEventsInput = z.infer<typeof importConnectorEventsSchema>;
export type ConnectorEventSourceName = (typeof connectorEventSources)[number];

export type ConnectorEventSourceView = {
  source: ConnectorEventSourceName;
  payloadDigest: string;
};

export type ConnectorEventView = {
  id: string;
  brandId: string;
  eventKey: string;
  count: 1;
  conflict: boolean;
  sources: ConnectorEventSourceView[];
  createdAt: string;
  updatedAt: string;
};

export type ConnectorEventList = {
  brands: { id: string }[];
  events: ConnectorEventView[];
};

/** Fixture lines are `eventKey,csv|connector,digest`. Customer text is not accepted. */
export function parseConnectorEventLines(text: string): { rows: ImportConnectorEventsInput["rows"] } | { error: "INVALID_INPUT" } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || lines.length > 40) return { error: "INVALID_INPUT" };
  const rows: ImportConnectorEventsInput["rows"] = [];
  for (const line of lines) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 3) return { error: "INVALID_INPUT" };
    const [eventKey, source, payloadDigest] = parts;
    const parsed = connectorEventRowSchema.safeParse({ eventKey, source, payloadDigest });
    if (!parsed.success) return { error: "INVALID_INPUT" };
    rows.push(parsed.data);
  }
  return { rows };
}
