import { createHash } from "node:crypto";
import type {
  BatchStatus,
  BriefDraftFields,
  BriefStatus,
  ContentGapCode,
  PublicationStatus,
  TemplateKind,
  UnitStatus,
} from "./contracts.ts";

export type BriefGap = { code: ContentGapCode };

export function contentBriefGaps(fields: BriefDraftFields): BriefGap[] {
  const gaps: BriefGap[] = [];
  if (!fields.audience.trim()) gaps.push({ code: "audienceMissing" });
  if (!fields.targetGap.trim()) gaps.push({ code: "targetGapMissing" });
  if (!fields.applicableBoundary.trim()) gaps.push({ code: "boundaryMissing" });
  if (!fields.primaryPage.trim()) gaps.push({ code: "primaryPageMissing" });
  if (!fields.conversionAction.trim()) gaps.push({ code: "conversionActionMissing" });
  if (!fields.templateKind) gaps.push({ code: "templateMissing" });
  if (fields.titleCandidates.length === 0 || fields.titleCandidates.every((item) => !item.trim())) {
    gaps.push({ code: "titlesMissing" });
  }
  if (fields.factVersionIds.length === 0) gaps.push({ code: "sourceMissing" });
  if (fields.factVersionIds.length === 0) gaps.push({ code: "factsMissing" });
  if (fields.templateKind === "verifiable_comparison" && !fields.competitorSource?.trim()) {
    gaps.push({ code: "competitorSourceMissing" });
  }
  return gaps;
}

export type FactClaim = { id: string; claim: string };

export type TemplateFillInput = {
  templateKind: TemplateKind;
  titleCandidates: string[];
  audience: string;
  targetGap: string;
  applicableBoundary: string;
  primaryPage: string;
  conversionAction: string;
  competitorSource?: string | null;
  facts: FactClaim[];
};

export type TemplateFillResult = {
  title: string;
  bodyMarkdown: string;
  claims: Record<string, string>;
  fingerprint: string;
};

function pickTitle(candidates: string[]) {
  return candidates.find((item) => item.trim())?.trim() || "Untitled draft";
}

function claimsMap(facts: FactClaim[]) {
  return Object.fromEntries(facts.map((fact) => [fact.claim, fact.id]));
}

function structureFactFaq(input: TemplateFillInput) {
  const lines = [
    `# ${pickTitle(input.titleCandidates)}`,
    "",
    `> Audience: ${input.audience}`,
    `> Boundary: ${input.applicableBoundary}`,
    "",
    "## FAQ",
    "",
    ...input.facts.flatMap((fact, index) => [
      `### Q${index + 1}. ${input.targetGap}`,
      "",
      fact.claim,
      "",
      `_Bound fact: ${fact.id}_`,
      "",
    ]),
    "## Conversion",
    "",
    `- Primary page: ${input.primaryPage}`,
    `- Action: ${input.conversionAction}`,
  ];
  return lines.join("\n");
}

function structureScenario(input: TemplateFillInput) {
  const lines = [
    `# ${pickTitle(input.titleCandidates)}`,
    "",
    `## Scenario for ${input.audience}`,
    "",
    `Gap addressed: ${input.targetGap}`,
    "",
    `Applicable only when: ${input.applicableBoundary}`,
    "",
    "## Solution steps",
    "",
    ...input.facts.map((fact, index) => `${index + 1}. ${fact.claim} _(fact ${fact.id})_`),
    "",
    "## Next step",
    "",
    `Open ${input.primaryPage} and ${input.conversionAction}.`,
  ];
  return lines.join("\n");
}

function structureComparison(input: TemplateFillInput) {
  const lines = [
    `# ${pickTitle(input.titleCandidates)}`,
    "",
    `## Verifiable comparison (${input.audience})`,
    "",
    `| Dimension | Our claim | Competitor source |`,
    `| --- | --- | --- |`,
    ...input.facts.map((fact) =>
      `| ${input.targetGap} | ${fact.claim} | ${input.competitorSource ?? "n/a"} |`),
    "",
    `Boundary: ${input.applicableBoundary}`,
    "",
    `Continue at ${input.primaryPage}: ${input.conversionAction}.`,
  ];
  return lines.join("\n");
}

