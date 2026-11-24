export type ImportPage = { page: number | null; text: string | null };

export const sourceImportLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxChars: 50_000,
  maxFiles: 10,
} as const;

const { maxBytes, maxChars, maxFiles } = sourceImportLimits;

export function importBatch(files: readonly { name: string; bytes: number; chars: number; encrypted: boolean; pages: readonly ImportPage[] }[]) {
  return files.slice(0, maxFiles).map((file) => {
    if (file.encrypted || file.bytes > maxBytes || file.chars > maxChars) {
      return { name: file.name, status: "unsupported" as const, pages: [] as ImportPage[] };
    }
    const pages = file.pages.map((page) => ({
      page: page.page,
      text: page.text && page.text.length > 0 ? page.text : null,
    }));
    const missing = pages.some((page) => page.text === null || page.page === null);
    return { name: file.name, status: missing ? "partial" as const : "ready" as const, pages };
  });
}

export function revokedAssetReferences(input: { assetId: string; references: readonly { contentId: string; assetVersion: number }[] }) {
  return {
    assetId: input.assetId,
    status: "revoked" as const,
    references: [...input.references],
    deletedHistory: false,
  };
}

export function templateAllowsInvention(input: { asksToInventCaseStudy: boolean }) {
  return { allowed: false, reason: input.asksToInventCaseStudy ? "fact_gate" as const : "approval_gate" as const };
}

type ImportFile = { name: string; bytes: number; chars: number; encrypted: boolean; pages: readonly ImportPage[] };

/** Files past the batch cap are reported instead of dropped. Extracted text is not an approved fact. */
export function importBatchReport(files: readonly ImportFile[]) {
  const kept = importBatch(files.slice(0, maxFiles));
  const overflow = files.slice(maxFiles).map((file) => ({
    name: file.name,
    status: "failed" as const,
    reason: "batch_limit" as const,
    pages: [] as ImportPage[],
  }));
  return { files: [...kept, ...overflow], factsApproved: false as const };
}

export type TemplateGates = { fact: boolean; publicLicense: boolean; review: boolean };

/** System templates stay read-only. A clone cannot turn off fact, license, or review gates. */
export function cloneTemplate(input: { system: boolean; gates: TemplateGates }) {
  if (!input.gates.fact || !input.gates.publicLicense || !input.gates.review) {
    return { cloned: false as const, reason: "gate_required" as const };
  }
  return {
    cloned: true as const,
    readOnlySource: input.system,
    gates: { fact: true, publicLicense: true, review: true } as const,
  };
}

export function revokeAsset(input: { assetId: string; references: readonly { contentId: string; assetVersion: number }[] }) {
  const revoked = revokedAssetReferences(input);
  return {
    ...revoked,
    todos: revoked.references.map((reference) => ({
      contentId: reference.contentId,
      assetVersion: reference.assetVersion,
    })),
  };
}

export function candidateFact(input: { text: string | null; page: number | null; approvedValues: readonly string[] }) {
  if (input.text === null || input.page === null) {
    return { approved: false as const, page: input.page, conflicts: [] as string[], inventedPage: false as const };
  }
  return {
    approved: false as const,
    page: input.page,
    conflicts: input.approvedValues.filter((value) => value !== input.text),
    inventedPage: false as const,
  };
}

/** Form-feed splits explicit text pages. Without one, the page number stays missing. */
export function pagesFromText(text: string): ImportPage[] {
  const readable = (value: string) => value.trim().length > 0 ? value : null;
  if ([...text].length === 0) return [{ page: null, text: null }];
  if (!text.includes("\f")) return [{ page: null, text: readable(text) }];
  return text.split("\f").map((part, index) => ({ page: index + 1, text: readable(part) }));
}

export type ApprovedFactRef = { id: string; version: number; claim: string };

/** Compare each extracted page with approved claims. Missing text or page is not a conflict. */
export function fragmentCandidates(pages: readonly ImportPage[], approved: readonly ApprovedFactRef[]) {
  const approvedValues = approved.map((fact) => fact.claim);
  return pages.map((page, ordinal) => {
    const judged = candidateFact({ text: page.text, page: page.page, approvedValues });
    const conflictValues = new Set(judged.conflicts);
    return {
      ordinal,
      page: judged.page,
      text: page.text,
      approved: judged.approved,
      conflicts: approved.filter((fact) => conflictValues.has(fact.claim)).map((fact) => ({
        factVersionId: fact.id,
        version: fact.version,
      })),
    };
  });
}
