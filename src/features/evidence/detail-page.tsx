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
import { authorizeBrandActor } from "../team-access/brand-scope";
import { AnalysisDraftPanel } from "./analysis-draft-form";
import { CitationOwnershipForm } from "./citation-ownership-form";
import { readManualEvidenceContext, readObservation } from "./commands";
import { canAppendReferenceLink, isNativeCitationOrigin, isReferenceLinkOrigin } from "./contracts";
import { ReferenceLinkForm } from "./reference-link-form";
import { ManualEvidenceForm } from "./manual-evidence-form";
import { EvidenceDetailStatus } from "./detail-status";
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
  let detail;
  try {
    detail = await readObservation(getConnection(), session.user.id, observationId);
  } catch {
    console.error("evidence-detail-read-unavailable");
    return <EvidenceDetailStatus state="failed" />;
  }
  if (!detail) notFound();

  const { observation, citations, analyses, latestAnalysis, citationPool, drafts, capture } = detail;
  const evidenceMessages = getMessages(locale).evidence;
  const [actionDrafts, writeScope] = await Promise.all([
    listActionDrafts(getConnection(), session.user.id, observation.brandId, observation.id),
    authorizeBrandActor(getConnection(), session.user.id, observation.brandId, "write"),
  ]);
  const canWrite = Boolean(writeScope);
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
  const manualContext = observation.evidenceState === "draft_evidence"
    && observation.sourceMode === "consumer_ui"
    && (observation.captureMethod === "manual" || observation.captureMethod === "assisted")
    ? await readManualEvidenceContext(getConnection(), session.user.id, observation.brandId)
    : null;
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
          {observation.collectorId ? (
            <div>
              <dt className="text-muted-foreground">{t("manualCollector")}</dt>
              <dd>{observation.collectorId}</dd>
            </div>
          ) : null}
          {observation.locatorRef ? (
            <div>
              <dt className="text-muted-foreground">{t("manualLocator")}</dt>
              <dd>{observation.locatorRef}</dd>
            </div>
          ) : null}
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
        <h3 className="text-sm font-medium">{t("nativeCitations")}</h3>
        {citations.some((item) => isNativeCitationOrigin(item.citationOrigin)) ? (
          <ul className="space-y-2 text-sm">
            {citations.filter((item) => isNativeCitationOrigin(item.citationOrigin)).map((item) => (
              <li key={item.id} className="wrap-anywhere space-y-2 rounded-lg border p-3">
                <p>{t(item.citationOrigin)}</p>
                <p>{t("citationNormalized")}: {item.normalizedUrl}</p>
                <p>{t("citationRaw")}: {item.rawUrl}</p>
                <p>{t(`ownership_${item.ownership}`)} · {t(`pageStatus_${item.pageStatus}`)}</p>
                {canWrite && (
                  <CitationOwnershipForm
                    brandId={observation.brandId}
                    observationId={observation.id}
                    citationId={item.id}
                    initialOwnership={item.ownership}
                    initialPageStatus={item.pageStatus}
                    messages={evidenceMessages}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t("nativeCitationsEmpty")}</p>
        )}
        {citations.some((item) => isReferenceLinkOrigin(item.citationOrigin)) && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("referenceLinks")}</h3>
            <ul className="space-y-2 text-sm">
              {citations.filter((item) => isReferenceLinkOrigin(item.citationOrigin)).map((item) => (
                <li key={item.id} className="wrap-anywhere rounded-lg border p-3">
                  <p>{t(item.citationOrigin)}</p>
                  <p>{t("citationNormalized")}: {item.normalizedUrl}</p>
                  <p>{t("citationRaw")}: {item.rawUrl}</p>
                  <p>{t(`ownership_${item.ownership}`)} · {t(`pageStatus_${item.pageStatus}`)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {citations.some((item) => !isNativeCitationOrigin(item.citationOrigin) && !isReferenceLinkOrigin(item.citationOrigin)) && (
          <ul className="space-y-2 text-sm">
            {citations.filter((item) => !isNativeCitationOrigin(item.citationOrigin) && !isReferenceLinkOrigin(item.citationOrigin)).map((item) => (
              <li key={item.id} className="wrap-anywhere rounded-lg border p-3">
                <p>{t(item.citationOrigin)}</p>
                <p>{t("citationNormalized")}: {item.normalizedUrl}</p>
                <p>{t("citationRaw")}: {item.rawUrl}</p>
                <p>{t(`ownership_${item.ownership}`)} · {t(`pageStatus_${item.pageStatus}`)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canAppendReferenceLink(observation.evidenceState) && (
        <ReferenceLinkForm
          brandId={observation.brandId}
          observationId={observation.id}
          messages={getMessages(locale).evidence}
        />
      )}
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
          canWrite={canWrite}
          messages={getMessages(locale).optimization}
        />
      )}
      {manualContext && (
        <ManualEvidenceForm
          mode="complete"
          context={manualContext}
          observationId={observation.id}
          initial={{
            questionText: observation.questionText,
            answerText: observation.answerText,
            targetRegion: observation.targetRegion,
            observedRegion: observation.observedRegion,
            newSession: observation.newSession,
            productMode: observation.productMode,
            requestedNetworkMode: observation.requestedNetworkMode,
            citationSetState: observation.citationSetState,
            citationUrls: citations.map((item) => item.rawUrl).join("\n"),
            collectorId: observation.collectorId ?? "",
            locatorRef: observation.locatorRef ?? "",
            missingReason: observation.missingReason,
          }}
          messages={getMessages(locale).evidence}
        />
      )}
      {canWrite && observation.evidenceState !== "draft_evidence" ? (
        <section className="space-y-3 rounded-2xl border px-4 py-4">
          <form action={generateOptimizationAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="brandId" value={observation.brandId} />
            <input type="hidden" name="observationId" value={observation.id} />
            <Button type="submit" className="h-auto max-w-full text-left whitespace-normal">{t("generateOptimization")}</Button>
            <Button asChild variant="outline" className="h-auto max-w-full text-left whitespace-normal">
              <Link href={`/dashboard/optimization?brandId=${encodeURIComponent(observation.brandId)}`} prefetch={false}>
                {t("openOptimizationTasks")}
              </Link>
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
