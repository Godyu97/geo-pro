import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import type { LeadEvidence } from "./rules.ts";

export const leadEvidenceValues = ["referral", "self_report", "landing_page", "unknown"] as const satisfies readonly LeadEvidence[];
export const leadEvidenceSchema = z.enum(leadEvidenceValues);
export const leadRejectReasons = ["direct_pii", "missing_id"] as const;

const opaqueEventId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const importBusinessLeadsSchema = z.strictObject({
  brandId: brandIdSchema,
  rows: z.array(z.strictObject({
    eventId: z.string().max(200).nullable(),
    evidence: leadEvidenceSchema,
    directIdentifier: z.boolean(),
  })).max(100),
});

export const businessLeadErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type BusinessLeadError = keyof typeof businessLeadErrors;
export type ImportBusinessLeadsInput = z.infer<typeof importBusinessLeadsSchema>;
export type LeadImportRow = ImportBusinessLeadsInput["rows"][number];

/** A token that is not an opaque event id is treated as a direct identifier and is not stored. */
export function prepareLeadRow(row: LeadImportRow): LeadImportRow {
  if (row.directIdentifier || row.eventId === null) return row;
  const eventId = row.eventId.trim();
  if (eventId.length === 0) return { ...row, eventId };
  if (!opaqueEventId.test(eventId) || /^\d{8,}$/.test(eventId)) {
    return { ...row, eventId, directIdentifier: true };
  }
  return { ...row, eventId };
}

export function parseLeadLines(text: string): { rows: LeadImportRow[] } | { error: "INVALID_INPUT" } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || lines.length > 100) return { error: "INVALID_INPUT" };
  const rows: LeadImportRow[] = [];
  for (const line of lines) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 3) return { error: "INVALID_INPUT" };
    const [eventId, evidence, direct] = parts;
    const parsedEvidence = leadEvidenceSchema.safeParse(evidence);
    if (!parsedEvidence.success || (direct !== "true" && direct !== "false")) return { error: "INVALID_INPUT" };
    rows.push({
      eventId: eventId.length === 0 ? null : eventId,
      evidence: parsedEvidence.data,
      directIdentifier: direct === "true",
    });
  }
  return { rows };
}
