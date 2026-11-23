import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskSummaryList } from "../optimization/task-summary.tsx";
import { MetricCard } from "./metric-card.tsx";
import { readEvidenceOverview } from "./overview-commands";
import { overviewScopeFromSearch, overviewScopePath } from "./overview-contracts";
import { OverviewScopeForm } from "./scope-form";

function formatRate(locale: Locale, value: number | null) {
  if (value == null) return "N/A";
  return formatPercent(locale, value);
}

export async function generateMetadata() {
  const t = await getTranslator("evidenceOverview");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EvidenceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("evidenceOverview");
  const te = await getTranslator("evidence");
  const labels = getMessages(locale).evidenceOverview;
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);

  const brandId = (typeof params.brandId === "string" && params.brandId.trim())
    ? params.brandId.trim()
    : active?.id;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/plans" prefetch={false}>{t("openPlans")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/alerts" prefetch={false}>{t("openAlerts")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/capture" prefetch={false}>{t("openCapture")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/protocols" prefetch={false}>{t("openProtocols")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/explorations" prefetch={false}>{t("openExplorations")}</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/monitoring/demo" prefetch={false}>{t("openDemo")}</Link></Button>
        </div>
      </div>
    );
  }

  const parsed = overviewScopeFromSearch(params, { brandId, sourceMode: "model_api" });
  if (!parsed.success) {
    return (
      <div role="alert" className="space-y-4 text-sm">
        <p>{t("invalidScope")}</p>
        {active?.id ? (
          <Button asChild variant="outline">
            <Link href={`/dashboard/monitoring/overview?brandId=${active.id}`} prefetch={false}>{t("clearFilters")}</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const overview = await readEvidenceOverview(connection, session.user.id, parsed.data);
  if ("error" in overview) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{te(overview.error)}</p>
      </div>
    );
  }

  const answersHref = overviewScopePath("/dashboard/monitoring/answers", parsed.data);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/monitoring/plans" prefetch={false}>{t("openPlans")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/monitoring/alerts" prefetch={false}>{t("openAlerts")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/monitoring/capture" prefetch={false}>{t("openCapture")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/monitoring/protocols" prefetch={false}>{t("openProtocols")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/monitoring/explorations?brandId=${overview.scope.brandId}`} prefetch={false}>{t("openExplorations")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/monitoring/demo?brandId=${overview.scope.brandId}`} prefetch={false}>{t("openDemo")}</Link>
          </Button>
          <Badge variant="outline">{overview.scope.brandName}</Badge>
        </div>
      </div>

      <OverviewScopeForm scope={parsed.data} t={t} />

      {overview.smallSample ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground" role="status">
          {t("smallSample")}
        </p>
      ) : null}

      {overview.viewStatus === "empty" ? (
        <section className="rounded-2xl border border-dashed px-6 py-10 text-center">
          <h2 className="font-medium">{t("emptyTitle")}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-muted-foreground">{t("emptyBody")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {overview.nextActions.map((action) => (
              <Button key={action.id} asChild variant={action.kind === "start_monitoring" ? "default" : "outline"}>
                <Link href={action.href} prefetch={false}>
                  {action.kind === "start_monitoring"
                    ? t("startMonitoring")
                    : action.kind === "view_tasks"
                      ? t("viewTasks")
                      : t("viewAnswers")}
                </Link>
              </Button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {([
              ["mentionRate", overview.metrics.mentioned] as const,
              ["recommendRate", overview.metrics.recommended] as const,
              ["officialCiteRate", overview.metrics.officialSiteCited] as const,
            ]).map(([key, metric]) => (
              <MetricCard
                key={key}
                title={t(key)}
                metric={metric}
                locale={locale}
                equalWeightHint={t("equalWeightHint", {
                  covered: formatNumber(locale, metric.coveredQuestions),
                  fixed: formatNumber(locale, metric.fixedQuestions),
                })}
                pooledHint={t("pooledHint", {
                  rate: formatRate(locale, metric.pooled.rate),
                  num: formatNumber(locale, metric.pooled.numerator),
                  den: formatNumber(locale, metric.pooled.denominator),
                })}
                unknownRatioLabel={t("unknownRatio", {
                  ratio: formatRate(locale, metric.unknownRatio),
                })}
                metricNa={t("metricNa")}
                officialNa={t("officialNa")}
              />
            ))}
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("perQuestion")}</h2>
              <Button asChild variant="outline" size="sm">
                <Link href={answersHref} prefetch={false}>{t("viewAnswers")}</Link>
              </Button>
            </div>
            <div className="overflow-x-auto rounded-2xl border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("question")}</th>
                    <th className="px-4 py-3 font-medium">{t("recommendRate")}</th>
                    <th className="px-4 py-3 font-medium">{t("samples")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.metrics.recommended.perQuestion.map((row) => (
                    <tr key={row.questionKey} className="border-t">
                      <td className="wrap-anywhere px-4 py-3">{row.questionText}</td>
                      <td className="px-4 py-3">
                        {row.denominator === 0
                          ? "N/A"
                          : `${formatNumber(locale, row.numerator)}/${formatNumber(locale, row.denominator)} (${formatRate(locale, row.rate)})`}
                      </td>
                      <td className="px-4 py-3">{formatNumber(locale, row.sampleIds.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("suggestions")}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/optimization?brandId=${overview.scope.brandId}`} prefetch={false}>
              {t("viewTasks")}
            </Link>
          </Button>
        </div>
        <TaskSummaryList items={overview.suggestions} messages={labels} empty={t("suggestionsEmpty")} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("activeTasks")}</h2>
        <TaskSummaryList items={overview.activeTasks} messages={labels} empty={t("activeTasksEmpty")} />
      </section>
    </div>
  );
}
