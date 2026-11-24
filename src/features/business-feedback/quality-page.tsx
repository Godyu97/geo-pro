import Link from "next/link";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listLeadQuality } from "./quality-commands";
import { LeadObservationForm, LeadRuleActions, SaveLeadRuleForm } from "./quality-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const qualityPath = "/dashboard/reports/lead-quality";
const reportsPath = "/dashboard/reports";
const firstCriterionId = "lead-rule-real-need";
const versionsId = "lead-rule-versions";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const brand = await new BrandDao(connection).active(ownerId);
    if (!brand) return { kind: "noBrand" } as const;
    const quality = await listLeadQuality(connection, ownerId, brand.id);
    if ("error" in quality && quality.error) return { kind: "error", code: quality.error } as const;
    return { kind: "ready", brand, quality } as const;
  } catch {
    console.error("lead-quality-page-read-unavailable");
    return { kind: "error", code: "SERVICE_UNAVAILABLE" } as const;
  }
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
  const workspace = await readWorkspace(session.user.id);
  const ready = workspace.kind === "ready" ? workspace : null;
  const reportsHref = ready ? `${reportsPath}?brandId=${encodeURIComponent(ready.brand.id)}` : reportsPath;
  const hasRules = Boolean(ready?.quality.rules.length);
  const number = (value: number) => formatNumber(locale, value);
  const statusLabel = {
    unfrozen: t("statusUnfrozen"),
    qualified: t("statusQualified"),
    disqualified: t("statusDisqualified"),
  } as const;

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {ready ? <p className={summaryClass}>{ready.brand.name}</p> : null}
        {workspace.kind === "error" ? (
          <p role="alert" className={summaryClass}>{t(workspace.code)}</p>
        ) : (
          <p className={summaryClass}>{t(workspace.kind === "noBrand" ? "noBrand" : "description")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {workspace.kind === "error" && workspace.code === "SERVICE_UNAVAILABLE" ? (
            <Button asChild className={actionClass}><a href={qualityPath}>{t("reload")}</a></Button>
          ) : null}
          {workspace.kind === "noBrand" || (workspace.kind === "error" && workspace.code === "NOT_FOUND") ? (
            <Button asChild className={actionClass}><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
          ) : null}
          {ready ? (
            <>
              <Button asChild className={actionClass}>
                <a href={`#${hasRules ? versionsId : firstCriterionId}`}>{t(hasRules ? "viewRules" : "startRule")}</a>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/leads" prefetch={false}>{t("openLeads")}</Link>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/lead-suggestions" prefetch={false}>{t("openSuggestions")}</Link>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={reportsHref} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </header>

      {ready ? (
        <Fragment key={ready.brand.id}>
          {isKnownError(errorCode) ? (
            <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-sm">{t(errorCode)}</p>
          ) : null}
          {!hasRules ? (
            <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("emptyRules")}</p>
          ) : null}
          <SaveLeadRuleForm locale={locale} messages={messages} brandId={ready.brand.id} firstCriterionId={firstCriterionId} />
          <p className="text-sm tabular-nums">{t("qualifiedCount", { count: number(ready.quality.qualifiedCount) })}</p>
          {hasRules ? (
            <section aria-labelledby={versionsId} className="space-y-4">
              <h2 id={versionsId} tabIndex={-1} className="scroll-mt-4 text-lg font-semibold focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                {t("rulesHeading")}
              </h2>
              {ready.quality.rules.map((rule) => {
                const judgments = ready.quality.qualifications.filter((item) => item.ruleId === rule.id);
                return (
                  <article key={rule.id} className="min-w-0 space-y-4 rounded-2xl border bg-card p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h3 className="text-base font-semibold tabular-nums">{t("versionLine", { version: rule.version })}</h3>
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
                      brandId={ready.brand.id}
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
                              version: item.ruleVersion,
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

          <LeadObservationForm locale={locale} messages={messages} brandId={ready.brand.id} />

          {ready.quality.observations.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("emptyObservations")}</p>
          ) : (
            <section aria-labelledby="lead-observations" className="space-y-4">
              <h2 id="lead-observations" className="text-lg font-semibold">{t("observationsHeading")}</h2>
              {ready.quality.observations.map((observation) => (
                <article key={observation.id} className="min-w-0 space-y-2 rounded-2xl border bg-card p-5 text-sm">
                  {observation.identified.count === null ? null : (
                    <p className="tabular-nums">{t("referralCount", { count: number(observation.identified.count) })}</p>
                  )}
                  {observation.identified.rate === null ? (
                    <div>
                      <p>{t("referralRateUnavailable")}</p>
                      <p className="text-muted-foreground">{t("referralRateReason")}</p>
                    </div>
                  ) : (
                    <p className="tabular-nums">{t("referralRate", { rate: formatPercent(locale, observation.identified.rate) })}</p>
                  )}
                  <p className="tabular-nums">{t("selfReportedLine", { count: number(observation.selfReported) })}</p>
                  <p>{t("selfReportedRate")}</p>
                  <p className="tabular-nums">{t("crawlerLine", { visits: number(observation.crawlerVisits) })}</p>
                  <p className="tabular-nums">{t("citationLine", { citations: number(observation.answerCitations) })}</p>
                  <p>{t("notIncluded")}</p>
                </article>
              ))}
            </section>
          )}
        </Fragment>
      ) : null}
    </div>
  );
}
