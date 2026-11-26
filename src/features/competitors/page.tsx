import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { BrandDao } from "../brands/dao";
import {
  briefStatusAction,
  createContentBriefFromResearchAction,
  createOptimizationTaskFromResearchAction,
  inspectCitationAction,
  proposeBriefAction,
  recordMentionsAction,
  saveCompetitorSetAction,
} from "./actions";
import { readCompetitorWorkspace } from "./commands";

const actionClass = "h-auto max-w-full whitespace-normal text-left";
const linkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";
const emptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-sm leading-7 break-words text-muted-foreground";
const fieldClass = "w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2";
const selectWrap = "grid min-w-0 grid-cols-[minmax(0,1fr)]";

const sourceState = {
  observed: "state_observed",
  limited: "state_limited",
  resolved: "state_resolved",
  unknown: "state_unknown",
} as const;

function shareText(locale: Locale, share: number | null, na: string) {
  return share === null ? na : formatPercent(locale, share);
}

function citationOption(url: string) {
  if (url.length <= 72) return url;
  return `${url.slice(0, 40)}…${url.slice(-24)}`;
}

function knownError(error: string) {
  if (error === "NOT_FOUND" || error === "INVALID_INPUT" || error === "OPERATION_CONFLICT") return error;
  return "INVALID_INPUT";
}

