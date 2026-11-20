import { createHash } from "node:crypto";
import type {
  BatchStatus,
  BriefDraftFields,
  ContentGapCode,
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
