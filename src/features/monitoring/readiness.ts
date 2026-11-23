import { factStatus } from "../brand-facts/rules.ts";
import type { FactVersion } from "../brand-facts/contracts.ts";

export const minimumNaturalQuestions = 3;

export type ReadinessEligibility = "eligible" | "unverified" | "expired" | "degraded" | "disabled" | "missing";

export type ReadinessChannel = {
  channelId: string;
  kind: "model_api" | "consumer_ui" | "custom_pipeline";
  displayName: string;
  eligibility: ReadinessEligibility;
  version: number;
};

export type ReadinessPromptSet = {
  id: string;
  version: number;
  region: string;
  language: string;
  naturalCount: number;
  confirmedCount: number;
  inactiveCount: number;
};

export type ReadinessGrant = {
  state: "active" | "expired" | "revoked" | "ungranted";
  version: number | null;
  currency: string | null;
  countRemaining: number;
  budgetRemainingMinor: number;
};

export type ReadinessFacts = {
  approved: number;
  pending: number;
  expired: number;
  other: number;
};

export type ReadinessNext = "add-questions" | "review-inactive" | "verify-channel" | "choose-channel" | "request-quota" | "archived";

export type ReadinessInput = {
  brandStatus: "active" | "archived";
  historical: boolean;
  websiteEmpty: boolean;
  promptSet: ReadinessPromptSet | null;
  channels: ReadinessChannel[];
  grant: ReadinessGrant;
};

export type ReadinessReport = {
  canConfirm: boolean;
  next: ReadinessNext[];
  officialCitation: "applicable" | "not-applicable";
  official: ReadinessChannel[];
  manual: ReadinessChannel[];
};

type PromptQuestion = { status: "candidate" | "confirmed" | "inactive"; primary: boolean };

export function summarizePromptSet(set: {
  id: string;
  version: number;
  region: string;
  language: string;
  questions: readonly PromptQuestion[];
} | null): ReadinessPromptSet | null {
  if (!set) return null;
  const confirmed = set.questions.filter((question) => question.status === "confirmed");
  return {
    id: set.id,
    version: set.version,
    region: set.region,
    language: set.language,
    naturalCount: confirmed.filter((question) => question.primary).length,
    confirmedCount: confirmed.length,
    inactiveCount: set.questions.filter((question) => question.status === "inactive").length,
  };
}

export function summarizeSamplingGrant(input: {
  state: ReadinessGrant["state"];
  version: number | null;
  currency: string | null;
  countLimit: number;
  budgetMinor: number;
  reserved: number;
  settled: number;
  committedMinor: number;
}): ReadinessGrant {
  const active = input.state === "active";
  return {
    state: input.state,
    version: input.version,
    currency: input.currency,
    countRemaining: active ? Math.max(0, input.countLimit - input.reserved - input.settled) : 0,
    budgetRemainingMinor: active ? Math.max(0, input.budgetMinor - input.committedMinor) : 0,
  };
}

export function summarizeFactReadiness(facts: readonly FactVersion[], today: string): ReadinessFacts {
  const counts: ReadinessFacts = { approved: 0, pending: 0, expired: 0, other: 0 };
  for (const fact of facts) {
    const status = factStatus(fact, today);
    if (status === "approved") counts.approved += 1;
    else if (status === "expired") counts.expired += 1;
    else if (status === "draft" || status === "pending_confirmation") counts.pending += 1;
    else counts.other += 1;
  }
  return counts;
}

export function classifyMonitoringReadiness(input: ReadinessInput): ReadinessReport {
  const official = input.channels.filter((item) => item.kind === "model_api");
  const manual = input.channels.filter((item) => item.kind === "consumer_ui");
  const tracks = [...official, ...manual];
  const natural = input.promptSet?.naturalCount ?? 0;
  const inactive = input.promptSet?.inactiveCount ?? 0;
  const officialEligible = official.some((item) => item.eligibility === "eligible");
  const manualEligible = manual.some((item) => item.eligibility === "eligible");
  const quotaCoversScope = input.grant.state === "active"
    && input.grant.countRemaining >= Math.max(minimumNaturalQuestions, input.promptSet?.confirmedCount ?? 0)
    && input.grant.budgetRemainingMinor > 0;
  const next: ReadinessNext[] = [];
  if (input.brandStatus !== "active") next.push("archived");
  if (natural < minimumNaturalQuestions) next.push("add-questions");
  if (inactive > 0) next.push("review-inactive");
  if (tracks.some((item) => item.eligibility === "expired")) next.push("verify-channel");
  else if (!officialEligible && !manualEligible) next.push("choose-channel");
  if (official.length > 0 && !quotaCoversScope) next.push("request-quota");
  const trackReady = manualEligible || (officialEligible && quotaCoversScope);
  return {
    canConfirm: input.brandStatus === "active" && !input.historical && natural >= minimumNaturalQuestions && trackReady,
    next,
    officialCitation: input.websiteEmpty ? "not-applicable" : "applicable",
    official,
    manual,
  };
}
