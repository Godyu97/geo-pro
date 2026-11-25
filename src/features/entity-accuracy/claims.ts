export const claimJudgments = ["consistent", "conflict", "insufficient", "not_applicable"] as const;
export type ClaimJudgment = (typeof claimJudgments)[number];
export type ClaimFactStatus = "approved" | "expired" | "revoked";
export type ReviewFactState = "active" | "expired" | "conflict";

export type ComparableFact = {
  id: string;
  category: string;
  title: string;
  claim: string;
  status: ClaimFactStatus;
};

export type AnswerClaimComparison = {
  claim: string;
  judgment: ClaimJudgment;
  factId: string | null;
  factTitle: string | null;
  factStatus: ClaimFactStatus | null;
  reviewFact: ReviewFactState;
  confirmable: boolean;
};

export type BrandFactClaimView = AnswerClaimComparison & {
  observationId: string;
  analysisVersionId: string | null;
  questionText: string;
  answerExcerpt: string;
};

const excerptLimit = 500;

export function excerptText(value: string, limit = excerptLimit) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const chars = Array.from(trimmed);
  if (chars.length <= limit) return trimmed;
  return `${chars.slice(0, limit).join("")}…`;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function numbers(value: string) {
  return [...normalize(value).matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

type Relation = "equal" | "contradicts" | "missing" | "wording" | "none";

function relate(answer: string, fact: ComparableFact): Relation {
  const normalizedAnswer = normalize(answer);
  const normalizedClaim = normalize(fact.claim);
  const normalizedTitle = normalize(fact.title);
  if (!normalizedAnswer || !normalizedClaim) return "none";
  if (normalizedAnswer.includes(normalizedClaim)) return "equal";
  const titleHit = normalizedTitle.length >= 2 && normalizedAnswer.includes(normalizedTitle);
  if (!titleHit) return "none";
  const claimNumbers = numbers(fact.claim);
  const answerNumbers = numbers(answer);
  if (claimNumbers.length > 0 && answerNumbers.length === 0) return "missing";
  const numberConflict = claimNumbers.length > 0
    && answerNumbers.some((item) => !claimNumbers.includes(item))
    && claimNumbers.some((item) => !answerNumbers.includes(item));
  if (numberConflict) return "contradicts";
  return "wording";
}

function comparison(input: AnswerClaimComparison): AnswerClaimComparison {
  return input;
}

/** Structured comparison. Wording-only differences and expired facts are never confirmable errors. */
export function compareAnswerToFacts(answer: string, facts: readonly ComparableFact[]): AnswerClaimComparison {
  const hits = facts
    .map((fact) => ({ fact, relation: relate(answer, fact) }))
    .filter((hit) => hit.relation !== "none");
  const approved = hits.filter((hit) => hit.fact.status === "approved");
  const relatedApproved = approved.filter((hit) => hit.relation === "equal" || hit.relation === "contradicts");
  const byCategory = new Map<string, Set<string>>();
  for (const hit of relatedApproved) {
    const claims = byCategory.get(hit.fact.category) ?? new Set<string>();
    claims.add(normalize(hit.fact.claim));
    byCategory.set(hit.fact.category, claims);
  }
  const excerpt = excerptText(answer);
  if ([...byCategory.values()].some((claims) => claims.size > 1)) {
    return comparison({
      claim: excerpt,
      judgment: "insufficient",
      factId: null,
      factTitle: null,
      factStatus: null,
      reviewFact: "conflict",
      confirmable: false,
    });
  }
  const contradictions = approved.filter((hit) => hit.relation === "contradicts");
  const equals = approved.filter((hit) => hit.relation === "equal");
  if (contradictions.length === 1 && equals.length === 0) {
    const fact = contradictions[0].fact;
    return comparison({
      claim: excerpt,
      judgment: "conflict",
      factId: fact.id,
      factTitle: fact.title,
      factStatus: "approved",
      reviewFact: "active",
      confirmable: true,
    });
  }
  if (contradictions.length > 1) {
    return comparison({
      claim: excerpt,
      judgment: "insufficient",
      factId: null,
      factTitle: null,
      factStatus: null,
      reviewFact: "conflict",
      confirmable: false,
    });
  }
  if (equals.length >= 1) {
    const fact = equals[0].fact;
    return comparison({
      claim: excerptText(fact.claim),
      judgment: "consistent",
      factId: fact.id,
      factTitle: fact.title,
      factStatus: "approved",
      reviewFact: "active",
      confirmable: false,
    });
  }
  const missing = approved.find((hit) => hit.relation === "missing");
  if (missing) {
    return comparison({
      claim: excerpt,
      judgment: "insufficient",
      factId: missing.fact.id,
      factTitle: missing.fact.title,
      factStatus: "approved",
      reviewFact: "conflict",
      confirmable: false,
    });
  }
  const expired = hits.find((hit) => hit.fact.status === "expired" && hit.relation !== "wording");
  if (expired) {
    return comparison({
      claim: excerptText(expired.fact.claim),
      judgment: "insufficient",
      factId: expired.fact.id,
      factTitle: expired.fact.title,
      factStatus: "expired",
      reviewFact: "expired",
      confirmable: false,
    });
  }
  const wording = hits.find((hit) => hit.relation === "wording");
  if (wording) {
    return comparison({
      claim: excerpt,
      judgment: "not_applicable",
      factId: wording.fact.id,
      factTitle: wording.fact.title,
      factStatus: wording.fact.status,
      reviewFact: "active",
      confirmable: false,
    });
  }
  return comparison({
    claim: excerpt,
    judgment: "not_applicable",
    factId: null,
    factTitle: null,
    factStatus: null,
    reviewFact: "active",
    confirmable: false,
  });
}

/** The model may replace the claim text. It cannot widen confirmability or override the fact gate. */
export function applyExtractedClaim(current: AnswerClaimComparison, claim: string): AnswerClaimComparison {
  return { ...current, claim, confirmable: current.confirmable && current.judgment === "conflict" && current.reviewFact === "active" };
}
