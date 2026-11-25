import { createHash } from "node:crypto";
import en from "../../lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../lib/i18n/messages/zh-CN.json" with { type: "json" };
import { isLocale } from "../../lib/i18n/locale.ts";
import { createTranslator } from "../../lib/i18n/translate.ts";
import { businessFeedbackLines, type SnapshotBusinessFeedback } from "./business-feedback.ts";
import { presentSnapshotCost } from "./cost-copy.ts";
import { conclusionSentence, executionSentence, readExecution, readVisits, visitSentences } from "./reading.ts";
import type { SnapshotCost, SnapshotLabor } from "./cost.ts";
import { snapshotMetrics, type SnapshotComparisons, type SnapshotMetric } from "./snapshot-comparisons.ts";
import type { ReportGrade } from "./types.ts";

export const snapshotMetricLabels = {
  mention_rate: "metricMention",
  recommendation_rate: "metricRecommendation",
  official_site_citation_rate: "metricOfficialCitation",
} as const;

export type SnapshotPayloadInput = {
  reportId: string;
  brandId: string;
  brandName: string;
  entityVersion: number;
  timezone: string;
  locale: string;
  intent: "business_loop" | "diagnostic";
  loopCompleted: boolean;
  metrics: SnapshotComparisons;
  windows: {
    before: { start: string; endExclusive: string };
    after: { start: string; endExclusive: string };
  };
  publication: null | {
    id: string;
    effectiveAt: string;
    verification: string;
  };
  createdAt: string;
  predecessorId?: string | null;
  limitations?: string[];
  cost: SnapshotCost;
  labor: SnapshotLabor;
  businessFeedback?: SnapshotBusinessFeedback;
};

function metricBlock({ result, excludedSamples, unavailable }: SnapshotComparisons["comparisons"][SnapshotMetric]) {
  const queries = result.included.map((item) => ({
    query_id: item.queryId,
    query_version: item.queryVersion,
    before: {
      numerator: item.before.numerator,
      denominator: item.before.denominator,
      rate: item.before.rate,
      observation_ids: item.before.observationIds,
    },
    after: {
      numerator: item.after.numerator,
      denominator: item.after.denominator,
      rate: item.after.rate,
      observation_ids: item.after.observationIds,
    },
  }));
  return {
    grade: result.grade,
    common_query_count: result.commonQueryCount,
    frozen_query_count: result.frozenQueryCount,
    before_sample_count: queries.reduce((sum, item) => sum + item.before.denominator, 0),
    after_sample_count: queries.reduce((sum, item) => sum + item.after.denominator, 0),
    before: result.grade === "exploratory" ? result.before : null,
    after: result.grade === "exploratory" ? result.after : null,
    delta_pp: result.deltaPp,
    reason: result.grade === "incomparable" ? "fewer_than_three_judgable_questions" : null,
    conclusion: result.conclusion,
    queries,
    excluded_queries: result.excluded,
    excluded_samples: excludedSamples,
    unavailable_observation_count: unavailable,
  };
}

export function buildSnapshotDocument(input: SnapshotPayloadInput) {
  const sourceMissing = input.metrics.comparisons.recommendation_rate.result.sourceMissing;
  const grade: ReportGrade = snapshotMetrics.some((metric) => input.metrics.comparisons[metric].result.grade === "exploratory")
    ? "exploratory" : "incomparable";
  const limitations = [
    ...(input.limitations ?? []),
    grade === "exploratory" ? "小样本探索，不代表稳定趋势" : "共同可判断题不足 3，不可比较",
    input.loopCompleted ? "存在核验生效点，可记经营闭环观察" : "无核验生效或仅为诊断复跑，经营闭环未完成",
    ...(sourceMissing ? ["部分源证据缺失，快照仍保留原字节但标注来源不可复核"] : []),
  ];

  return {
    schema_version: "report-v4",
    report_id: input.reportId,
    is_demo: false,
    created_at: input.createdAt,
    predecessor_id: input.predecessorId ?? null,
    brand: {
      id: input.brandId,
      name: input.brandName,
      entity_version: String(input.entityVersion),
    },
    grade,
    intent: input.intent,
    loop_completed: input.loopCompleted,
    metrics_version: "metrics-v3",
    aggregation: "question_equal_weight",
    causality: "not_established",
    locale: input.locale,
    timezone: input.timezone,
    windows: input.windows,
    comparisons: {
      mention_rate: metricBlock(input.metrics.comparisons.mention_rate),
      recommendation_rate: metricBlock(input.metrics.comparisons.recommendation_rate),
      official_site_citation_rate: metricBlock(input.metrics.comparisons.official_site_citation_rate),
    },
    evidence: input.metrics.evidence,
    publication: input.publication,
    cost: input.cost,
    labor: input.labor,
    ...(input.businessFeedback ? { business_feedback: input.businessFeedback } : {}),
    limitations,
    next_action: input.loopCompleted ? "按探索结论安排下一轮动作，不把观察写成因果" : "完成发布核验后再申请经营闭环报告",
    source_missing: sourceMissing,
  };
}