function Canvas({
  title,
  summary,
  primary,
  relatedLabel,
  answersHref,
  overviewHref,
  answersLabel,
  overviewLabel,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  answersHref: string;
  overviewHref: string;
  answersLabel: string;
  overviewLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{title}</h1>
        {summary}
        {primary}
        <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
          <Link href={answersHref} prefetch={false} className={linkClass}>{answersLabel}</Link>
          <Link href={overviewHref} prefetch={false} className={linkClass}>{overviewLabel}</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

export async function generateMetadata() {
  const t = await getTranslator("competitorAnalysis");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CompetitorAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("competitorAnalysis");
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const requestedBrand = typeof params.brandId === "string" ? params.brandId : undefined;
  const brandId = requestedBrand ?? active?.id;
  const version = typeof params.version === "string" && /^[1-9]\d*$/.test(params.version)
    ? Number(params.version)
    : undefined;
  const error = typeof params.error === "string" ? params.error : "";
  const reason = typeof params.reason === "string" ? params.reason : "";
  const relatedLabel = t("relatedEntries");
  const answersHref = brandId ? `/dashboard/monitoring/answers?brandId=${brandId}` : "/dashboard/monitoring/answers";
  const overviewHref = brandId ? `/dashboard/monitoring/overview?brandId=${brandId}` : "/dashboard/monitoring/overview";
  const canvasLinks = {
    relatedLabel,
    answersHref,
    overviewHref,
    answersLabel: t("backAnswers"),
    overviewLabel: t("backOverview"),
  };

  if (!brandId) {
    return (
      <Canvas
        title={t("title")}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
          </Button>
        )}
        {...canvasLinks}
      />
    );
  }

  const workspace = await readCompetitorWorkspace(connection, session.user.id, brandId, version);
  if ("error" in workspace) {
    const recoveryHref = active ? "/dashboard/monitoring/competitors" : "/dashboard/brands";
    return (
      <Canvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7 wrap-anywhere">{t(knownError(workspace.error))}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <Link href={recoveryHref} prefetch={false}>{active ? t("currentBrand") : t("goBrands")}</Link>
          </Button>
        )}
        {...canvasLinks}
        answersHref={active ? `/dashboard/monitoring/answers?brandId=${active.id}` : "/dashboard/monitoring/answers"}
        overviewHref={active ? `/dashboard/monitoring/overview?brandId=${active.id}` : "/dashboard/monitoring/overview"}
      />
    );
  }

  const notice = reason === "copied_replacement"
    ? t("copied")
    : reason === "missing_evidence"
      ? t("missingEvidence")
      : error
        ? t(knownError(error))
        : "";
  const brandName = active?.id === brandId ? active.name : "";

  return (
    <Canvas
      title={t("title")}
      summary={(
        <>
          {brandName ? <p className="text-sm font-medium wrap-anywhere">{brandName}</p> : null}
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </>
      )}
      {...canvasLinks}
    >
      {notice ? <p role="alert" className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm leading-6 wrap-anywhere">{notice}</p> : null}

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{t("sets")}</h2>
        {workspace.sets.length === 0 ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("setsEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-2 text-sm">
            {workspace.sets.map((set) => (
              <li key={set.id} className="min-w-0">
                <Link
                  href={`/dashboard/monitoring/competitors?brandId=${brandId}&version=${set.version}`}
                  prefetch={false}
                  className="underline-offset-4 hover:underline"
                  aria-current={workspace.selected?.id === set.id ? "page" : undefined}
                >
                  {t("version", { version: set.version })}
                </Link>
                <p className="text-muted-foreground">
                  {set.labels.length === 0 ? t("shareNa") : set.labels.map((label) => (
                    <span key={label} className="mr-2 inline-block max-w-full align-top [overflow-wrap:anywhere]">{label}</span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={saveCompetitorSetAction} className="space-y-3">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("labels")}</span>
            <textarea name="labels" rows={3} className={fieldClass} />
          </label>
          <Button type="submit" className={actionClass}>{t("saveSet")}</Button>
        </form>
      </section>

      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{t("share")}</h2>
          {workspace.selected ? (
            <span className="text-sm text-muted-foreground">{t("version", { version: workspace.selected.version })}</span>
          ) : null}
        </div>
        {workspace.truncated ? <p className={emptyClass}>{t("truncated")}</p> : null}
        {!workspace.truncated && workspace.rows.length === 0 ? (
          <p className={emptyClass}>{t("setsEmpty")}</p>
        ) : null}
        {workspace.rows.length > 0 ? (
          <>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("shareMethodNote")}</p>
            <p className="text-sm leading-6 text-muted-foreground tabular-nums">
              {t("shareSummary", {
                answers: formatNumber(locale, workspace.summary.commonAnswerCount),
                covered: formatNumber(locale, workspace.summary.coveredQuestions),
                equalWeight: formatNumber(locale, workspace.summary.equalWeightQuestions),
                zero: formatNumber(locale, workspace.summary.zeroMentionQuestions),
                excluded: formatNumber(locale, workspace.summary.excludedAnswerCount),
              })}
            </p>
            <div
              role="region"
              aria-label={t("shareRegion")}
              tabIndex={0}
              className="max-w-full overflow-x-auto rounded-2xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="min-w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="min-w-28 max-w-48 px-3 py-3 font-medium" scope="col">{t("brand")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("equalWeightShare")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("pooledShare")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("pooledCount")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("pooledDenominator")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.rows.map((row) => (
                    <tr key={row.brandId} className="border-b">
                      <td className="min-w-28 max-w-48 px-3 py-3 align-top [overflow-wrap:anywhere]">{row.brandId}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{shareText(locale, row.equalWeightShare, t("shareNa"))}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{shareText(locale, row.pooledShare, t("shareNa"))}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{formatNumber(locale, row.pooledCount)}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{formatNumber(locale, row.pooledDenominator)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {workspace.questions.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <h3 className="text-base font-medium">{t("perQuestionHeading")}</h3>
            <div
              role="region"
              aria-label={t("perQuestionRegion")}
              tabIndex={0}
              className="max-w-full overflow-x-auto rounded-2xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="min-w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-3 text-xs font-medium whitespace-nowrap" scope="col">{t("questionIdCol")}</th>
                    <th className="px-3 py-3 text-xs font-medium whitespace-nowrap" scope="col">{t("questionAnswersCol")}</th>
                    <th className="px-3 py-3 text-xs font-medium whitespace-nowrap" scope="col">{t("questionDenominatorCol")}</th>
                    <th className="px-3 py-3 text-xs font-medium whitespace-nowrap" scope="col">{t("questionSharesCol")}</th>
                    <th className="px-3 py-3 text-xs font-medium whitespace-nowrap" scope="col">{t("questionCoverageCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.questions.map((question) => (
                    <tr key={question.questionId} className="border-b">
                      <td className="min-w-32 max-w-56 px-3 py-3 align-top [overflow-wrap:anywhere]">
                        <p className="font-mono text-xs">{question.questionId}</p>
                        {question.questionText ? <p className="mt-1 text-xs text-muted-foreground">{question.questionText}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{formatNumber(locale, question.answerCount)}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">{formatNumber(locale, question.totalMentions)}</td>
                      <td className="min-w-44 px-3 py-3 align-top tabular-nums">
                        {question.status === "ready" ? (
                          <ul className="space-y-1 text-xs">
                            {question.brands.map((brand) => (
                              <li key={brand.brandId} className="[overflow-wrap:anywhere]">
                                {t("questionBrandShare", {
                                  brand: brand.brandId,
                                  count: formatNumber(locale, brand.count),
                                  denominator: formatNumber(locale, brand.denominator),
                                  share: shareText(locale, brand.share, t("shareNa")),
                                })}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span>{t("shareNa")}</span>
                        )}
                      </td>
                      <td className="min-w-44 px-3 py-3 align-top text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                        {question.status === "ready" ? (
                          <>
                            <p>{t("questionCovered")}</p>
                            {question.excludedAnswerCount > 0 ? (
                              <p className="mt-1">{t("questionPartialExcluded", { count: formatNumber(locale, question.excludedAnswerCount) })}</p>
                            ) : null}
                          </>
                        ) : question.status === "zero_mentions" ? (
                          <>
                            <p>{t("questionZeroMentionCovered")}</p>
                            {question.excludedAnswerCount > 0 ? (
                              <p className="mt-1">{t("questionPartialExcluded", { count: formatNumber(locale, question.excludedAnswerCount) })}</p>
                            ) : null}
                          </>
                        ) : (
                          <p>{t("questionExcludedUnknown", { count: formatNumber(locale, question.excludedAnswerCount) })}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {workspace.missingQuestionAnswers.length > 0 ? (
          <div className={panelClass}>
            <h3 className="text-base font-medium">{t("missingQuestionHeading")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{t("missingQuestionNote")}</p>
            <ul className="space-y-2 text-sm">
              {workspace.missingQuestionAnswers.map((item) => (
                <li key={item.observationId} className="rounded-xl border px-3 py-2 [overflow-wrap:anywhere]">
                  <p className="font-mono text-xs text-muted-foreground">{item.observationId}</p>
                  {item.questionText ? <p className="mt-1">{item.questionText}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.mentionedBrands.length > 0 ? item.mentionedBrands.join(" · ") : t("noBrandMentioned")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {workspace.excludedAnswers.length > 0 ? (
          <div className={panelClass}>
            <h3 className="text-base font-medium">{t("excludedAnswersHeading")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{t("excludedAnswersNote")}</p>
            <ul className="space-y-2 text-sm">
              {workspace.excludedAnswers.map((item) => (
                <li key={item.observationId} className="rounded-xl border px-3 py-2 [overflow-wrap:anywhere]">
                  <p className="font-mono text-xs text-muted-foreground">{item.questionId ?? t("missingQuestionIdTag")}</p>
                  {item.questionText ? <p className="mt-1">{item.questionText}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("unknownMembers", { names: item.unknownBrands.join(" · ") })}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {workspace.rank.unorderedCount > 0 && !workspace.rank.ranked ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("unordered")}</p>
        ) : null}
        {!workspace.rank.ranked && workspace.rank.unorderedCount === 0 && workspace.rank.unorderedObservations > 0 ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("unordered")}</p>
        ) : null}
        {workspace.rank.ranked ? (
          <div className="min-w-0 space-y-3">
            <h3 className="text-base font-medium">{t("orderedRankHeading")}</h3>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("orderedRankNote")}</p>
            <p className="text-sm leading-6 text-muted-foreground tabular-nums">
              {t("orderedSummary", { ordered: formatNumber(locale, workspace.rank.orderedObservations) })}
            </p>
            <div
              role="region"
              aria-label={t("orderedRankRegion")}
              tabIndex={0}
              className="max-w-full overflow-x-auto rounded-2xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="min-w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="min-w-28 max-w-48 px-3 py-3 font-medium" scope="col">{t("brand")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("appearanceRate")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("firstPlaceRate")}</th>
                    <th className="px-3 py-3 align-bottom text-xs font-medium leading-4 whitespace-nowrap" scope="col">{t("conditionalMeanPosition")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.rank.rows.map((row) => (
                    <tr key={row.brandId} className="border-b">
                      <td className="min-w-28 max-w-48 px-3 py-3 align-top [overflow-wrap:anywhere]">
                        <p>{row.brandId}</p>
                        {row.unknownCount > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("orderedUnknownNote", { count: formatNumber(locale, row.unknownCount) })}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">
                        {t("rateWithCounts", {
                          rate: shareText(locale, row.appearanceRate, t("shareNa")),
                          numerator: formatNumber(locale, row.appearedCount),
                          denominator: formatNumber(locale, row.judgableCount),
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">
                        {t("rateWithCounts", {
                          rate: shareText(locale, row.firstPlaceRate, t("shareNa")),
                          numerator: formatNumber(locale, row.firstPlaceCount),
                          denominator: formatNumber(locale, row.judgableCount),
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums">
                        {row.conditionalMeanPosition === null ? t("shareNa") : formatNumber(locale, row.conditionalMeanPosition)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {workspace.rank.excludedAbsent.length > 0 ? (
              <p className="text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">{t("absent", { names: workspace.rank.excludedAbsent.join(" · ") })}</p>
            ) : null}
            {workspace.rank.unorderedCount > 0 ? (
              <p className="text-sm leading-7 text-muted-foreground">{t("unorderedExcluded", { count: workspace.rank.unorderedCount })}</p>
            ) : null}
            {workspace.rank.observations.length > 0 ? (
              <div className={panelClass}>
                <h4 className="text-sm font-medium">{t("orderedObservationsHeading")}</h4>
                <ul className="space-y-2 text-sm">
                  {workspace.rank.observations.map((obs) => (
                    <li key={obs.observationId} className="rounded-xl border px-3 py-2 [overflow-wrap:anywhere]">
                      <p className="font-mono text-xs text-muted-foreground">
                        {obs.questionId ? `${obs.questionId} · ${obs.observationId}` : obs.observationId}
                      </p>
                      {obs.questionText ? <p className="mt-1">{obs.questionText}</p> : null}
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                        {obs.brands.map((brand) => (
                          <li key={brand.brandId} className="[overflow-wrap:anywhere]">
                            {brand.mentionState === "true" && brand.position !== null
                              ? t("orderedObsPosition", { brand: brand.brandId, position: formatNumber(locale, brand.position) })
                              : brand.mentionState === "unknown"
                                ? t("orderedObsUnknown", { brand: brand.brandId })
                                : t("orderedObsAbsent", { brand: brand.brandId })}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{t("record")}</h2>
        {workspace.observations.length === 0 || !workspace.selected?.labels.length ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("noObservations")}</p>
        ) : (
          <form action={recordMentionsAction} className="min-w-0 space-y-3">
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="setId" value={workspace.selected.id} />
            <div className="min-w-0 text-sm">
              <label htmlFor="competitor-observation" className="mb-1 block text-muted-foreground">
                {t("observation")}
              </label>
              <div className={selectWrap}>
                <select
                  id="competitor-observation"
                  name="observationId"
                  required
                  defaultValue=""
                  className="h-10 w-full max-w-full rounded-md border bg-background px-3"
                >
                  <option value="" disabled>{t("chooseObservation")}</option>
                  {workspace.observations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t("observationOption", { id: item.id.slice(0, 8), question: item.questionText })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm text-muted-foreground">{t("brand")}</legend>
              {workspace.selected.labels.map((label) => (
                <div key={label} className="flex min-w-0 flex-wrap items-center gap-2">
                  <input type="hidden" name="setLabel" value={label} />
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
                    <select
                      name={`state:${label}`}
                      aria-label={label}
                      required
                      defaultValue=""
                      className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="" disabled>{t("chooseMentionState")}</option>
                      <option value="false">{t("mentionFalse")}</option>
                      <option value="true">{t("mentionTrue")}</option>
                      <option value="unknown">{t("mentionUnknown")}</option>
                    </select>
                  </label>
                  <input
                    name={`position:${label}`}
                    inputMode="numeric"
                    aria-label={`${t("position")} ${label}`}
                    className="h-9 w-20 shrink-0 rounded-md border bg-background px-2"
                  />
                </div>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ordered" />
              <span>{t("ordered")}</span>
            </label>
            <Button type="submit" className={actionClass}>{t("saveMentions")}</Button>
          </form>
        )}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("sources")}</h2>
        {workspace.sourcesTruncated ? (
          <p className={emptyClass}>{t("sourcesTruncated")}</p>
        ) : workspace.citations.length > 0 ? (
          <div className={panelClass}>
            <h3 className="text-base font-medium">{t("thirdPartySupportHeading")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{t("thirdPartySupportNote")}</p>
            <p className="text-sm leading-6 text-muted-foreground">{t("referenceOriginNote")}</p>
            <p className="text-sm font-medium tabular-nums">
              {workspace.supportSummary.supportRate === null
                ? t("supportRateNaLine", { na: t("shareNa") })
                : t("supportRateLine", {
                    rate: formatPercent(locale, workspace.supportSummary.supportRate),
                    numerator: formatNumber(locale, workspace.supportSummary.supportsCount),
                    denominator: formatNumber(locale, workspace.supportSummary.judgableCount),
                  })}
            </p>
            {workspace.supportSummary.unavailableReason === "uninspected_only" ? (
              <p className="text-sm leading-6 text-muted-foreground">{t("supportReasonUninspected")}</p>
            ) : workspace.supportSummary.unavailableReason === "no_judgable_inspections" ? (
              <p className="text-sm leading-6 text-muted-foreground">{t("supportReasonNoJudgable")}</p>
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground tabular-nums">
              {t("supportJudgableCounts", {
                judgable: formatNumber(locale, workspace.supportSummary.judgableCount),
                supports: formatNumber(locale, workspace.supportSummary.supportsCount),
                doesNotSupport: formatNumber(locale, workspace.supportSummary.doesNotSupportCount),
              })}
            </p>
            <p className="text-sm leading-6 text-muted-foreground tabular-nums">
              {t("supportUnknownCounts", {
                unknown: formatNumber(locale, workspace.supportSummary.unknownCount),
              })}
            </p>
            {workspace.supportSummary.unknownCount > 0 ? (
              <p className="text-xs leading-6 text-muted-foreground tabular-nums">
                {t("supportUnknownReasons", {
                  uninspected: formatNumber(locale, workspace.supportSummary.uninspectedCount),
                  dead: formatNumber(locale, workspace.supportSummary.deadCount),
                  limited: formatNumber(locale, workspace.supportSummary.limitedCount),
                  other: formatNumber(locale, workspace.supportSummary.unknownAuthorOrLegacyCount),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {workspace.hosts.length > 0 ? (
          <ul className="min-w-0 text-sm leading-6 text-muted-foreground">
            {workspace.hosts.map((host) => (
              <li key={host.host} className="[overflow-wrap:anywhere]">{t("hosts")}: {host.host} · {host.pages}</li>
            ))}
          </ul>
        ) : null}
        {workspace.citations.length === 0 && !workspace.sourcesTruncated ? (
          <p className={emptyClass}>{t("sourcesEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {workspace.citations.map((citation) => (
              <li key={citation.citationId} className="min-w-0 rounded-2xl border bg-card px-4 py-3 text-sm">
                <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {citation.citationId} · {citation.observationId}
                </p>
                <p className="mt-1 [overflow-wrap:anywhere]">{citation.rawUrl}</p>
                <p className="mt-1">{t(citation.citationOrigin)}</p>
                <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
                  <span>{t(sourceState[citation.state])}</span>
                  <span>
                    {citation.support === "supports"
                      ? t("supportSupports")
                      : citation.support === "does_not_support"
                        ? t("supportDoesNotSupport")
                        : t("supportUnknown")}
                  </span>
                </p>
                {citation.supportedClaim ? (
                  <p className="mt-1 [overflow-wrap:anywhere]">{t("supportedClaimLine", { claim: citation.supportedClaim })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {workspace.citations.length > 0 ? (
          <form action={inspectCitationAction} className={`${panelClass}`}>
            <h3 className="font-medium">{t("inspect")}</h3>
            <p className="text-xs leading-6 text-muted-foreground">{t("inspectHint")}</p>
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("sources")}</span>
              <span className={selectWrap}>
                <select name="citationId" className="h-10 w-full max-w-full rounded-md border bg-background px-3">
                  {workspace.citations.map((citation) => (
                    <option key={citation.citationId} value={citation.citationId}>{citationOption(citation.rawUrl)}</option>
                  ))}
                </select>
              </span>
            </label>
            {(["pageLive", "readable", "authorKnown", "supportsBrand"] as const).map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} />
                <span>{t(name)}</span>
              </label>
            ))}
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("supportedClaim")}</span>
              <input name="supportedClaim" maxLength={500} className={`${fieldClass} h-10`} />
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("supportedClaimHint")}</span>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("factVersion")}</span>
              <span className={selectWrap}>
                <select name="factVersionId" className="h-10 w-full max-w-full rounded-md border bg-background px-3">
                  <option value="">{t("factVersionNone")}</option>
                  {workspace.usableFacts.map((fact) => (
                    <option key={fact.id} value={fact.id}>{citationOption(fact.claim)}</option>
                  ))}
                </select>
              </span>
            </label>
            <Button type="submit" className={actionClass}>{t("saveInspection")}</Button>
          </form>
        ) : null}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("briefs")}</h2>
        {workspace.briefs.length === 0 ? (
          <p className={emptyClass}>{t("briefsEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {workspace.briefs.map((brief) => (
              <li key={brief.id} className="min-w-0 rounded-2xl border bg-card px-4 py-3 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{brief.questionCluster}</p>
                <p className="mt-1 [overflow-wrap:anywhere]">{brief.gap}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground">
                  <span>{t(brief.status)}</span>
                  <span>{brief.sourceIds.length}</span>
                </p>
                {brief.status === "proposed" ? (
                  <form action={briefStatusAction} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="briefId" value={brief.id} />
                    <Button type="submit" name="status" value="accepted" size="sm" className={actionClass}>{t("accept")}</Button>
                    <Button type="submit" name="status" value="dismissed" size="sm" variant="outline" className={actionClass}>{t("dismiss")}</Button>
                  </form>
                ) : null}
                {brief.status === "accepted" ? (
                  <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                    <form action={createContentBriefFromResearchAction}>
                      <input type="hidden" name="brandId" value={brandId} />
                      <input type="hidden" name="briefId" value={brief.id} />
                      <Button type="submit" size="sm" className={actionClass}>{t("createContentBrief")}</Button>
                    </form>
                    <form action={createOptimizationTaskFromResearchAction}>
                      <input type="hidden" name="brandId" value={brandId} />
                      <input type="hidden" name="briefId" value={brief.id} />
                      <Button type="submit" size="sm" variant="outline" className={actionClass}>{t("createOptimizationTask")}</Button>
                    </form>
                    {brief.contentBriefId ? (
                      <Link href={`/dashboard/content/briefs/${brief.contentBriefId}`} prefetch={false} className={linkClass}>
                        {t("openContentBrief")}
                      </Link>
                    ) : null}
                    {brief.optimizationTaskId ? (
                      <Link href={`/dashboard/optimization/${brief.optimizationTaskId}`} prefetch={false} className={linkClass}>
                        {t("openOptimizationTask")}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form action={proposeBriefAction} className={panelClass}>
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("questionCluster")}</span>
            <input name="questionCluster" required className={`${fieldClass} h-10`} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("gap")}</span>
            <textarea name="gap" required rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("facts")}</span>
            <textarea name="facts" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("briefSources")}</span>
            <span className={selectWrap}>
              <select name="sourceId" multiple className="min-h-24 w-full max-w-full rounded-md border bg-background px-3 py-2">
                {workspace.citations.map((citation) => (
                  <option key={citation.citationId} value={citation.citationId}>{citationOption(citation.rawUrl)}</option>
                ))}
              </select>
            </span>
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceText")}</span>
            <textarea name="sourceText" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("briefText")}</span>
            <textarea name="briefText" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceBrand")}</span>
            <input name="sourceBrand" className={`${fieldClass} h-10`} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("ownBrand")}</span>
            <input name="ownBrand" className={`${fieldClass} h-10`} />
          </label>
          <Button type="submit" className={actionClass}>{t("saveBrief")}</Button>
        </form>
      </section>
    </Canvas>
  );
}
