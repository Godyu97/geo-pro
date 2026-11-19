import { createHash } from "node:crypto";
import type { TriState } from "./contracts.ts";
import { nativeCited } from "./contracts.ts";

export const analysisRuleVersion = "s-m0-06-v1";

export function fingerprintAnswer(questionText: string, answerText: string) {
  return createHash("sha256").update(`${questionText}\n${answerText}`, "utf8").digest("hex");
}

export function normalizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
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
    return rawUrl.trim();
  }
}

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => term && lower.includes(term.toLowerCase()));
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function classifyLabels(input: {
  answerText: string;
  brandName: string;
  aliases?: string[];
  officialWebsite?: string | null;
  citations?: Array<{ rawUrl: string; normalizedUrl?: string; citationOrigin: string; ownership?: string }>;
  mentioned?: TriState;
  recommended?: TriState;
  officialSiteCited?: TriState;
}): { mentioned: TriState; recommended: TriState; officialSiteCited: TriState; status: "classified" | "needs_review"; evidenceSpan: string | null } {
  if (input.mentioned && input.recommended && input.officialSiteCited) {
    const status = input.recommended === "true" && input.mentioned === "false" ? "needs_review" : "classified";
    return {
      mentioned: input.mentioned,
      recommended: input.recommended,
      officialSiteCited: input.officialSiteCited,
      status,
      evidenceSpan: null,
    };
  }

  const names = [input.brandName, ...(input.aliases ?? [])].filter(Boolean);
  const mentioned: TriState = includesAny(input.answerText, names) ? "true" : "false";
  const negative = /不适合|不推荐|不要选|不建议|避免|不是好选择|not (a )?good|avoid|unsuitable|not recommend/i.test(input.answerText);
  const positive = /可考虑|推荐|适合|值得|建议选择|recommend|consider|suitable/i.test(input.answerText);
  let recommended: TriState = "unknown";
  if (mentioned === "true") {
    if (negative && !positive) recommended = "false";
    else if (positive && !negative) recommended = "true";
    else if (negative && positive) recommended = "false";
  }

  const officialHost = input.officialWebsite ? hostOf(input.officialWebsite) : "";
  const citations = input.citations ?? [];
  const native = citations.filter((item) => item.citationOrigin === "provider_native" || item.citationOrigin === "consumer_visible");
  let officialSiteCited: TriState = "unknown";
  if (!officialHost) officialSiteCited = "false";
  else if (native.length === 0 && !nativeCited(citations)) officialSiteCited = "false";
  else {
    const hit = native.some((item) => {
      const host = hostOf(item.normalizedUrl ?? item.rawUrl);
      return host === officialHost || host.endsWith(`.${officialHost}`);
    });
    officialSiteCited = hit ? "true" : native.length ? "unknown" : "false";
  }

  const status = recommended === "true" && mentioned === "false" ? "needs_review" : "classified";
  const span = mentioned === "true"
    ? input.answerText.slice(0, 240)
    : null;
  return {
    mentioned: input.mentioned ?? mentioned,
    recommended: input.recommended ?? recommended,
    officialSiteCited: input.officialSiteCited ?? officialSiteCited,
    status,
    evidenceSpan: span,
  };
}

export function citationPoolEligibility(citationSetState: "complete" | "partial" | "unsupported" | "missing") {
  return {
    inC: citationSetState === "complete",
    reason: citationSetState === "complete"
      ? null
      : citationSetState === "missing"
        ? "citation-fields-missing"
        : citationSetState,
  };
}
