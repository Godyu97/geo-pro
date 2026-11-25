import { z } from "zod";
import en from "../../lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../lib/i18n/messages/zh-CN.json" with { type: "json" };
import { isLocale, type Locale } from "../../lib/i18n/locale.ts";
import { createTranslator } from "../../lib/i18n/translate.ts";
import {
  aiReferralConversion,
  crawlerVisitIsNotAiInclusion,
  type LeadEvidence,
} from "../business-feedback/rules.ts";

const count = z.number().int().nonnegative();
const primaryCounts = z.strictObject({
  referral: count,
  self_report: count,
  landing_page: count,
  unknown: count,
});

const missingDenominator = z.strictObject({
  identified_referrals: count,
  session_denominator: z.null(),
  rate: z.null(),
  reason: z.literal("missing_session_denominator"),
});

const measuredConversion = z.strictObject({
  identified_referrals: count,
  session_denominator: z.number().int().positive(),
  rate: z.number().finite().nonnegative(),
  reason: z.null(),
});

export const snapshotBusinessFeedbackSchema = z.strictObject({
  deduped_inquiries: count,
  primary_distribution: primaryCounts,
  qualified_inquiries: count,
  ai_referral_conversion: z.union([missingDenominator, measuredConversion]),
  self_reported_inquiries: count,
  self_reported_over_visits: z.null(),
  crawler_visits: z.strictObject({
    count,
    called_included: z.literal(false),
  }),
  answer_citations: count,
  causality: z.literal("not_established"),
});

export type SnapshotBusinessFeedback = z.infer<typeof snapshotBusinessFeedbackSchema>;

export type SnapshotBusinessView =
  | { state: "ready"; feedback: SnapshotBusinessFeedback }
  | { state: "absent" }
  | { state: "unavailable" };

export function readSnapshotBusiness(saved: unknown): SnapshotBusinessView {
  if (!saved || typeof saved !== "object" || !("business_feedback" in saved)) return { state: "absent" };
  const parsed = snapshotBusinessFeedbackSchema.safeParse(saved.business_feedback);
  return parsed.success ? { state: "ready", feedback: parsed.data } : { state: "unavailable" };
}

type PrimaryCounts = Record<LeadEvidence, number>;

/** Exclusive primary counts, a frozen qualified count, and a rate only when a session denominator exists. */
export function summarizeBusinessFeedback(input: {
  primaryCounts: PrimaryCounts;
  qualified: number;
  identifiedReferrals: number;
  sessionDenominator: number | null;
  observationCrawlerVisits: number;
  observationAnswerCitations: number;
  crawlerVisitCount: number;
  crawlerAnswerCitations: number;
}): SnapshotBusinessFeedback {
  const primary = input.primaryCounts;
  const deduped = primary.referral + primary.self_report + primary.landing_page + primary.unknown;
  const denominator = input.sessionDenominator !== null && input.sessionDenominator > 0
    ? input.sessionDenominator
    : null;
  const identified = denominator === null ? 0 : input.identifiedReferrals;
  const conversion = aiReferralConversion({
    identifiedReferrals: identified,
    sessionDenominator: denominator,
    selfReported: primary.self_report,
  });
  const inclusion = crawlerVisitIsNotAiInclusion({
    crawlerVisits: input.crawlerVisitCount + input.observationCrawlerVisits,
    answerCitations: input.crawlerAnswerCitations + input.observationAnswerCitations,
  });
  if (inclusion.calledIncluded || conversion.selfReportedOverVisits !== null) {
    throw new Error("business-feedback-misstated");
  }
  if (denominator !== null && conversion.identified.rate === null) throw new Error("business-feedback-misstated");
  const feedback: SnapshotBusinessFeedback = {
    deduped_inquiries: deduped,
    primary_distribution: { ...primary },
    qualified_inquiries: input.qualified,
    ai_referral_conversion: denominator === null || conversion.identified.rate === null
      ? {
        identified_referrals: 0,
        session_denominator: null,
        rate: null,
        reason: "missing_session_denominator",
      }
      : {
        identified_referrals: identified,
        session_denominator: denominator,
        rate: conversion.identified.rate,
        reason: null,
      },
    self_reported_inquiries: primary.self_report,
    self_reported_over_visits: null,
    crawler_visits: { count: inclusion.visits, called_included: false },
    answer_citations: inclusion.citations,
    causality: "not_established",
  };
  return snapshotBusinessFeedbackSchema.parse(feedback);
}

export function businessFeedbackLines(locale: Locale, feedback: SnapshotBusinessFeedback) {
  const catalog = isLocale(locale) && locale === "en" ? en.reports : zhCN.reports;
  const t = createTranslator(locale, catalog, zhCN.reports);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const primary = feedback.primary_distribution;
  const conversion = feedback.ai_referral_conversion;
  return [
    t("businessInquiries", { count: number.format(feedback.deduped_inquiries) }),
    t("businessPrimary", {
      referral: number.format(primary.referral),
      selfReport: number.format(primary.self_report),
      landingPage: number.format(primary.landing_page),
      unknown: number.format(primary.unknown),
    }),
    t("businessQualified", { count: number.format(feedback.qualified_inquiries) }),
    conversion.rate === null
      ? t("businessRateNa")
      : t("businessRate", { rate: percent.format(conversion.rate) }),
    t("businessCrawler", { count: number.format(feedback.crawler_visits.count) }),
    t("businessCrawlerNote"),
    t("businessCitations", { count: number.format(feedback.answer_citations) }),
    t("businessCausality"),
  ];
}
