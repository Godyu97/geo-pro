import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listLeadQuality, type LeadQualityView } from "./quality-commands";
import { LeadObservationForm, LeadRuleActions, SaveLeadRuleForm } from "./quality-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function digits(value: number) {
  return String(value);
}

export async function generateMetadata() {
  const t = await getTranslator("leadQuality");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function LeadQualityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("leadQuality");
  const messages = getMessages(locale).leadQuality;
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const statusLabel = {
    unfrozen: t("statusUnfrozen"),
    qualified: t("statusQualified"),
    disqualified: t("statusDisqualified"),
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

  const listed = await listLeadQuality(connection, session.user.id, active.id);
  const quality: LeadQualityView | null = "error" in listed ? null : listed;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/reports/leads" prefetch={false}>{t("openLeads")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/reports?brandId=${active.id}`} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>
      <SaveLeadRuleForm locale={locale} messages={messages} brandId={active.id} />

      {quality ? (
        <p className="text-sm tabular-nums">{t("qualifiedCount", { count: digits(quality.qualifiedCount) })}</p>
      ) : null}

      {quality && quality.rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("emptyRules")}</p>
      ) : null}

      {quality && quality.rules.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("rulesHeading")}</h2>
          {quality.rules.map((rule) => {
            const judgments = quality.qualifications.filter((item) => item.ruleId === rule.id);
            return (
              <article key={rule.id} className="space-y-4 rounded-2xl border p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold tabular-nums">{t("versionLine", { version: digits(rule.version) })}</h3>
                  <p className="text-sm">{rule.frozen ? t("frozen") : t("unfrozen")}</p>
                </div>
                <ul className="space-y-1 text-sm">
                  <li>{t("needLine", { state: rule.requiresRealNeed ? t("switchOn") : t("switchOff") })}</li>
                  <li>{t("industryLine", { state: rule.requiresIndustry ? t("switchOn") : t("switchOff") })}</li>
                  <li>{t("followUpLine", { state: rule.requiresFollowUp ? t("switchOn") : t("switchOff") })}</li>
                </ul>
                <LeadRuleActions
                  locale={locale}
                  messages={messages}
                  brandId={active.id}
                  ruleId={rule.id}
                  frozen={rule.frozen}
                />
                {judgments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("emptyQualifications")}</p>
                ) : (
                  <div>
                    <h3 className="text-sm font-medium">{t("qualificationsHeading")}</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {judgments.map((item) => (
                        <li key={item.id} className="tabular-nums">{t("qualificationLine", {
                          version: digits(item.ruleVersion),
                          status: statusLabel[item.status],
                        })}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ) : null}

      <LeadObservationForm locale={locale} messages={messages} brandId={active.id} />

      {quality && quality.observations.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("emptyObservations")}</p>
      ) : null}
      {quality && quality.observations.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("observationsHeading")}</h2>
          {quality.observations.map((observation) => (
            <article key={observation.id} className="space-y-2 rounded-2xl border p-5 text-sm">
              {observation.identified.count === null ? null : (
                <p className="tabular-nums">{t("referralCount", { count: digits(observation.identified.count) })}</p>
              )}
              <p className="tabular-nums">{observation.identified.rate === null
                ? t("referralRateUnavailable")
                : t("referralRate", { rate: String(observation.identified.rate) })}</p>
              <p className="tabular-nums">{t("selfReportedLine", { count: digits(observation.selfReported) })}</p>
              <p>{t("selfReportedRate")}</p>
              <p className="tabular-nums">{t("crawlerLine", { visits: digits(observation.crawlerVisits) })}</p>
              <p className="tabular-nums">{t("citationLine", { citations: digits(observation.answerCitations) })}</p>
              <p>{t("notIncluded")}</p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
