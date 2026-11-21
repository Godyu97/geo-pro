import { createHash } from "node:crypto";
import type {
  ExportMode,
  LabelingStatus,
  PackageKind,
  PreflightBlockerCode,
  VersionStatus,
} from "./contracts.ts";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export type ApprovalFingerprintInput = {
  title: string;
  bodyMarkdown: string;
  claims: Record<string, string>;
  imageAssetIds: string[];
  targetChannel: string;
  labelingProfileVersion: string;
  labelingProfileStatus: LabelingStatus;
  factVersionIds: string[];
};

function sortedRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Fingerprint of everything an approval vouches for; any change requires a new approval. */
export function computeApprovalFingerprint(input: ApprovalFingerprintInput) {
  return sha256(JSON.stringify({
    title: input.title,
    body: input.bodyMarkdown,
    claims: sortedRecord(input.claims),
    images: input.imageAssetIds,
    channel: input.targetChannel,
    labeling: [input.labelingProfileVersion, input.labelingProfileStatus],
    facts: [...input.factVersionIds].sort(),
  }));
}

// ---------------------------------------------------------------------------
// HTML: markdown subset rendering + allowlist sanitizer (no script execution).
// ---------------------------------------------------------------------------

const allowedTags = new Set([
  "a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
  "img", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const voidTags = new Set(["br", "hr", "img"]);
const allowedAttributes: Record<string, string[]> = { a: ["href", "title"], img: ["src", "alt", "title"] };
const urlAttributes = new Set(["href", "src"]);
const dangerousBlocks = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const dangerousUnterminated = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*$/gi;
const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const attributePattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeText(text: string) {
  return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function safeUrl(value: string) {
  // Strip control characters and whitespace that browsers ignore inside schemes.
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  return /^(https?:|mailto:|#|\/(?!\/))/i.test(compact) ? value.trim() : null;
}

function cleanTag(closing: string, name: string, attributes: string) {
  const tag = name.toLowerCase();
  if (!allowedTags.has(tag)) return "";
  if (closing) return voidTags.has(tag) ? "" : `</${tag}>`;
  const allowed = allowedAttributes[tag] ?? [];
  const kept: string[] = [];
  for (const match of attributes.matchAll(attributePattern)) {
    const attribute = match[1].toLowerCase();
    if (!allowed.includes(attribute)) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    const value = urlAttributes.has(attribute) ? safeUrl(raw) : raw;
    if (value === null) continue;
    kept.push(`${attribute}="${escapeAttribute(value)}"`);
  }
  return `<${tag}${kept.length ? ` ${kept.join(" ")}` : ""}>`;
}

/** Remove scripts, event handlers, styles, unsafe URLs and every non-allowlisted tag. */
export function sanitizeHtml(input: string) {
  const source = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(dangerousBlocks, "")
    .replace(dangerousUnterminated, "");
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(tagPattern)) {
    output += escapeText(source.slice(cursor, match.index));
    output += cleanTag(match[1], match[2], match[3]);
    cursor = match.index + match[0].length;
  }
  return output + escapeText(source.slice(cursor));
}

/** Markdown keeps its text verbatim; only embedded dangerous HTML (scripts, handlers) is removed. */
export function sanitizeMarkdown(markdown: string) {
  const source = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(dangerousBlocks, "")
    .replace(dangerousUnterminated, "");
  return source.replace(tagPattern, (_match, closing: string, name: string, attributes: string) =>
    cleanTag(closing, name, attributes));
}

function inline(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:])/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function tableRow(line: string, cell: "td" | "th") {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return `<tr>${cells.map((value) => `<${cell}>${inline(value.trim())}</${cell}>`).join("")}</tr>`;
}

/** Minimal markdown subset (headings, quotes, lists, tables, paragraphs); output is sanitized. */
export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      html.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index++].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
      }
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(lines[index++]);
      const body = rows.filter((row) => !/^\s*\|?\s*:?-{2,}/.test(row));
      const [head, ...rest] = body;
      html.push(`<table><thead>${tableRow(head, "th")}</thead><tbody>${rest.map((row) => tableRow(row, "td")).join("")}</tbody></table>`);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|>|\s*([-*]|\d+\.)\s|\|)/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    if (!paragraph.length) { paragraph.push(lines[index++]); }
    html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
  }
  return sanitizeHtml(html.join("\n"));
}

