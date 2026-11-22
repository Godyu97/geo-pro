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

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listQualityAlerts(connection, session.user.id, active.id);
  const alerts: QualityAlertView[] = "error" in listed ? [] : listed.alerts;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/monitoring/overview" prefetch={false}>{t("backOverview")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("inAppOnly")}</p>

      {alerts.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : alerts.map((alert) => (
        <section key={alert.id} className="space-y-3 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{kindLabel[alert.kind]}</h2>
            <p className="text-sm">{statusLabel[alert.status]}</p>
          </div>
          <p className="text-sm leading-7">{reasonLabel[alert.reason]}</p>
          {alert.claimBrandDecline ? null : (
            <p className="text-sm leading-7 text-muted-foreground">{t("noDecline")}</p>
          )}
          <p className="text-sm text-muted-foreground">{t("window", { id: alert.windowId })}</p>
          <p className="text-sm">{t("occurrences", { count: formatNumber(locale, alert.events.length) })}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {alert.events.map((event) => (
              <li key={event.id}>{t("occurredAt", { time: showTime(locale, event.occurredAt) })}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {alert.status === "open" ? (
              <form action={acknowledgeQualityAlertAction}>
                <input type="hidden" name="alertId" value={alert.id} />
                <Button type="submit">{t("acknowledge")}</Button>
              </form>
            ) : null}
            {alert.status === "open" || alert.status === "acknowledged" ? (
              <form action={snoozeQualityAlertAction}>
                <input type="hidden" name="alertId" value={alert.id} />
                <Button type="submit" variant="outline">{t("snooze")}</Button>
              </form>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
