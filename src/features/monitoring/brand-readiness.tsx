import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { CapabilityRetryButton } from "../capabilities/retry-button";
import { formatMinorUnits } from "./format";
import { minimumNaturalQuestions, type ReadinessChannel, type ReadinessEligibility } from "./readiness";
import { readBrandMonitoringReadiness } from "./service";

const eligibilityKey: Record<ReadinessEligibility, "eligible" | "unverified" | "expired" | "degraded" | "disabled" | "missing"> = {
  eligible: "eligible",
  unverified: "unverified",
  expired: "expired",
  degraded: "degraded",
  disabled: "disabled",
  missing: "missing",
};

function ChannelList({
  title,
  empty,
  channels,
  versionLabel,
  statusLabel,
}: {
  title: string;
  empty: string;
  channels: ReadinessChannel[];
  versionLabel: (version: number) => string;
  statusLabel: (eligibility: ReadinessEligibility) => string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="font-medium">{title}</h3>
      {channels.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
        <ul className="space-y-1">
          {channels.map((channel) => (
            <li key={channel.channelId} className="wrap-anywhere">
              {channel.displayName} · {versionLabel(channel.version)} · {statusLabel(channel.eligibility)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function BrandMonitoringReadiness({
  ownerId,
  brand,
  historical,
}: {
  ownerId: string;
  brand: { id: string; status: "active" | "archived"; version: number; website: string };
  historical: boolean;
}) {
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const monitoring = await getTranslator("monitoring");
  const result = await readBrandMonitoringReadiness(ownerId, brand, historical);
  if (result.kind === "unavailable") {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("readinessUnavailable")}</p>
        <CapabilityRetryButton label={monitoring("retry")} />
        <p className="break-all text-muted-foreground">{monitoring("trace", { id: result.traceId })}</p>
      </div>
    );
  }
  const { report, promptSet, grant, facts, protocol } = result;
  const versionLabel = (version: number) => t("readinessChannelVersion", { version: formatNumber(locale, version) });
  const statusLabel = (eligibility: ReadinessEligibility) => monitoring(eligibilityKey[eligibility]);
  const nextHref = {
    "add-questions": `/dashboard/brands/${brand.id}/questions`,
    "review-inactive": `/dashboard/brands/${brand.id}/questions`,
    "verify-channel": "/dashboard/settings#monitoring-capabilities",
    "choose-channel": "/dashboard/settings#monitoring-capabilities",
    "request-quota": "/dashboard/settings#pilot-quotas",
    archived: `/dashboard/brands/${brand.id}`,
  } as const;
  const nextCopy = {
    "add-questions": "readinessNextQuestions",
    "review-inactive": "readinessNextInactive",
    "verify-channel": "readinessNextExpired",
    "choose-channel": "readinessNextChannel",
    "request-quota": "readinessNextQuota",
    archived: "readinessArchived",
  } as const;
  return (
    <section aria-labelledby="monitoring-readiness" className="space-y-3 text-sm">
      <h2 id="monitoring-readiness" className="font-medium">{t("readinessTitle")}</h2>
      <p className="leading-6 text-muted-foreground">{t("readinessDescription")}</p>
      {!historical && <p>{t("readinessEntity", { version: formatNumber(locale, brand.version) })}</p>}
      {report.officialCitation === "not-applicable" && <p>{t("websiteNotApplicable")}</p>}
      {historical && <p>{t("readinessHistorical")}</p>}
      <p>{t("readinessNatural", {
        natural: formatNumber(locale, promptSet?.naturalCount ?? 0),
        required: formatNumber(locale, minimumNaturalQuestions),
        confirmed: formatNumber(locale, promptSet?.confirmedCount ?? 0),
      })}</p>
      {promptSet ? (
        <p>{t("readinessPromptSet", {
          version: formatNumber(locale, promptSet.version),
          region: promptSet.region,
          language: promptSet.language,
        })}</p>
      ) : <p>{t("readinessNoPromptSet")}</p>}
      <ChannelList
        title={t("readinessOfficial")}
        empty={t("readinessNoChannelKind")}
        channels={report.official}
        versionLabel={versionLabel}
        statusLabel={statusLabel}
      />
      <ChannelList
        title={t("readinessManual")}
        empty={t("readinessNoChannelKind")}
        channels={report.manual}
        versionLabel={versionLabel}
        statusLabel={statusLabel}
      />
      {grant.state === "active" && grant.currency && grant.version !== null ? (
        <p>{t("readinessQuota", {
          version: formatNumber(locale, grant.version),
          count: formatNumber(locale, grant.countRemaining),
          budget: formatMinorUnits(locale, grant.budgetRemainingMinor, grant.currency),
        })}</p>
      ) : <p>{t("readinessQuotaMissing")}</p>}
      <p>{t("readinessFacts", {
        approved: formatNumber(locale, facts.approved),
        pending: formatNumber(locale, facts.pending),
        expired: formatNumber(locale, facts.expired),
        other: formatNumber(locale, facts.other),
      })}</p>
      <p className="leading-6 text-muted-foreground">{t("readinessFactsNote")}</p>
      {protocol ? (
        <p>{t("readinessProtocol", {
          version: formatNumber(locale, protocol.version),
          region: protocol.targetRegion,
          timezone: protocol.timezone,
        })}</p>
      ) : <p>{t("readinessNoProtocol")}</p>}
      {report.next.length > 0 && (
        <ul className="space-y-2">
          {report.next.map((item) => (
            <li key={item}>
              <Link className="underline underline-offset-4" href={nextHref[item]} prefetch={false}>{t(nextCopy[item])}</Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link className="underline underline-offset-4" href={`/dashboard/brands/${brand.id}/facts`} prefetch={false}>{t("readinessOpenFacts")}</Link>
        <Link className="underline underline-offset-4" href="/dashboard/settings#monitoring-capabilities" prefetch={false}>{t("readinessOpenChannels")}</Link>
        <Link className="underline underline-offset-4" href="/dashboard/settings#pilot-quotas" prefetch={false}>{t("readinessOpenQuota")}</Link>
        <Link className="underline underline-offset-4" href="/dashboard/monitoring/protocols" prefetch={false}>{t("readinessOpenProtocols")}</Link>
      </div>
      {report.canConfirm && (
        <Button asChild>
          <Link href={`/dashboard/monitoring/new?brandId=${brand.id}`} prefetch={false}>{t("readinessConfirm")}</Link>
        </Button>
      )}
    </section>
  );
}
