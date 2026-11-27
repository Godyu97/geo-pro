import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { viewWhitelabelShare } from "./share-commands.ts";
import { formatShareSample } from "./share-contracts.ts";

const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

function ShareTime({ value, locale }: { value: string; locale: Locale }) {
  const date = new Date(value);
  const label = Number.isNaN(date.getTime()) ? value : `${formatDateTime(locale, date, "UTC")} UTC`;
  return <time dateTime={value} title={value}>{label}</time>;
}

export async function generateMetadata() {
  const t = await getTranslator("shares");
  return { title: t("previewTitle"), robots: { index: false, follow: false } };
}

export default async function SharePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("shares");
  const { id } = await params;
  const parsed = brandIdSchema.safeParse(id);

  let share = null;
  let unavailable = false;
  if (parsed.success) {
    try {
      const result = await viewWhitelabelShare(getConnection(), user.id, parsed.data);
      if ("share" in result) share = result.share;
    } catch {
      unavailable = true;
    }
  }

  const trackText = share
    ? share.track === "model_api"
      ? t("trackModelApi")
      : share.track === "consumer_ui"
        ? t("trackConsumerUi")
        : share.track
    : "";
  const gradeText = share
    ? share.grade === "exploratory"
      ? t("gradeExploratory")
      : share.grade === "incomparable"
        ? t("gradeIncomparable")
        : share.grade
    : "";

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("previewTitle")}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("previewDescription")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/reports/shares" prefetch={false}>{t("backShares")}</Link>
          </Button>
          <Button asChild variant="ghost" className={actionClass}>
            <Link href="/dashboard/reports" prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </header>
      {!share ? (
        <div role="alert" className="max-w-2xl rounded-xl border border-dashed bg-card p-5 text-sm leading-6 text-destructive">
          {unavailable ? t("SERVICE_UNAVAILABLE") : t("NOT_FOUND")}
        </div>
      ) : (
        <article aria-labelledby="whitelabel-preview-brand" className="min-w-0 max-w-3xl space-y-5 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="whitelabel-preview-brand" className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">
              {share.brandName}
            </h2>
            <Badge variant="secondary">{t("statusActive")}</Badge>
          </div>
          {share.sampleSummary?.sourceMissing && (
            <p role="note" className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
              {t("sourceMissingBadge")}
            </p>
          )}
          <dl className="grid gap-4 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("shareIdLabel")}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]"><bdi translate="no">{share.id}</bdi></dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("snapshotIdLabel")}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">
                {share.snapshotId ? <bdi translate="no">{share.snapshotId}</bdi> : t("legacyShare")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("track")}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">
                {trackText} · <bdi translate="no">{share.track}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("grade")}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">
                {gradeText} · <bdi translate="no">{share.grade}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("sampleSize")}</dt>
              <dd className="font-medium tabular-nums">{formatShareSample(share.sampleSize)}</dd>
              {share.sampleSummary && (
                <dd className="mt-1 text-muted-foreground tabular-nums">
                  {t("sampleBreakdown", {
                    common: formatShareSample(share.sampleSummary.commonQueryCount),
                    frozen: formatShareSample(share.sampleSummary.frozenQueryCount),
                    before: formatShareSample(share.sampleSummary.beforeSampleCount),
                    after: formatShareSample(share.sampleSummary.afterSampleCount),
                  })}
                </dd>
              )}
            </div>
            {share.sampleSummary && (
              <div>
                <dt className="text-muted-foreground">{t("intentLabel")}</dt>
                <dd className="font-medium">
                  {share.sampleSummary.intent === "business_loop" ? t("intentBusinessLoop") : t("intentDiagnostic")}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{t("expiresAt")}</dt>
              <dd><ShareTime value={share.expiresAt} locale={locale} /></dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("createdAt")}</dt>
              <dd><ShareTime value={share.createdAt} locale={locale} /></dd>
            </div>
          </dl>
          <section aria-labelledby="whitelabel-preview-limitations" className="space-y-2">
            <h3 id="whitelabel-preview-limitations" className="text-base font-semibold">{t("limitations")}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              {share.limitations.map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}
              <li>{t("causalityNotice")}</li>
            </ul>
          </section>
        </article>
      )}
    </div>
  );
}
