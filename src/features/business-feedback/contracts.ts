import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { leadPrimaryUpgrades, previewLeadImport, type LeadEvidence } from "./rules.ts";

export const leadEvidenceValues = ["referral", "self_report", "landing_page", "unknown"] as const satisfies readonly LeadEvidence[];
export const leadEvidenceSchema = z.enum(leadEvidenceValues);
export const leadRejectReasons = ["direct_pii", "missing_id", "invalid_row"] as const;

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

const headerEvent = new Set(["event_id", "eventid", "event"]);
const headerEvidence = new Set(["evidence", "source", "category"]);
const headerDirect = new Set(["direct_identifier", "directidentifier", "pii", "direct"]);
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const embeddedMobilePattern = /(?:\+?86[\s-]?)?1[3-9]\d{9}/;

export type LeadCsvRejection = { index: number; reason: (typeof leadRejectReasons)[number] };
export type LeadPrimaryUpgrade = { eventId: string; from: LeadEvidence; to: LeadEvidence };
export type LeadCsvPreview = {
  totalRows: number;
  mergedCount: number;
  upgrades: LeadPrimaryUpgrade[];
  rejected: LeadCsvRejection[];
  rows: LeadImportRow[];
};

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** A direct identifier is rejected before storage. Evidence tokens and booleans are not identifiers. */
export function cellHasDirectIdentifier(value: string) {
  const text = value.trim();
  if (text.length === 0 || text === "true" || text === "false") return false;
  if (leadEvidenceValues.some((evidence) => evidence === text)) return false;
  if (emailPattern.test(text)) return true;
  const digits = text.replace(/\D/g, "");
  if (/^\+?\d[\d\s().-]{6,}\d$/.test(text) && digits.length >= 8) return true;
  return embeddedMobilePattern.test(text);
}

function parseCsvRecords(text: string): string[][] | null {
  const source = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      field += char ?? "";
      continue;
    }
    if (char === "\"" && field.length === 0) {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
      continue;
    }
    field += char ?? "";
  }
  if (quoted) return null;
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) records.push(row);
  }
  return records;
}

function classifyHeader(record: readonly string[]) {
  const keys = record.map(headerKey);
  const event = keys.findIndex((key) => headerEvent.has(key));
  const evidence = keys.findIndex((key) => headerEvidence.has(key));
  const direct = keys.findIndex((key) => headerDirect.has(key));
  if (event < 0 && evidence < 0 && direct < 0) return { kind: "plain" as const };
  if (event < 0 || evidence < 0) return { kind: "invalid" as const };
  return { kind: "header" as const, event, evidence, direct: direct < 0 ? null : direct };
}

function scrubLeadRow(row: LeadImportRow, cells: readonly string[]): LeadImportRow {
  const eventIsIdentifier = row.eventId !== null && cellHasDirectIdentifier(row.eventId);
  return {
    eventId: eventIsIdentifier ? null : row.eventId,
    evidence: row.evidence,
    directIdentifier: row.directIdentifier || cells.some(cellHasDirectIdentifier),
  };
}

function mapHeaderRecord(
  record: readonly string[],
  header: { event: number; evidence: number; direct: number | null },
): { row: LeadImportRow } | { error: "invalid_row" } {
  const evidence = leadEvidenceSchema.safeParse(record[header.evidence] ?? "");
  if (!evidence.success) return { error: "invalid_row" };
  const directCell = header.direct === null ? "" : (record[header.direct] ?? "");
  if (directCell !== "" && directCell !== "true" && directCell !== "false" && !cellHasDirectIdentifier(directCell)) {
    return { error: "invalid_row" };
  }
  const eventCell = record[header.event] ?? "";
  return {
    row: scrubLeadRow({
      eventId: eventCell.length === 0 ? null : eventCell,
      evidence: evidence.data,
      directIdentifier: directCell === "true",
    }, record),
  };
}

/** Dry-run a headerless 3-column batch or a headered CSV. Nothing here is written. */
export function previewLeadCsv(text: string): LeadCsvPreview | { error: "INVALID_INPUT" } {
  const table = parseCsvRecords(text);
  if (!table || table.length === 0) return { error: "INVALID_INPUT" };
  const header = classifyHeader(table[0] ?? []);
  if (header.kind === "invalid") return { error: "INVALID_INPUT" };
  const data = header.kind === "header" ? table.slice(1) : table;
  if (data.length === 0 || data.length > 100) return { error: "INVALID_INPUT" };

  const staged: { index: number; row: LeadImportRow }[] = [];
  const invalid: LeadCsvRejection[] = [];
  if (header.kind === "plain") {
    for (const record of data) {
      if (record.length !== 3) return { error: "INVALID_INPUT" };
      const evidence = leadEvidenceSchema.safeParse(record[1]);
      if (!evidence.success || (record[2] !== "true" && record[2] !== "false")) return { error: "INVALID_INPUT" };
    }
  }
  data.forEach((record, index) => {
    if (header.kind === "plain") {
      const evidence = leadEvidenceSchema.safeParse(record[1]);
      if (!evidence.success || !record[2]) return;
      staged.push({
        index,
        row: scrubLeadRow(prepareLeadRow({
          eventId: record[0]?.length ? record[0] : null,
          evidence: evidence.data,
          directIdentifier: record[2] === "true",
        }), record),
      });
      return;
    }
    const mapped = mapHeaderRecord(record, header);
    if ("error" in mapped) {
      invalid.push({ index, reason: "invalid_row" });
      return;
    }
    staged.push({ index, row: prepareLeadRow(mapped.row) });
  });

  const preview = previewLeadImport(staged.map((item) => item.row));
  const rejected = [
    ...invalid,
    ...preview.rejected.map((item) => ({
      index: staged[item.index]?.index ?? item.index,
      reason: item.reason,
    })),
  ].sort((left, right) => left.index - right.index);
  return {
    totalRows: data.length,
    mergedCount: preview.leads.length,
    upgrades: leadPrimaryUpgrades(preview.leads),
    rejected,
    rows: staged.map((item) => item.row),
  };
}
