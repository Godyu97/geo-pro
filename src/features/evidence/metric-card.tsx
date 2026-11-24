import { formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";

import type { RateBreakdown } from "./metrics.ts";

function formatRate(locale: Locale, value: number | null) {
  if (value == null) return "N/A";
  return formatPercent(locale, value);
}

export function MetricCard({
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
  const value = metric.status === "na" ? "N/A" : formatRate(locale, metric.equalWeight);
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5 shadow-none">
      <h3 className="break-words text-sm font-medium">{title}</h3>
      <p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 break-words text-xs leading-6 text-muted-foreground">
        {metric.status === "na"
          ? (metric.reason === "official-website-not-applicable" ? officialNa : metricNa)
          : equalWeightHint}
      </p>
      {metric.status === "ready" && metric.pooled.rate != null ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">{pooledHint}</p>
      ) : null}
      {metric.unknownRatio != null ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">{unknownRatioLabel}</p>
      ) : null}
    </section>
  );
}
