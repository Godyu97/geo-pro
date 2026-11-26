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
  judgedLabel,
  citationLabel,
  metricNa,
  officialNa,
  ownedNa,
  citationNa,
}: {
  title: string;
  metric: RateBreakdown;
  locale: Locale;
  equalWeightHint: string;
  pooledHint: string;
  unknownRatioLabel: string;
  judgedLabel: string | null;
  citationLabel: string | null;
  metricNa: string;
  officialNa: string;
  ownedNa: string;
  citationNa: string;
}) {
  const value = metric.status === "na" ? "N/A" : formatRate(locale, metric.equalWeight);
  const reasons: Record<string, string> = {
    "official-website-not-applicable": officialNa,
    "no-judgable-owned-citations": ownedNa,
    "no-complete-citations": citationNa,
  };
  const na = reasons[metric.reason ?? ""] ?? metricNa;
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5 shadow-none">
      <h3 className="break-words text-sm font-medium">{title}</h3>
      <p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 break-words text-xs leading-6 text-muted-foreground">
        {metric.status === "na" ? na : equalWeightHint}
      </p>
      {metric.status === "ready" && metric.pooled.rate != null ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">{pooledHint}</p>
      ) : null}
      {judgedLabel ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">{judgedLabel}</p>
      ) : null}
      {metric.unknownRatio != null ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">{unknownRatioLabel}</p>
      ) : null}
      {citationLabel ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">{citationLabel}</p>
      ) : null}
    </section>
  );
}

export function CoverageCard({
  title,
  validText,
  eligibleText,
  counts,
  network,
}: {
  title: string;
  validText: string | null;
  eligibleText: string | null;
  counts: string | null;
  network: string | null;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border bg-card p-5 shadow-none">
      <h3 className="break-words text-sm font-medium">{title}</h3>
      {validText ? <p className="mt-3 break-words text-sm leading-6 tabular-nums">{validText}</p> : null}
      {eligibleText ? <p className="mt-2 break-words text-sm leading-6 tabular-nums">{eligibleText}</p> : null}
      {counts ? <p className="mt-2 break-words text-xs leading-6 text-muted-foreground">{counts}</p> : null}
      {network ? <p className="mt-1 break-words text-xs leading-6 text-muted-foreground">{network}</p> : null}
    </section>
  );
}

export function CollectionLine({ capture, expired }: { capture: string; expired: string | null }) {
  return (
    <p className="break-words text-sm leading-6" role="status">
      <span>{capture}</span>
      {expired ? <span className="ml-2 rounded-md border px-2 py-0.5 text-xs">{expired}</span> : null}
    </p>
  );
}
