import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { acknowledgeQualityAlertAction, snoozeQualityAlertAction } from "./actions";
import { listQualityAlerts } from "./commands";
import type { QualityAlertView } from "./commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "ALERT_STATE_CONFLICT"] as const;
const linkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";
const emptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-sm leading-7 break-words text-muted-foreground";
const actionClass = "h-auto min-h-9 max-w-full whitespace-normal";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function showTime(locale: Locale, value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(locale, date);
}

export async function generateMetadata() {
  const t = await getTranslator("qualityAlerts");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function QualityAlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("qualityAlerts");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const kindLabel = { data_quality: t("kindDataQuality"), trend: t("kindTrend") } as const;
  const statusLabel = {
    open: t("statusOpen"),
    acknowledged: t("statusAcknowledged"),
    snoozed: t("statusSnoozed"),
    resolved: t("statusResolved"),
  } as const;
  const reasonLabel = {
    coverage_insufficient: t("reasonCoverage"),
    citation_field_changed: t("reasonCitation"),
    mode_changed: t("reasonMode"),
    recommendation_drop: t("reasonTrend"),
  } as const;
  const related = (
    <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
      <Link href="/dashboard/monitoring/plans" prefetch={false} className={linkClass}>{t("backPlans")}</Link>
      <Link href="/dashboard/monitoring/overview" prefetch={false} className={linkClass}>{t("backOverview")}</Link>
    </nav>
  );

  if (!active) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{t("title")}</h1>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
          {related}
        </header>
        <Button asChild className={actionClass}>
          <Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link>
        </Button>
      </div>
    );
  }

  const listed = await listQualityAlerts(connection, session.user.id, active.id);
  const failed = "error" in listed ? listed.error : undefined;
  const alerts: QualityAlertView[] = "error" in listed ? [] : listed.alerts;

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{t("title")}</h1>
        <p className="text-sm font-medium wrap-anywhere">{active.name}</p>
      </header>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm leading-6 wrap-anywhere">{t(errorCode)}</p>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm leading-6 wrap-anywhere">{t(failed)}</p>
      ) : null}

      {failed ? null : alerts.length === 0 ? (
        <p className={emptyClass}>{t("empty")}</p>
      ) : alerts.map((alert) => (
        <section key={alert.id} aria-labelledby={`alert-${alert.id}`} className={panelClass}>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
            <h2 id={`alert-${alert.id}`} className="text-lg font-semibold">{kindLabel[alert.kind]}</h2>
            <p className="text-sm">{statusLabel[alert.status]}</p>
          </div>
          <p className="text-sm leading-7 wrap-anywhere">{reasonLabel[alert.reason]}</p>
          {alert.claimBrandDecline ? null : (
            <p className="text-sm leading-7 text-muted-foreground wrap-anywhere">{t("noDecline")}</p>
          )}
          <p className="font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{t("window", { id: alert.windowId })}</p>
          <p className="text-sm">{t("occurrences", { count: formatNumber(locale, alert.events.length) })}</p>
          <ul className="min-w-0 space-y-1 text-sm text-muted-foreground">
            {alert.events.map((event) => (
              <li key={event.id} className="[overflow-wrap:anywhere]">{t("occurredAt", { time: showTime(locale, event.occurredAt) })}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {alert.status === "open" ? (
              <form action={acknowledgeQualityAlertAction}>
                <input type="hidden" name="alertId" value={alert.id} />
                <Button type="submit" className={actionClass}>{t("acknowledge")}</Button>
              </form>
            ) : null}
            {alert.status === "open" || alert.status === "acknowledged" ? (
              <form action={snoozeQualityAlertAction}>
                <input type="hidden" name="alertId" value={alert.id} />
                <Button type="submit" variant="outline" className={actionClass}>{t("snooze")}</Button>
              </form>
            ) : null}
          </div>
        </section>
      ))}

      <div className="min-w-0 space-y-3">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("inAppOnly")}</p>
        {related}
      </div>
    </div>
  );
}