export function buildTemplateStructure(kind: TemplateKind, input: TemplateFillInput) {
  if (kind === "fact_faq") return structureFactFaq(input);
  if (kind === "scenario_solution") return structureScenario(input);
  return structureComparison(input);
}

export function fillDraftFromTemplate(input: TemplateFillInput): TemplateFillResult {
  const title = pickTitle(input.titleCandidates);
  const bodyMarkdown = buildTemplateStructure(input.templateKind, input);
  const claims = claimsMap(input.facts);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ title, bodyMarkdown, claims, kind: input.templateKind }), "utf8")
    .digest("hex");
  return { title, bodyMarkdown, claims, fingerprint };
}

export function deriveBatchStatus(units: Array<{ status: UnitStatus }>): BatchStatus {
  if (units.length === 0) return "completed";
  if (units.every((unit) => unit.status === "succeeded")) return "completed";
  if (units.every((unit) => unit.status === "cancelled" as UnitStatus)) return "cancelled";
  if (units.some((unit) => unit.status === "running" || unit.status === "queued")) return "running";
  if (units.some((unit) => unit.status === "blocked" || unit.status === "failed")
    && units.some((unit) => unit.status === "succeeded")) {
    return "partial";
  }
  if (units.every((unit) => unit.status === "blocked" || unit.status === "failed")) return "partial";
  return "partial";
}

export function canPause(status: BatchStatus) {
  return status === "queued" || status === "running";
}

export function canResume(status: BatchStatus) {
  return status === "paused";
}

export function canCancel(status: BatchStatus) {
  return status === "queued" || status === "running" || status === "paused" || status === "partial";
}

export function canRetryFailed(status: BatchStatus) {
  return status === "partial" || status === "completed" || status === "paused";
}

export function coverageFromCluster(parts: {
  questionCluster: string;
  existingPages: string[];
  pendingPages: string[];
  gapPages: string[];
}) {
  return {
    questionCluster: parts.questionCluster,
    existing: parts.existingPages,
    pendingUpdate: parts.pendingPages,
    gaps: parts.gapPages,
    preferUpdate: parts.existingPages[0] ?? null,
  };
}

export function normalizePlanPageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

export type PageEvidenceBasis =
  | {
    kind: "citation_ownership";
    ownership: "owned_domain" | "owned_account";
    citationId: string;
    observationId: string;
  }
  | {
    kind: "publication_verification";
    status: "verified_public" | "verified_manual";
    evidenceGrade: "public" | "manual" | null;
    publicationId: string;
    effectiveAt: string | null;
  };

export type ClusterBriefLink = {
  briefId: string;
  title: string;
  status: BriefStatus;
  gaps: BriefGap[];
};

export type ClusterExistingPage = {
  url: string;
  normalizedUrl: string;
  evidence: PageEvidenceBasis[];
  linkedBriefs: ClusterBriefLink[];
  publicationIds: string[];
};

export type ClusterPlannedPage = {
  url: string;
  normalizedUrl: string;
  kind: "planned" | "needs_verification";
  linkedBriefs: ClusterBriefLink[];
  publicationIds: string[];
};

export type ClusterBriefSummary = {
  briefId: string;
  title: string;
  status: BriefStatus;
  primaryPage: string;
  normalizedPrimaryPage: string;
  gaps: BriefGap[];
  targetsExisting: boolean;
};

export type ClusterPlanView = {
  planId: string;
  questionCluster: string;
  updatedAt: string;
  existingPages: ClusterExistingPage[];
  plannedPages: ClusterPlannedPage[];
  unverifiedPages: ClusterPlannedPage[];
  pendingUpdates: ClusterBriefSummary[];
  gaps: ClusterBriefSummary[];
  preferUpdate: string | null;
};

const materialGapCodes = new Set<ContentGapCode>([
  "primaryPageMissing",
  "sourceMissing",
  "factsMissing",
  "boundaryMissing",
  "competitorSourceMissing",
]);

function parseLegacyCoverageUrls(coverageJson: string): { existing: string[]; pending: string[] } {
  try {
    const parsed: unknown = JSON.parse(coverageJson);
    if (!parsed || typeof parsed !== "object") return { existing: [], pending: [] };
    const record = parsed as Record<string, unknown>;
    const clean = (value: unknown) => (
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.trim() !== "planned")
        : []
    );
    return { existing: clean(record.existing), pending: clean(record.pendingUpdate) };
  } catch {
    return { existing: [], pending: [] };
  }
}

