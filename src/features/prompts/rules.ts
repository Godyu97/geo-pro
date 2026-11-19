import type { DraftContent, PromptQuestion } from "./contracts.ts";
import { primaryTypes } from "./contracts.ts";

const leading = /推荐|哪家好|哪家更|最好|首选|必买|闭眼入|应该选|请帮我选|排名第一|最值得|指定答案|\b(?:recommend(?:ed|s)?|best|top pick|must[- ]buy|you should|number one)\b/iu;

export type BrandTerms = { name: string; aliases: string[]; competitors: string[] };
export type PromptWarning = { code: "similar" | "leading" | "brandTerm"; questionIds: string[] };
export type PromptPreview = {
  saved: number;
  primary: number;
  confirmed: number;
  byType: Record<PromptQuestion["type"], number>;
};
export type BriefGap = { clusterId: string; missing: ("primaryPage" | "conversionAction")[] };
export type BudgetInput = {
  questionCount: number;
  primaryCount: number;
  region: string;
  language: string;
  questionIds: string[];
  repeatsFrozen: false;
  channelFrozen: false;
};

const types = ["discovery", "scenario", "constraint", "comparison", "brand_fact", "exploration"] as const;

export function normalizeQuestion(value: string) {
  return value.normalize("NFKC").replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu, " ").trim().toLowerCase();
}

export function termList(fields: BrandTerms) {
  return [fields.name, ...fields.aliases, ...fields.competitors].map(normalizeQuestion).filter((term) => Array.from(term).length >= 2);
}

export function containsBrandTerm(text: string, terms: readonly string[]) {
  const normalized = normalizeQuestion(text);
  return terms.some((term) => {
    if (/^[a-z0-9][a-z0-9 .&+-]*$/i.test(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(normalized);
    }
    return normalized.includes(term);
  });
}

export function isLeadingQuestion(text: string) {
  return leading.test(normalizeQuestion(text));
}

function bigrams(value: string) {
  const chars = Array.from(value);
  const grams = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) grams.add(chars[index] + chars[index + 1]);
  return grams;
}

export function isNearDuplicate(left: string, right: string) {
  const a = normalizeQuestion(left);
  const b = normalizeQuestion(right);
  if (!a || !b || a === b) return false;
  const [shorter, longer] = Array.from(a).length <= Array.from(b).length ? [a, b] : [b, a];
  const shortLength = Array.from(shorter).length;
  const longLength = Array.from(longer).length;
  if (shortLength >= 8 && longer.includes(shorter) && shortLength / longLength >= 0.75) return true;
  const leftGrams = bigrams(a);
  const rightGrams = bigrams(b);
  if (leftGrams.size < 4 || rightGrams.size < 4) return false;
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  const union = leftGrams.size + rightGrams.size - shared;
  return union > 0 && shared / union >= 0.72;
}

export function publicPage(value: string) {
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) || /[\\\s\p{Cc}]/u.test(value) || value.length > 2048) return false;
  const url = URL.parse(value);
  if (!url || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host) &&
    !/\.(?:example|internal|invalid|lan|local|localhost|onion|test)$/.test(host) &&
    !host.endsWith(".home.arpa");
}

export function defaultCandidates(language: string): Array<{
  key: string; text: string; type: PromptQuestion["type"]; stage: PromptQuestion["stage"];
  source: "generated"; sourceNote: string;
}> {
  const english = !language.toLowerCase().startsWith("zh");
  const rows = english
    ? [
        ["discovery", "awareness", "What conditions do people usually compare in this category?"],
        ["scenario", "consider", "What usage situation should be confirmed before everyday use?"],
        ["constraint", "consider", "How can a limited budget decide whether an option is suitable?"],
        ["discovery", "awareness", "Which limits and prerequisites matter before a first purchase?"],
        ["scenario", "decide", "Which maintenance and support conditions matter before long-term use?"],
        ["constraint", "compare", "Which limits make one option unsuitable compared with another?"],
      ]
    : [
        ["discovery", "awareness", "这个品类里，大家通常会比较哪些条件？"],
        ["scenario", "consider", "日常使用时，最先要确认的使用场景是什么？"],
        ["constraint", "consider", "预算有限时，怎样判断一个选择是否合适？"],
        ["discovery", "awareness", "第一次购买前，应该看哪些限制和前提？"],
        ["scenario", "decide", "长期使用前，需要确认哪些维护和售后条件？"],
        ["constraint", "compare", "不同方案之间，哪些限制会让某个选择不合适？"],
      ] as const;
  return rows.map(([type, stage, text], index) => ({
    key: `non-brand-v1-${index + 1}`,
    text,
    type: type as PromptQuestion["type"],
    stage: stage as PromptQuestion["stage"],
    source: "generated" as const,
    sourceNote: "template:non-brand-v1",
  }));
}

