import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { getTranslator } from "@/lib/i18n/server";
import { answerListPath } from "./answer-list.ts";
import { clusterMetricKinds, type QuestionClusterSummary } from "./metrics.ts";
import type { OverviewScope } from "./overview-contracts.ts";

export function ClusterMetricsTable({
  rows,
  scope,
  hasOfficialWebsite,
  locale,
  t,
}: {
  rows: Array<QuestionClusterSummary & { label: string }>;
  scope: OverviewScope;
  hasOfficialWebsite: boolean;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslator<"evidenceOverview">>>;
}) {
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="overview-per-cluster">
      <h2 id="overview-per-cluster" className="text-lg font-semibold">{t("perCluster")}</h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("perClusterNote")}</p>
      <div
        role="region"
        aria-labelledby="overview-per-cluster"
        tabIndex={0}
        className="max-w-full min-w-0 overflow-x-auto rounded-2xl border bg-card focus-visible:outline-2 focus-visible:outline-ring"
      >
        <table className="min-w-full text-left text-sm" aria-labelledby="overview-per-cluster">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              {(["cluster", "mentionRate", "recommendRate", "officialCiteRate"] as const).map((key) => (
                <th key={key} scope="col" className="px-4 py-3 font-medium">{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cluster, label, metrics, questionKeys }) => (
              <tr key={cluster?.id ?? "unassigned"} className="border-t">
                <th scope="row" className="min-w-32 px-4 py-3 align-top font-medium wrap-anywhere">
                  {cluster ? (
                    <Link
                      href={answerListPath("/dashboard/monitoring/answers", scope, { cluster: cluster.id })}
                      prefetch={false}
                      aria-label={t("viewClusterAnswers", { cluster: label })}
                      className="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {label}
                    </Link>
                  ) : label}
                </th>
                {clusterMetricKinds.map((kind) => {
                  const metric = metrics[kind];
                  const emptyReason = kind === "officialSiteCited" && !hasOfficialWebsite
                    ? t("officialNa")
                    : t("clusterNoJudged");
                  return (
                    <td key={kind} className="min-w-32 px-4 py-3 align-top tabular-nums">
                      <span className="font-medium">{metric.equalWeight === null ? "N/A" : formatPercent(locale, metric.equalWeight)}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {t("clusterQuestionCoverage", {
                          covered: formatNumber(locale, metric.coveredQuestions),
                          fixed: formatNumber(locale, questionKeys.length),
                        })}
                        {metric.equalWeight === null ? <span className="block">{emptyReason}</span> : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
