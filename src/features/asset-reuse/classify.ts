import { contentTypeAllowed, sanitizeObjectFileName } from "../stored-objects/contracts.ts";
import {
  type SourceReason,
  type SourceStatus,
  type SourceFileInput,
} from "./contracts.ts";
import { importBatchReport, sourceImportLimits, type ImportPage } from "./rules.ts";

export type SourceDraft = SourceFileInput & { body: Uint8Array };

export type ClassifiedSourceFile = {
  fileName: string;
  byteSize: number;
  status: SourceStatus;
  reason: SourceReason | null;
  write: boolean;
  contentType?: string;
  body?: Uint8Array;
};

function declaredBytes(file: SourceDraft) {
  return Math.max(file.body.byteLength, file.byteSize ?? file.body.byteLength);
}

function failureReason(file: SourceDraft, byteSize: number): SourceReason {
  if (file.encrypted) return "encrypted";
  if (byteSize > sourceImportLimits.maxBytes || file.chars > sourceImportLimits.maxChars) return "oversized";
  return "unrecognized";
}

/** Kept files are the ones importBatchReport leaves ready or partial. Facts stay unapproved. */
export function classifySourceImport(files: readonly SourceDraft[]) {
  const report = importBatchReport(files.map((file) => ({
    name: file.name,
    bytes: declaredBytes(file),
    chars: file.chars,
    encrypted: file.encrypted,
    pages: file.pages,
  })));
  const classified: ClassifiedSourceFile[] = report.files.map((item, index) => {
    const file = files[index] as SourceDraft;
    const byteSize = declaredBytes(file);
    const fileName = sanitizeObjectFileName(file.name) ?? "unnamed";
    if ("reason" in item && item.reason === "batch_limit") {
      return { fileName, byteSize, status: "failed", reason: "batch_limit", write: false };
    }
    if (item.status === "unsupported") {
      return { fileName, byteSize, status: "failed", reason: failureReason(file, byteSize), write: false };
    }
    const safeName = sanitizeObjectFileName(file.name);
    const bodyMatches = file.body.byteLength === byteSize
      && file.body.byteLength >= 1
      && file.body.byteLength <= sourceImportLimits.maxBytes;
    if (!safeName || !contentTypeAllowed("source-original", file.contentType) || !bodyMatches) {
      return { fileName, byteSize, status: "failed", reason: "unrecognized", write: false };
    }
    return {
      fileName: safeName,
      byteSize,
      status: item.status,
      reason: null,
      write: true,
      contentType: file.contentType,
      body: file.body,
    };
  });
  return { files: classified, factsApproved: report.factsApproved };
}

export type { ImportPage };