export function annotateDraft(content: DraftContent, terms: readonly string[]) {
  const questions = content.questions.map((question) => {
    const active = question.status !== "inactive";
    const leadingQuestion = active && isLeadingQuestion(question.text);
    const type = leadingQuestion && primaryTypes.has(question.type) ? "exploration" as const : question.type;
    const brandTerm = active && containsBrandTerm(question.text, terms);
    const primary = question.status === "confirmed" && primaryTypes.has(type) && !brandTerm;
    return { ...question, type, primary, leadingQuestion, brandTerm };
  });
  const active = questions.filter((question) => question.status !== "inactive");
  const duplicates: string[][] = [];
  const seen = new Map<string, string>();
  for (const question of active) {
    const key = normalizeQuestion(question.text);
    const previous = seen.get(key);
    if (previous) duplicates.push([previous, question.id]);
    else seen.set(key, question.id);
  }
  const similar: string[][] = [];
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      if (normalizeQuestion(active[left].text) === normalizeQuestion(active[right].text)) continue;
      if (isNearDuplicate(active[left].text, active[right].text)) similar.push([active[left].id, active[right].id]);
    }
  }
  const warnings: PromptWarning[] = [
    ...similar.map((questionIds) => ({ code: "similar" as const, questionIds })),
    ...questions.filter((question) => question.leadingQuestion).map((question) => ({ code: "leading" as const, questionIds: [question.id] })),
    ...questions.filter((question) => question.brandTerm && primaryTypes.has(question.type)).map((question) => ({ code: "brandTerm" as const, questionIds: [question.id] })),
  ];
  const preview: PromptPreview = {
    saved: active.length,
    primary: questions.filter((question) => question.primary).length,
    confirmed: questions.filter((question) => question.status === "confirmed").length,
    byType: Object.fromEntries(types.map((type) => [type, active.filter((question) => question.type === type).length])) as PromptPreview["byType"],
  };
  return { questions, duplicates, similar, warnings, preview };
}

export function briefGaps(content: DraftContent): BriefGap[] {
  return content.clusters.flatMap((cluster) => {
    const used = content.questions.some((question) => question.clusterId === cluster.id && question.status === "confirmed");
    if (!used) return [];
    const missing = [
      ...(!cluster.primaryPage ? ["primaryPage" as const] : []),
      ...(!cluster.conversionAction ? ["conversionAction" as const] : []),
    ];
    return missing.length ? [{ clusterId: cluster.id, missing }] : [];
  });
}

export function budgetInput(questions: readonly PromptQuestion[], fallback: { region: string; language: string }): BudgetInput {
  const confirmed = questions.filter((question) => question.status === "confirmed");
  return {
    questionCount: confirmed.length,
    primaryCount: confirmed.filter((question) => question.primary).length,
    region: confirmed[0]?.region ?? fallback.region,
    language: confirmed[0]?.language ?? fallback.language,
    questionIds: confirmed.map((question) => question.id),
    repeatsFrozen: false,
    channelFrozen: false,
  };
}

export function changedQuestionIds(previous: readonly PromptQuestion[], next: readonly PromptQuestion[]) {
  const current = new Map(next.map((question) => [question.id, question]));
  return previous.filter((question) => {
    const updated = current.get(question.id);
    if (!updated) return true;
    return normalizeQuestion(question.text) !== normalizeQuestion(updated.text) ||
      question.type !== updated.type || question.status !== updated.status ||
      question.region !== updated.region || question.language !== updated.language;
  }).map((question) => question.id);
}

export type DraftIssue =
  | { error: "invalidInput" }
  | { error: "duplicate"; questionIds: string[] }
  | { error: "similar"; questionIds: string[] }
  | { error: "deactivateRequired"; questionIds: string[] }
  | { error: "notReady"; adjustments: Array<"trim" | "confirmQuestions" | "addPrimary" | "mixedScope"> };

export function validateDraft(content: DraftContent, terms: readonly string[], referenced: readonly string[], mode: "save" | "freeze"): DraftIssue | {
  content: DraftContent;
  warnings: PromptWarning[];
  preview: PromptPreview;
  gaps: BriefGap[];
} {
  const clusterIds = new Set(content.clusters.map((cluster) => cluster.id));
  const questionIds = new Set(content.questions.map((question) => question.id));
  if (clusterIds.size !== content.clusters.length || questionIds.size !== content.questions.length ||
    content.questions.some((question) => !clusterIds.has(question.clusterId))) return { error: "invalidInput" };
  const active = content.questions.filter((question) => question.status !== "inactive");
  if (active.length > 10) return { error: "notReady", adjustments: ["trim"] };
  const missing = referenced.filter((item) => !questionIds.has(item));
  if (missing.length) return { error: "deactivateRequired", questionIds: missing };
  for (const cluster of content.clusters) {
    const used = active.some((question) => question.clusterId === cluster.id);
    if (used && (!cluster.audience || !cluster.intent || !publicPage(cluster.primaryPage))) return { error: "invalidInput" };
  }
  if (active.some((question) => (question.source === "generated" || question.source === "consultation") && !question.sourceNote)) {
    return { error: "invalidInput" };
  }
  const annotated = annotateDraft(content, terms);
  if (annotated.duplicates.length) return { error: "duplicate", questionIds: annotated.duplicates[0] };
  const blocked = annotated.similar.find((pair) => pair.every((item) => !content.questions.find((question) => question.id === item)?.acceptSimilar));
  if (blocked) return { error: "similar", questionIds: blocked };
  const stored = {
    clusters: content.clusters,
    questions: annotated.questions.map((question) => ({
      id: question.id, clusterId: question.clusterId, text: question.text, source: question.source,
      sourceNote: question.sourceNote, type: question.type, stage: question.stage, region: question.region,
      language: question.language, status: question.status, acceptSimilar: question.acceptSimilar, primary: question.primary,
    })),
  };
  if (mode === "freeze") {
    if (stored.questions.some((question) => question.status === "candidate")) return { error: "notReady", adjustments: ["confirmQuestions"] };
    const confirmed = stored.questions.filter((question) => question.status === "confirmed");
    const regions = new Set(confirmed.map((question) => question.region));
    const languages = new Set(confirmed.map((question) => question.language));
    if (regions.size > 1 || languages.size > 1) return { error: "notReady", adjustments: ["mixedScope"] };
    if (annotated.preview.primary < 3) return { error: "notReady", adjustments: ["addPrimary"] };
  }
  return { content: stored, warnings: annotated.warnings, preview: annotated.preview, gaps: briefGaps(stored) };
}