/**
 * Derive per-cluster coverage from stored plans, current briefs, and brand-scoped page evidence.
 * Unverified URLs never enter existingPages; historical records without evidence become needs_verification.
 */
export function buildClusterPlanViews(input: {
  plans: ReadonlyArray<{ id: string; questionCluster: string; coverageJson: string; updatedAt: string }>;
  briefs: ReadonlyArray<{
    id: string;
    planId: string | null;
    status: BriefStatus;
    title: string;
    primaryPage: string;
    gaps: BriefGap[];
  }>;
  ownedCitations: ReadonlyArray<{
    id: string;
    observationId: string;
    rawUrl: string;
    normalizedUrl: string;
    ownership: "owned_domain" | "owned_account";
  }>;
  publications: ReadonlyArray<{
    id: string;
    briefId: string | null;
    planId: string | null;
    pageUrl: string;
    status: PublicationStatus;
    effectiveAt: string | null;
    evidenceGrade: "public" | "manual" | null;
    supersededBy: string | null;
  }>;
}): ClusterPlanView[] {
  const evidenceByUrl = new Map<string, PageEvidenceBasis[]>();
  const displayByUrl = new Map<string, string>();
  const verifiedBriefIds = new Set<string>();

  const addEvidence = (rawUrl: string, basis: PageEvidenceBasis) => {
    const norm = normalizePlanPageUrl(rawUrl);
    if (!norm) return;
    if (!displayByUrl.has(norm)) displayByUrl.set(norm, rawUrl.trim());
    const list = evidenceByUrl.get(norm) ?? [];
    if (basis.kind === "citation_ownership") {
      if (!list.some((item) => item.kind === "citation_ownership" && item.citationId === basis.citationId)) {
        list.push(basis);
      }
    } else if (!list.some((item) => item.kind === "publication_verification" && item.publicationId === basis.publicationId)) {
      list.push(basis);
    }
    evidenceByUrl.set(norm, list);
  };

  for (const citation of input.ownedCitations) {
    addEvidence(citation.normalizedUrl || citation.rawUrl, {
      kind: "citation_ownership",
      ownership: citation.ownership,
      citationId: citation.id,
      observationId: citation.observationId,
    });
  }

  for (const pub of input.publications) {
    if ((pub.status === "verified_public" || pub.status === "verified_manual") && pub.supersededBy === null) {
      if (pub.briefId) verifiedBriefIds.add(pub.briefId);
      addEvidence(pub.pageUrl, {
        kind: "publication_verification",
        status: pub.status,
        evidenceGrade: pub.evidenceGrade,
        publicationId: pub.id,
        effectiveAt: pub.effectiveAt,
      });
    }
  }

  const briefsByPlan = new Map<string, typeof input.briefs[number][]>();
  for (const brief of input.briefs) {
    if (!brief.planId) continue;
    const list = briefsByPlan.get(brief.planId) ?? [];
    list.push(brief);
    briefsByPlan.set(brief.planId, list);
  }

  const pubsByPlan = new Map<string, typeof input.publications[number][]>();
  for (const pub of input.publications) {
    if (!pub.planId || pub.status === "removed") continue;
    const list = pubsByPlan.get(pub.planId) ?? [];
    list.push(pub);
    pubsByPlan.set(pub.planId, list);
  }

  return input.plans.map((plan) => {
    const clusterBriefs = briefsByPlan.get(plan.id) ?? [];
    const clusterPubs = pubsByPlan.get(plan.id) ?? [];
    const legacy = parseLegacyCoverageUrls(plan.coverageJson);

    type Candidate = {
      url: string;
      normalizedUrl: string;
      fromBrief: boolean;
      fromPendingPub: boolean;
      fromLegacyExisting: boolean;
      fromLegacyPending: boolean;
      linkedBriefs: ClusterBriefLink[];
      publicationIds: string[];
    };
    const candidates = new Map<string, Candidate>();
    const ensureCandidate = (rawUrl: string): Candidate | null => {
      const normalizedUrl = normalizePlanPageUrl(rawUrl);
      if (!normalizedUrl) return null;
      let entry = candidates.get(normalizedUrl);
      if (!entry) {
        entry = {
          url: displayByUrl.get(normalizedUrl) ?? rawUrl.trim(),
          normalizedUrl,
          fromBrief: false,
          fromPendingPub: false,
          fromLegacyExisting: false,
          fromLegacyPending: false,
          linkedBriefs: [],
          publicationIds: [],
        };
        candidates.set(normalizedUrl, entry);
      }
      return entry;
    };

    for (const brief of clusterBriefs) {
      const entry = ensureCandidate(brief.primaryPage);
      if (!entry) continue;
      entry.fromBrief = true;
      if (!entry.linkedBriefs.some((item) => item.briefId === brief.id)) {
        entry.linkedBriefs.push({
          briefId: brief.id,
          title: brief.title,
          status: brief.status,
          gaps: brief.gaps,
        });
      }
    }

    for (const pub of clusterPubs) {
      const entry = ensureCandidate(pub.pageUrl);
      if (!entry) continue;
      if (pub.status !== "verified_public" && pub.status !== "verified_manual") {
        entry.fromPendingPub = true;
      }
      if (!entry.publicationIds.includes(pub.id)) entry.publicationIds.push(pub.id);
    }

    for (const raw of legacy.existing) {
      const entry = ensureCandidate(raw);
      if (entry) entry.fromLegacyExisting = true;
    }
    for (const raw of legacy.pending) {
      const entry = ensureCandidate(raw);
      if (entry) entry.fromLegacyPending = true;
    }

    const existingPages: ClusterExistingPage[] = [];
    const plannedPages: ClusterPlannedPage[] = [];
    const unverifiedPages: ClusterPlannedPage[] = [];
    const existingSet = new Set<string>();

    for (const entry of candidates.values()) {
      const evidence = evidenceByUrl.get(entry.normalizedUrl) ?? [];
      if (evidence.length > 0) {
        existingSet.add(entry.normalizedUrl);
        existingPages.push({
          url: entry.url,
          normalizedUrl: entry.normalizedUrl,
          evidence,
          linkedBriefs: entry.linkedBriefs,
          publicationIds: entry.publicationIds,
        });
      } else if (entry.fromLegacyExisting) {
        unverifiedPages.push({
          url: entry.url,
          normalizedUrl: entry.normalizedUrl,
          kind: "needs_verification",
          linkedBriefs: entry.linkedBriefs,
          publicationIds: entry.publicationIds,
        });
      } else if (entry.fromBrief || entry.fromPendingPub || entry.fromLegacyPending) {
        plannedPages.push({
          url: entry.url,
          normalizedUrl: entry.normalizedUrl,
          kind: "planned",
          linkedBriefs: entry.linkedBriefs,
          publicationIds: entry.publicationIds,
        });
      }
    }

    const pendingUpdates: ClusterBriefSummary[] = [];
    const gaps: ClusterBriefSummary[] = [];

    for (const brief of clusterBriefs) {
      const normalizedPrimaryPage = normalizePlanPageUrl(brief.primaryPage);
      const targetsExisting = Boolean(normalizedPrimaryPage && existingSet.has(normalizedPrimaryPage));
      const hasMaterialGap = !normalizedPrimaryPage || brief.gaps.some((gap) => materialGapCodes.has(gap.code));
      const summary: ClusterBriefSummary = {
        briefId: brief.id,
        title: brief.title,
        status: brief.status,
        primaryPage: brief.primaryPage.trim(),
        normalizedPrimaryPage,
        gaps: brief.gaps,
        targetsExisting,
      };
      if (hasMaterialGap || brief.status === "invalidated") {
        gaps.push(summary);
      } else if (!(brief.status === "confirmed" && verifiedBriefIds.has(brief.id))) {
        pendingUpdates.push(summary);
      }
    }

    return {
      planId: plan.id,
      questionCluster: plan.questionCluster,
      updatedAt: plan.updatedAt,
      existingPages,
      plannedPages,
      unverifiedPages,
      pendingUpdates,
      gaps,
      preferUpdate: existingPages[0]?.url ?? null,
    };
  });
}
