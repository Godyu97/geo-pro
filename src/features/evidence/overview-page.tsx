import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
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

const actionClass = "h-auto max-w-full whitespace-normal text-left";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function relatedLinks(
  t: Awaited<ReturnType<typeof getTranslator<"evidenceOverview">>>,
  brandId?: string,
) {
  const brandQuery = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
  return [
    { href: "/dashboard/monitoring/plans", label: t("openPlans") },
    { href: "/dashboard/monitoring/alerts", label: t("openAlerts") },
    { href: "/dashboard/monitoring/capture", label: t("openCapture") },
    { href: "/dashboard/monitoring/protocols", label: t("openProtocols") },
    { href: `/dashboard/monitoring/explorations${brandQuery}`, label: t("openExplorations") },
    { href: `/dashboard/monitoring/demo${brandQuery}`, label: t("openDemo") },
  ] as const;
}

function EvidenceCanvas({
  title,
  summary,
  primary,
  relatedLabel,
  related,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  related: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
          {related.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
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

  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );

  if (!brandId) {
    return (
      <EvidenceCanvas
        title={t("title")}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={relatedLinks(t)}
      />
    );
  }

  const parsed = overviewScopeFromSearch(params, { brandId, sourceMode: "model_api" });
  const related = relatedLinks(t, brandId);
  if (!parsed.success) {
    return (
      <EvidenceCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7">{t("invalidScope")}</p>}
        primary={active?.id ? (
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`/dashboard/monitoring/overview?brandId=${active.id}`} prefetch={false}>{t("clearFilters")}</Link>
          </Button>
        ) : undefined}
        relatedLabel={t("relatedEntries")}
        related={related}
      />
    );
  }

  const overview = await readEvidenceOverview(connection, session.user.id, parsed.data);
  if ("error" in overview) {
    return (
      <EvidenceCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7">{te(overview.error)}</p>}
        primary={overview.error === "NOT_FOUND" ? brandsAction : undefined}
        relatedLabel={t("relatedEntries")}
        related={related}
      />
    );
  }

  const answersHref = overviewScopePath("/dashboard/monitoring/answers", parsed.data);
  const hasSamples = overview.viewStatus !== "empty";

  return (
    <EvidenceCanvas
      title={t("title")}
      summary={(
        <>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
          <p className="max-w-full break-words text-sm font-medium">{overview.scope.brandName}</p>
        </>
      )}
      primary={hasSamples ? (
        <Button asChild className={actionClass}>
          <Link href={answersHref} prefetch={false}>{t("viewAnswers")}</Link>
        </Button>
      ) : undefined}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      <OverviewScopeForm scope={parsed.data} t={t} />

      {overview.smallSample ? (
        <p className="break-words rounded-xl border border-dashed bg-card px-4 py-3 text-sm leading-6 text-muted-foreground" role="status">
          {t("smallSample")}
        </p>
      ) : null}

      {overview.viewStatus === "empty" ? (
        <section className="min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-center sm:px-6 sm:py-10">
          <h2 className="break-words font-medium">{t("emptyTitle")}</h2>
          <p className="mx-auto mt-2 max-w-lg break-words text-sm leading-7 text-muted-foreground">{t("emptyBody")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {overview.nextActions.map((action) => (
              <Button key={action.id} asChild variant={action.kind === "start_monitoring" ? "default" : "outline"} className={actionClass}>
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
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
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

          <section className="min-w-0 space-y-3">
            <h2 className="break-words text-lg font-semibold">{t("perQuestion")}</h2>
            <div className="max-w-full min-w-0 overflow-x-auto rounded-2xl border bg-card">
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
                      <td className="px-4 py-3 whitespace-nowrap">
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

      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 className="break-words text-lg font-semibold">{t("suggestions")}</h2>
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`/dashboard/optimization?brandId=${overview.scope.brandId}`} prefetch={false}>
              {t("viewTasks")}
            </Link>
          </Button>
        </div>
        <TaskSummaryList items={overview.suggestions} messages={labels} empty={t("suggestionsEmpty")} />
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="break-words text-lg font-semibold">{t("activeTasks")}</h2>
        <TaskSummaryList items={overview.activeTasks} messages={labels} empty={t("activeTasksEmpty")} />
      </section>
    </EvidenceCanvas>
  );
}