// ---------------------------------------------------------------------------
// Package assembly
// ---------------------------------------------------------------------------

const deliverableImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PackageStoredMedia = {
  id: string;
  class: string;
  visibility: "public" | "internal";
  status: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  fileName: string;
};

export type PackageAsset = {
  id: string;
  kind: string;
  source: string;
  rightsStatement: string;
  visibility: "public" | "internal";
  reviewStatus: "pending" | "approved" | "rejected";
  contentRef: string;
  fingerprint: string;
  /** True when the asset row points at a stored object, even if that object is ineligible. */
  linkedObject?: boolean;
  stored?: PackageStoredMedia | null;
};

export type PackageFact = {
  id: string;
  factId: string;
  version: number;
  claim: string;
  title: string;
  sourceType: "url" | "material" | "internal";
  sourceReference: string;
  sourceLocator: string;
  sourceExcerpt: string;
  sourceDate: string;
};

export type PackageInput = {
  kind: PackageKind;
  approvalId: string | null;
  contentFingerprint: string;
  version: {
    id: string;
    title: string;
    bodyMarkdown: string;
    targetChannel: string;
    labelingProfileVersion: string;
    labelingProfileStatus: LabelingStatus;
    factVersionIds: string[];
  };
  facts: PackageFact[];
  assets: PackageAsset[];
};

const reviewBanner = "NON-PUBLISHABLE REVIEW DRAFT — not for publication / 非发布用审阅稿";

function rightsAreValid(asset: PackageAsset) {
  return asset.rightsStatement.trim().length > 0 && asset.source.trim().length > 0 && asset.kind.trim().length > 0;
}

function storedMediaIsPublic(asset: PackageAsset) {
  const stored = asset.stored;
  if (!stored) return false;
  return stored.class === "authorized-media"
    && stored.visibility === "public"
    && stored.status === "ready"
    && deliverableImageTypes.has(stored.contentType)
    && stored.fileName.length > 0
    && stored.sha256.length === 64;
}

/** Public, approved, rights-valid assets. Linked objects must be ready authorized-media. */
export function publicAssets(assets: PackageAsset[]) {
  return assets.filter((asset) => {
    if (asset.visibility !== "public" || asset.reviewStatus !== "approved" || !rightsAreValid(asset)) return false;
    if (asset.linkedObject) return storedMediaIsPublic(asset);
    return true;
  });
}

