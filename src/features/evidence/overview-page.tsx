import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readEvidenceOverview } from "./overview-commands";
import { overviewScopeSchema } from "./overview-contracts";
import type { RateBreakdown } from "./metrics";

function formatRate(locale: Locale, value: number | null) {
  if (value == null) return "N/A";
  return formatPercent(locale, value);
}

function MetricCard({
  title,
  metric,
  locale,
  equalWeightHint,
  pooledHint,
  unknownRatioLabel,
  metricNa,
  officialNa,
}: {
  title: string;
  metric: RateBreakdown;
  locale: Locale;
  equalWeightHint: string;
  pooledHint: string;
  unknownRatioLabel: string;
  metricNa: string;
  officialNa: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-none">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-3 text-3xl font-semibold tracking-tight">
        {metric.status === "na" ? "N/A" : formatRate(locale, metric.equalWeight)}
      </p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        {metric.status === "na"
          ? (metric.reason === "official-website-not-applicable" ? officialNa : metricNa)
          : equalWeightHint}
      </p>
      {metric.status === "ready" && metric.pooled.rate != null ? (
        <p className="mt-2 text-xs text-muted-foreground">{pooledHint}</p>
      ) : null}
      {metric.unknownRatio != null ? (
        <p className="mt-1 text-xs text-muted-foreground">{unknownRatioLabel}</p>
      ) : null}
    </section>
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
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);

  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const sourceMode = typeof params.sourceMode === "string" ? params.sourceMode : "model_api";
  const region = typeof params.region === "string" ? params.region : undefined;
  const requestedNetworkMode = typeof params.requestedNetworkMode === "string"
    ? params.requestedNetworkMode
    : undefined;

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

  const parsed = overviewScopeSchema.safeParse({
    brandId,
    sourceMode,
    region,
    requestedNetworkMode,
  });
  if (!parsed.success) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("invalidScope")}</p>
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

  const answersHref = `/dashboard/monitoring/answers?brandId=${overview.scope.brandId}&sourceMode=${overview.scope.sourceMode}`;

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

      <form className="flex flex-wrap gap-3 rounded-2xl border bg-secondary/40 p-4" method="get">
        <input type="hidden" name="brandId" value={overview.scope.brandId} />
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">{t("track")}</span>
          <select
            name="sourceMode"
            defaultValue={overview.scope.sourceMode}
            className="h-10 rounded-md border bg-background px-3"
          >
            <option value="model_api">{t("trackApi")}</option>
            <option value="consumer_ui">{t("trackConsumer")}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">{t("region")}</span>
          <input
            name="region"
            defaultValue={overview.scope.region ?? ""}
            maxLength={2}
            placeholder="CN"
            className="h-10 w-24 rounded-md border bg-background px-3"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" variant="outline">{t("applyFilters")}</Button>
        </div>
      </form>

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
                  {action.kind === "start_monitoring" ? t("startMonitoring") : t("viewAnswers")}
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
        {overview.suggestions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
            {t("suggestionsEmpty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {overview.suggestions.map((item) => (
              <li key={item.id} className="rounded-xl border px-4 py-3 text-sm">
                <Link href={item.href} prefetch={false} className="font-medium underline-offset-4 hover:underline">
                  {item.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.priorityBucket} · {item.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
