import { z } from "zod";
import en from "../../lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../lib/i18n/messages/zh-CN.json" with { type: "json" };
import { isLocale, type Locale } from "../../lib/i18n/locale.ts";
import { createTranslator } from "../../lib/i18n/translate.ts";
import { readSnapshotBusiness } from "./business-feedback.ts";
import { snapshotMetrics, type SnapshotMetric } from "./snapshot-comparisons.ts";

export const savedConclusions = ["improved", "unchanged", "declined", "inconclusive", "incomparable"] as const;
export type SavedConclusion = typeof savedConclusions[number];
export type MetricConclusion = SavedConclusion | "missing";

const conclusionSchema = z.enum(savedConclusions);
const conclusionKey = {
  improved: "conclusionImproved",
  declined: "conclusionDeclined",
  unchanged: "conclusionUnchanged",
  inconclusive: "conclusionInconclusive",
  incomparable: "conclusionIncomparable",
} as const;

export type ExecutionReading =
  | { state: "verified"; effectiveAt: string }
  | { state: "diagnostic" }
  | { state: "absent" }
  | { state: "unavailable" };

export type VisitReading =
  | { state: "ready"; count: number; citations: number }
  | { state: "absent" }
  | { state: "unavailable" };

const publicationSchema = z.object({
  effectiveAt: z.string().min(1).max(80),
  verification: z.string().min(1).max(40),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function reportsTranslator(locale: string) {
  const resolved: Locale = isLocale(locale) ? locale : "zh-CN";
  const catalog = resolved === "en" ? en.reports : zhCN.reports;
  return { locale: resolved, t: createTranslator(resolved, catalog, zhCN.reports) };
}

/** Each metric keeps the conclusion stored on its own comparison block. */
export function readMetricConclusions(saved: unknown): Partial<Record<SnapshotMetric, MetricConclusion>> {
  const doc = asRecord(saved);
  const comparisons = doc ? asRecord(doc.comparisons) : null;
  if (!comparisons) return {};
  const result: Partial<Record<SnapshotMetric, MetricConclusion>> = {};
  for (const metric of snapshotMetrics) {
    if (!Object.hasOwn(comparisons, metric)) continue;
    const block = asRecord(comparisons[metric]);
    if (!block || !Object.hasOwn(block, "conclusion")) {
      result[metric] = "missing";
      continue;
    }
    const parsed = conclusionSchema.safeParse(block.conclusion);
    result[metric] = parsed.success ? parsed.data : "missing";
  }
  return result;
}

/** Execution is the saved publication or diagnostic rerun, separate from visibility. */
export function readExecution(saved: unknown): ExecutionReading {
  const doc = asRecord(saved);
  if (!doc) return { state: "unavailable" };
  const hasIntent = Object.hasOwn(doc, "intent");
  const hasLoop = Object.hasOwn(doc, "loop_completed");
  const hasPublication = Object.hasOwn(doc, "publication");
  if (!hasIntent && !hasLoop && !hasPublication) return { state: "absent" };
  if (!hasLoop || !hasPublication || typeof doc.loop_completed !== "boolean") return { state: "unavailable" };
  if (doc.publication === null) return doc.loop_completed ? { state: "unavailable" } : { state: "diagnostic" };
  const parsed = publicationSchema.safeParse(doc.publication);
  if (!parsed.success || parsed.data.verification !== "verified") return { state: "unavailable" };
  return { state: "verified", effectiveAt: parsed.data.effectiveAt };
}

/** Crawler visits stay in their own layer. A missing block is not filled in as zero. */
export function readVisits(saved: unknown): VisitReading {
  const business = readSnapshotBusiness(saved);
  if (business.state === "absent") return { state: "absent" };
  if (business.state === "unavailable") return { state: "unavailable" };
  return {
    state: "ready",
    count: business.feedback.crawler_visits.count,
    citations: business.feedback.answer_citations,
  };
}

export function conclusionSentence(locale: string, conclusion: MetricConclusion): string {
  const { t } = reportsTranslator(locale);
  if (conclusion === "missing") return t("conclusionMissing");
  return t("conclusionSentence", { label: t(conclusionKey[conclusion]), causality: t("conclusionCausality") });
}

export function executionSentence(locale: string, reading: ExecutionReading): string {
  const { t } = reportsTranslator(locale);
  if (reading.state === "verified") return t("executionVerified", { effectiveAt: reading.effectiveAt });
  if (reading.state === "diagnostic") return t("executionDiagnostic");
  if (reading.state === "absent") return t("executionAbsent");
  return t("executionUnavailable");
}

export function visitSentences(locale: string, reading: VisitReading): string[] {
  const { locale: resolved, t } = reportsTranslator(locale);
  if (reading.state === "absent") return [t("visitsAbsent")];
  if (reading.state === "unavailable") return [t("visitsUnavailable")];
  const number = new Intl.NumberFormat(resolved);
  return [
    t("businessCrawler", { count: number.format(reading.count) }),
    t("businessCrawlerNote"),
    t("businessCitations", { count: number.format(reading.citations) }),
  ];
}
