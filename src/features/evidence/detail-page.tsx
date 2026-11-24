import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { formatMinorUnits } from "../monitoring/format";
import { Button } from "@/components/ui/button";
import { listActionDrafts } from "../optimization/action-drafts";
import { generateOptimizationAction } from "../optimization/actions";
import { ActionDraftPanel } from "../optimization/draft-panel";
import { AnalysisDraftPanel } from "./analysis-draft-form";
import { readObservation } from "./commands";
import { answerListFiltersFromSearch, answerListPath } from "./answer-list";
import { overviewScopeForReturn, overviewScopePath } from "./overview-contracts";
import { ReviseAnalysisForm } from "./revise-form";

const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";
const returnActionClass = "h-auto min-h-10 max-w-full px-3 py-2 text-left whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("evidence");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EvidenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ observationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { observationId } = await params;
  const query = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("evidence");
  const overview = await getTranslator("evidenceOverview");
  const optimization = await getTranslator("optimization");
  const detail = await readObservation(getConnection(), session.user.id, observationId);
  if (!detail) notFound();

  const { observation, citations, analyses, latestAnalysis, citationPool, drafts, capture } = detail;
  const actionDrafts = await listActionDrafts(getConnection(), session.user.id, observation.brandId, observation.id);
  const label = (value: "true" | "false" | "unknown") => t(value);
  const requestedNetwork = observation.requestedNetworkMode === "on"
    ? "requestedNetworkOn"
    : observation.requestedNetworkMode === "off"
      ? "requestedNetworkOff"
      : "requestedNetworkUnknown";
  const networkTrigger = observation.networkTrigger === "triggered"
    ? "networkTriggerTriggered"
    : observation.networkTrigger === "not_triggered"
      ? "networkTriggerNotTriggered"
      : "networkTriggerUnknown";
  const preserved = overviewScopeForReturn(query, {
    brandId: observation.brandId,
    sourceMode: observation.sourceMode,
  });
  const parsedFilters = answerListFiltersFromSearch(query);
  const answersHref = `${parsedFilters.success
    ? answerListPath("/dashboard/monitoring/answers", preserved, parsedFilters.data)
    : overviewScopePath("/dashboard/monitoring/answers", preserved)}#answer-${observation.id}`;
  const overviewHref = overviewScopePath("/dashboard/monitoring/overview", preserved);
  const costText = capture.costState === "known" && capture.actualMinor !== null && capture.currency
    ? t("costKnown", { amount: formatMinorUnits(locale, capture.actualMinor, capture.currency) })
    : capture.costState === "none"
      ? t("costNone")
      : t("costPending");

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <nav aria-label={overview("relatedEntries")} className="flex flex-wrap gap-2">
          <Button asChild className={returnActionClass}>
            <Link href={answersHref} prefetch={false}>{overview("backAnswers")}</Link>
          </Button>
          <Button asChild variant="outline" className={returnActionClass}>
            <Link href={overviewHref} prefetch={false}>{overview("backOverview")}</Link>
          </Button>
        </nav>
      </header>
      <div className={panelClass}>
        <section className="space-y-2">
          <h2 className="font-semibold">{t("question")}</h2>
          <p className="wrap-anywhere text-sm leading-6">{observation.questionText}</p>
        </section>
        <section aria-labelledby="answer-text-heading" className="space-y-2">
          <h2 id="answer-text-heading" className="font-semibold">{t("rawAnswer")}</h2>
          <p className="wrap-anywhere whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm leading-6">{observation.answerText}</p>
        </section>
        <dl className="grid gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <dt className="text-muted-foreground">{t("evidenceState")}</dt>
            <dd>{t(observation.evidenceState)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("fingerprint")}</dt>
            <dd className="wrap-anywhere">{observation.fingerprint}</dd>
          </div>
        </dl>
      </div>
      <section className={panelClass}>
        <h2 className="font-semibold">{t("samplingConditions")}</h2>
        <dl className="grid gap-3 text-sm wrap-anywhere sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("targetRegion")}</dt>
            <dd>{observation.targetRegion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("observedRegion")}</dt>
            <dd>{observation.observedRegion === "unknown" ? t("observedRegionUnknown") : observation.observedRegion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("newSession")}</dt>
            <dd>{label(observation.newSession)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("productMode")}</dt>
            <dd>{label(observation.productMode)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("requestedNetwork")}</dt>
            <dd>{t(requestedNetwork)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("networkTrigger")}</dt>
            <dd>{t(networkTrigger)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("captureCost")}</dt>
            <dd>{costText}</dd>
          </div>
        </dl>
      </section>
      <section className={panelClass}>
        <h2 className="font-semibold">{t("citationPool")}</h2>
        <p className="wrap-anywhere text-sm">
          {citationPool.inC
            ? citationPool.cited
              ? t("cited")
              : t("notCited")
            : t("notInC", { reason: citationPool.reason ?? observation.citationSetState })}
        </p>
        {citations.length > 0 && (
          <ul className="space-y-2 text-sm">
            {citations.map((item) => (
              <li key={item.id} className="wrap-anywhere rounded-lg border p-3">
                <p>{item.citationOrigin}</p>
                <p>{item.normalizedUrl}</p>
                <p>{item.ownership} · {item.pageStatus}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AnalysisDraftPanel
        locale={locale}
        observationId={observation.id}
        expectedVersion={latestAnalysis?.version ?? null}
        drafts={drafts}
        messages={getMessages(locale).evidence}
      />
      {latestAnalysis && (
        <section className={panelClass}>
          <h2 className="font-semibold">{t("analysisHistory")}</h2>
          <ul className="space-y-2 text-sm">
            {analyses.map((item) => (
              <li key={item.id} className="wrap-anywhere rounded-lg border p-3">
                <p>{t("version", { version: item.version })} · {item.status}</p>
                <p>{t("mentioned")}: {label(item.mentioned)}</p>
                <p>{t("recommended")}: {label(item.recommended)}</p>
                <p>{t("officialSiteCited")}: {label(item.officialSiteCited)}</p>
                {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
              </li>
            ))}
          </ul>
          <ReviseAnalysisForm
            brandId={observation.brandId}
            observationId={observation.id}
            expectedVersion={latestAnalysis.version}
            initial={{
              mentioned: latestAnalysis.mentioned,
              recommended: latestAnalysis.recommended,
              officialSiteCited: latestAnalysis.officialSiteCited,
            }}
            messages={getMessages(locale).evidence}
          />
        </section>
      )}
      {"error" in actionDrafts ? (
        <p role="alert" className="text-sm">{optimization(actionDrafts.error)}</p>
      ) : (
        <ActionDraftPanel
          locale={locale}
          brandId={observation.brandId}
          evidenceIds={observation.evidenceState === "draft_evidence" ? undefined : [observation.id]}
          drafts={actionDrafts.drafts}
          messages={getMessages(locale).optimization}
        />
      )}
      {observation.evidenceState !== "draft_evidence" ? (
        <form action={generateOptimizationAction} className="rounded-2xl border px-4 py-4">
          <input type="hidden" name="brandId" value={observation.brandId} />
          <input type="hidden" name="observationId" value={observation.id} />
          <Button type="submit" className="h-auto max-w-full text-left whitespace-normal">{t("generateOptimization")}</Button>
        </form>
      ) : null}
    </div>
  );
}
