export type ImportPage = { page: number | null; text: string | null };

const maxBytes = 10 * 1024 * 1024;
const maxChars = 50_000;
const maxFiles = 10;

export function importBatch(files: readonly { name: string; bytes: number; chars: number; encrypted: boolean; pages: readonly ImportPage[] }[]) {
  return files.slice(0, maxFiles).map((file) => {
    if (file.encrypted || file.bytes > maxBytes || file.chars > maxChars) {
      return { name: file.name, status: "unsupported" as const, pages: [] as ImportPage[] };
    }
    const pages = file.pages.map((page) => (
      page.text && page.page !== null ? page : { page: page.page, text: null }
    ));
    const missing = pages.some((page) => page.text === null);
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