export function renderSnapshotHtml(document: ReturnType<typeof buildSnapshotDocument>): string {
  const locale = isLocale(document.locale) ? document.locale : "zh-CN";
  const t = createTranslator(locale, locale === "en" ? en.reports : zhCN.reports, zhCN.reports);
  const percent = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const points = new Intl.NumberFormat(locale, { signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const rate = (value: number | null) => value === null ? "N/A" : percent.format(value);
  const sideLabel = { before: "comparisonBefore", after: "comparisonAfter", both: "comparisonBoth" } as const;
  const comparisons = snapshotMetrics.map((metric) => {
    const block = document.comparisons[metric];
    const rows = block.queries.map((query) => (
      `<tr><th scope="row">${escape(query.query_id)}</th>`
      + `<td>${query.before.numerator}/${query.before.denominator} (${rate(query.before.rate)})</td>`
      + `<td>${query.after.numerator}/${query.after.denominator} (${rate(query.after.rate)})</td></tr>`
    )).join("");
    const excluded = block.excluded_queries.map((item) => (
      `<li>${escape(item.queryId)} · ${escape(t(sideLabel[item.side]))} · ${escape(t(`comparisonReason_${item.reason}`))}</li>`
    ));
    for (const side of ["before", "after"] as const) {
      for (const item of block.excluded_samples[side]) {
        excluded.push(`<li>${escape(item.query_id ?? item.observation_id)} · ${escape(t(sideLabel[side]))} · ${escape(t(`comparisonReason_${item.reason}`))}</li>`);
      }
      const count = block.unavailable_observation_count[side];
      if (count) excluded.push(`<li>${escape(t("comparisonUnavailableObservations", { side: t(sideLabel[side]), count }))}</li>`);
    }
    return `<section id="${metric}">
    <h2>${escape(t(snapshotMetricLabels[metric]))}</h2>
    <p>${escape(t("comparisonCounts", { common: block.common_query_count, frozen: block.frozen_query_count, before: block.before_sample_count, after: block.after_sample_count }))}</p>
    <p>${escape(t("comparisonValues", { before: rate(block.before), after: rate(block.after), delta: block.delta_pp === null ? "N/A" : `${points.format(block.delta_pp)}pp` }))}</p>
    <p>${escape(conclusionSentence(locale, block.conclusion))}</p>
    <p>${escape(t(block.reason ? "comparisonInsufficient" : "comparisonExploratory"))}</p>
    ${rows ? `<table><thead><tr><th scope="col">${escape(t("comparisonQuestion"))}</th><th scope="col">${escape(t("comparisonBefore"))}</th><th scope="col">${escape(t("comparisonAfter"))}</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
    ${excluded.length ? `<h3>${escape(t("comparisonExcluded"))}</h3><ul>${excluded.join("")}</ul>` : ""}
  </section>`;
  }).join("\n  ");
  const cost = presentSnapshotCost(locale, document.cost, document.labor);
  const reason = cost.reason ? `<p>${escape(cost.reason)}</p>` : "";
  const execution = executionSentence(locale, readExecution(document));
  const visits = visitSentences(locale, document.business_feedback
    ? readVisits(document)
    : { state: "absent" });
  const inquiries = document.business_feedback
    ? businessFeedbackLines(locale, document.business_feedback)
    : [t("businessAbsent")];
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"/><title>Report ${escape(document.report_id)}</title></head>
<body>
  <h1>Report ${escape(document.report_id)}</h1>
  <p>Brand: ${escape(document.brand.name)} · Entity v${escape(document.brand.entity_version)}</p>
  <p>Grade: ${escape(document.grade)} · Intent: ${escape(document.intent)} · Loop completed: ${document.loop_completed}</p>
  <section id="execution">
    <h2>${escape(t("layerExecution"))}</h2>
    <p>${escape(execution)}</p>
  </section>
  <h2>${escape(t("layerVisibility"))}</h2>
  ${comparisons}
  <section id="crawler-visits">
    <h2>${escape(t("layerVisits"))}</h2>
    ${visits.map((line) => `<p>${escape(line)}</p>`).join("\n    ")}
  </section>
  <section id="business-feedback">
    <h2>${escape(t("businessHeading"))}</h2>
    ${inquiries.map((line) => `<p>${escape(line)}</p>`).join("\n    ")}
  </section>
  <section id="snapshot-cost">
    <h2>${escape(cost.heading)}</h2>
    <p>${escape(cost.known)}</p>
    <p>${escape(cost.pending)}</p>
    ${reason}
    <p>${escape(cost.labor)}</p>
    <p>${escape(cost.laborReason)}</p>
  </section>
  <h2>Limitations</h2><ul>${document.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>
  <p>Next: ${escape(document.next_action)}</p>
</body>
</html>`;
}

export function fingerprintBytes(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function escape(value: string | number | boolean): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