export function buildPackageFiles(input: PackageInput) {
  const review = input.kind === "review";
  const images = publicAssets(input.assets);
  const excludedAssetCount = input.assets.length - images.length;

  const body = sanitizeMarkdown(input.version.bodyMarkdown);
  const markdown = review ? `> ${reviewBanner}\n\n${body}\n` : `${body}\n`;
  const html = markdownToHtml(review ? `> ${reviewBanner}\n\n${body}` : body);

  const sources = input.facts.map((fact) => ({
    factVersionId: fact.id,
    claim: fact.claim,
    title: fact.title,
    sourceType: fact.sourceType,
    // Internal references may name private attachments; only the excerpt is public.
    sourceReference: fact.sourceType === "internal" ? null : fact.sourceReference,
    sourceLocator: fact.sourceLocator,
    sourceExcerpt: fact.sourceExcerpt,
    sourceDate: fact.sourceDate,
  }));

  const checklist = [
    review ? `# Review checklist — ${reviewBanner}` : "# Publish checklist",
    "",
    review
      ? "- [ ] This package is a review draft only. Do NOT publish it."
      : "- [ ] Content matches the approved fingerprint in manifest.json.",
    `- [ ] Target channel: ${input.version.targetChannel}`,
    "- [ ] Every claim is traceable in public-sources.json.",
    ...(images.length ? ["- [ ] Images carry the rights statements in public-images.json."] : []),
    ...(review
      ? ["- [ ] Labeling profile is not verified; re-export a formal package after verification."]
      : ["- [ ] Apply the labeling required by the channel profile."]),
    "- [ ] Exporting this package is not publication; record the live URL separately.",
    "",
  ].join("\n");

  const files: Record<string, string> = {
    "content.md": markdown,
    "content.html": `${html}\n`,
    "public-sources.json": `${JSON.stringify({ sources }, null, 2)}\n`,
    "publish-checklist.md": checklist,
  };
  if (images.length) {
    files["public-images.json"] = `${JSON.stringify({
      images: images.map((image) => ({
        id: image.id,
        kind: image.kind,
        source: image.source,
        rightsStatement: image.rightsStatement,
        contentRef: image.contentRef,
        fingerprint: image.fingerprint,
        ...(image.stored ? {
          objectId: image.stored.id,
          fileName: image.stored.fileName,
          contentType: image.stored.contentType,
          byteSize: image.stored.byteSize,
          sha256: image.stored.sha256,
        } : {}),
      })),
    }, null, 2)}\n`;
  }

  const manifest = {
    packageKind: input.kind,
    nonPublishable: review,
    contentVersionId: input.version.id,
    approvalId: input.approvalId,
    contentFingerprint: input.contentFingerprint,
    factVersionIds: [...input.version.factVersionIds].sort(),
    targetChannel: input.version.targetChannel,
    labelingProfile: {
      version: input.version.labelingProfileVersion,
      status: input.version.labelingProfileStatus,
    },
    imageCount: images.length,
    excludedAssetCount,
    files: Object.entries(files).map(([name, content]) => ({ name, sha256: sha256(content) })),
  };
  files["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;

  const packageFingerprint = sha256(JSON.stringify(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)),
  ));
  return { files, packageFingerprint, manifest };
}

// ---------------------------------------------------------------------------
// Preflight / subset rules
// ---------------------------------------------------------------------------

export function resolveExportKind(mode: ExportMode, labelingStatus: LabelingStatus): PackageKind {
  if (mode === "review") return "review";
  if (mode === "formal") return "formal";
  return labelingStatus === "verified" ? "formal" : "review";
}

export type PreflightInput = {
  kind: PackageKind;
  status: VersionStatus;
  labelingStatus: LabelingStatus;
  currentFingerprint: string;
  /** Fingerprints of approvals with decision=approved for this version. */
  approvedFingerprints: string[];
  invalidFactVersionIds: string[];
};

export function preflightBlockers(input: PreflightInput): PreflightBlockerCode[] {
  const blockers: PreflightBlockerCode[] = [];
  if (input.kind === "formal") {
    if (input.status !== "approved" || !input.approvedFingerprints.includes(input.currentFingerprint)) {
      blockers.push("APPROVAL_REQUIRED");
    }
    if (input.labelingStatus !== "verified") blockers.push("LABELING_UNVERIFIED");
  }
  if (input.invalidFactVersionIds.length) blockers.push("FACT_INVALID");
  return blockers;
}

export type SubsetCheck = { ok: true } | { ok: false; invalid: string[] };

/** The chosen subset must be non-empty, selected, and preflight-passing. */
export function validateExportSubset(selected: string[], eligible: string[], chosen: string[]): SubsetCheck {
  if (chosen.length === 0) return { ok: false, invalid: [] };
  const selectedSet = new Set(selected);
  const eligibleSet = new Set(eligible);
  const invalid = chosen.filter((id) => !selectedSet.has(id) || !eligibleSet.has(id));
  return invalid.length || new Set(chosen).size !== chosen.length ? { ok: false, invalid } : { ok: true };
}
