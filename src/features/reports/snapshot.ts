import { createHash } from "node:crypto";
import type { ComparisonResult } from "./rules.ts";

export type SnapshotPayloadInput = {
  reportId: string;
  brandId: string;
  brandName: string;
  entityVersion: number;
  timezone: string;
  locale: string;
  metric: string;
  intent: "business_loop" | "diagnostic";
  loopCompleted: boolean;
  grade: ComparisonResult["grade"];
  comparison: ComparisonResult;
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
  nextAction?: string;
};

export function buildSnapshotDocument(input: SnapshotPayloadInput) {
  const limitations = [
    ...(input.limitations ?? []),
    input.grade === "exploratory" ? "探索口径，不声称因果" : "共同可判断题不足 3，不可比较",
    input.loopCompleted ? "存在核验生效点，可记经营闭环观察" : "无核验生效或仅为诊断复跑，经营闭环未完成",
    input.comparison.sourceMissing ? "部分源证据缺失，快照仍保留原字节但标注来源不可复核" : null,
  ].filter(Boolean) as string[];

  return {
    schema_version: "report-v3",
    report_id: input.reportId,
    is_demo: false,
    created_at: input.createdAt,
    predecessor_id: input.predecessorId ?? null,
    brand: {
      id: input.brandId,
      name: input.brandName,
      entity_version: String(input.entityVersion),
    },
    grade: input.grade,
    intent: input.intent,
    loop_completed: input.loopCompleted,
    metrics_version: "metrics-v3",
    metric: input.metric,
    aggregation: "question_equal_weight",
    locale: input.locale,
    timezone: input.timezone,
    windows: input.windows,
    queries: input.comparison.included.map((item) => ({
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
    })),
    excluded_queries: input.comparison.excluded,
    summary: {
      common_query_count: input.comparison.commonQueryCount,
      frozen_query_count: input.comparison.frozenQueryCount,
      before: input.comparison.before,
      after: input.comparison.after,
      delta_pp: input.comparison.deltaPp,
      conclusion: input.comparison.conclusion,
      causality: input.comparison.causality,
    },
    publication: input.publication,
    limitations,
    next_action: input.nextAction
      ?? (input.loopCompleted ? "按探索结论安排下一轮动作，不把观察写成因果" : "完成发布核验后再申请经营闭环报告"),
    source_missing: input.comparison.sourceMissing,
  };
}

export function renderSnapshotHtml(document: ReturnType<typeof buildSnapshotDocument>): string {
  const rows = document.queries.map((query) => (
    `<tr><td>${escape(query.query_id)}</td><td>${escape(query.query_version)}</td>`
    + `<td>${fmt(query.before.rate)}</td><td>${fmt(query.after.rate)}</td></tr>`
  )).join("");
  const excluded = document.excluded_queries.map((item) => (
    `<li>${escape(item.queryId)} (${escape(item.reason)})</li>`
  )).join("");
  return `<!doctype html>
<html lang="${escape(document.locale)}">
<head><meta charset="utf-8"/><title>Report ${escape(document.report_id)}</title></head>
<body>
  <h1>Report ${escape(document.report_id)}</h1>
  <p>Brand: ${escape(document.brand.name)} · Entity v${escape(document.brand.entity_version)}</p>
  <p>Grade: ${escape(document.grade)} · Intent: ${escape(document.intent)} · Loop completed: ${document.loop_completed}</p>
  <p>Conclusion: ${escape(document.summary.conclusion)} · Δpp: ${document.summary.delta_pp ?? "n/a"} · Causality: not_established</p>
  <p>Common questions: ${document.summary.common_query_count} / frozen ${document.summary.frozen_query_count}</p>
  <table><thead><tr><th>Query</th><th>Version</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Excluded</h2><ul>${excluded || "<li>none</li>"}</ul>
  <h2>Limitations</h2><ul>${document.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>
  <p>Next: ${escape(document.next_action)}</p>
</body>
</html>`;
}

export function fingerprintBytes(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fmt(rate: number | null): string {
  return rate == null ? "n/a" : (rate * 100).toFixed(2) + "%";
}

function escape(value: string | number | boolean): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
