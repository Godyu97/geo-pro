import type { PublicationStatus } from "./contracts.ts";

export const pageAccessClasses = ["public", "login_wall", "draft_box", "removed"] as const;
export type PageAccessClass = (typeof pageAccessClasses)[number];

export type FixturePage = {
  accessClass: PageAccessClass;
  httpStatus: number;
  title: string;
  bodyText: string;
  pageMarker?: string;
};

export type ClaimMatch = {
  claim: string;
  matched: boolean;
};

export type PublicCheckResult = {
  status: Extract<
    PublicationStatus,
    "draft_only" | "access_limited" | "verified_public" | "mismatch" | "removed" | "pending_check"
  >;
  matches: ClaimMatch[];
  setsEffectiveAt: boolean;
  evidenceGrade: "public" | null;
  reason: string;
};

export type ManualEvidenceInput = {
  screenshotRef: string;
  pageMarker: string;
  observedAt: string;
  bodyExcerpt: string;
  reviewerNote?: string;
};

export type ManualCheckResult = {
  status: "verified_manual" | "mismatch" | "access_limited";
  matches: ClaimMatch[];
  setsEffectiveAt: boolean;
  evidenceGrade: "manual";
  reason: string;
};

/** Normalize whitespace for claim comparison against page body. */
export function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

export function matchClaims(bodyText: string, claims: string[]): ClaimMatch[] {
  const haystack = normalizeText(bodyText);
  return claims.map((claim) => ({
    claim,
    matched: claim.trim().length > 0 && haystack.includes(normalizeText(claim)),
  }));
}

/**
 * Classify an isolated/fixture page observation into a publication check result.
 * HTTP 200 alone never counts as public verification.
 */
export function evaluatePublicCheck(input: {
  fixture: FixturePage;
  claims: string[];
  alreadyHasEffectiveAt: boolean;
}): PublicCheckResult {
  const { fixture, claims, alreadyHasEffectiveAt } = input;

  if (fixture.accessClass === "draft_box") {
    return {
      status: "draft_only",
      matches: matchClaims(fixture.bodyText, claims),
      setsEffectiveAt: false,
      evidenceGrade: null,
      reason: "draft_box",
    };
  }
  if (fixture.accessClass === "login_wall") {
    return {
      status: "access_limited",
      matches: matchClaims(fixture.bodyText, claims),
      setsEffectiveAt: false,
      evidenceGrade: null,
      reason: "login_wall",
    };
  }
  if (fixture.accessClass === "removed" || fixture.httpStatus === 404) {
    return {
      status: "removed",
      matches: matchClaims(fixture.bodyText, claims),
      setsEffectiveAt: false,
      evidenceGrade: null,
      reason: "removed",
    };
  }

  // Public access class still requires claim consistency; HTTP success is insufficient.
  if (fixture.accessClass !== "public" || fixture.httpStatus < 200 || fixture.httpStatus >= 400) {
    return {
      status: "pending_check",
      matches: matchClaims(fixture.bodyText, claims),
      setsEffectiveAt: false,
      evidenceGrade: null,
      reason: "unclassified_access",
    };
  }

  const matches = matchClaims(fixture.bodyText, claims);
  const allMatched = claims.length > 0 && matches.every((item) => item.matched);
  if (!allMatched) {
    return {
      status: "mismatch",
      matches,
      setsEffectiveAt: false,
      evidenceGrade: null,
      reason: "claim_mismatch",
    };
  }

  return {
    status: "verified_public",
    matches,
    setsEffectiveAt: !alreadyHasEffectiveAt,
    evidenceGrade: "public",
    reason: "public_match",
  };
}

/** Manual evidence for access-limited pages; never upgrades to verified_public. */
export function evaluateManualEvidence(input: {
  evidence: ManualEvidenceInput;
  claims: string[];
  alreadyHasEffectiveAt: boolean;
}): ManualCheckResult {
  const { evidence, claims, alreadyHasEffectiveAt } = input;
  if (!evidence.screenshotRef.trim() || !evidence.pageMarker.trim() || !evidence.observedAt.trim()) {
    return {
      status: "access_limited",
      matches: matchClaims(evidence.bodyExcerpt, claims),
      setsEffectiveAt: false,
      evidenceGrade: "manual",
      reason: "incomplete_evidence",
    };
  }

  const matches = matchClaims(evidence.bodyExcerpt, claims);
  const allMatched = claims.length > 0 && matches.every((item) => item.matched);
  if (!allMatched) {
    return {
      status: "mismatch",
      matches,
      setsEffectiveAt: false,
      evidenceGrade: "manual",
      reason: "manual_claim_mismatch",
    };
  }

  return {
    status: "verified_manual",
    matches,
    setsEffectiveAt: !alreadyHasEffectiveAt,
    evidenceGrade: "manual",
    reason: "manual_complete",
  };
}

/** First successful verification wins; later checks must not rewrite effective_at. */
export function nextEffectiveAt(
  current: string | null,
  checkSetsEffectiveAt: boolean,
  checkedAt: string,
): string | null {
  if (current) return current;
  return checkSetsEffectiveAt ? checkedAt : null;
}
