import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { workspaceBrand } from "@/features/team-access/brand-scope";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockRetestButton } from "@/features/functional-mock/run-buttons";
import { Button } from "@/components/ui/button";
import { ContentDao } from "@/features/content/dao";
import { generateSavedSnapshotAction, reviseSavedSnapshotAction, saveReportDecisionAction } from "./actions";
import { businessFeedbackLines } from "./business-feedback";
import { presentSnapshotCost } from "./cost-copy";
import { listBrandDecisions, listReports, snapshotViews, type ReportDecisionView, type SnapshotCostView, type SnapshotExclusion, type SnapshotSourceView, type SnapshotView } from "./commands";
import { reportDecisionActions, type ReportDecisionAction } from "./contracts";
import { conclusionSentence, executionSentence, visitSentences } from "./reading";
import { ReportEntryPanel, type ReportPublicationOption } from "./report-entry-panel";
import { readSavedWindows, readTodoProgress } from "./window-observations";
import { m0StageGate } from "./m0-stage-gate";
import { snapshotMetricLabels } from "./snapshot";
import { snapshotMetrics, type SnapshotMetric } from "./snapshot-comparisons";
import type { ReportError } from "./contracts";
import type { ReportSnapshotRow } from "./dao";

const actionClass = "h-auto max-w-full whitespace-normal";
const emptyClass = "rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const itemClass = "min-w-0 rounded-2xl border bg-card px-4 py-4 text-sm";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words whitespace-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export async function generateMetadata() {
  const t = await getTranslator("reports");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function relatedLinks(t: Awaited<ReturnType<typeof getTranslator<"reports">>>, brandId?: string) {
  return [
    ...(brandId ? [{ href: `/dashboard/monitoring/new?brandId=${encodeURIComponent(brandId)}`, label: t("openMonitoringNew") }] : []),
    { href: "/dashboard/reports/observations", label: t("openObservations") },
    { href: "/dashboard/reports/interventions", label: t("openInterventions") },
    { href: "/dashboard/reports/leads", label: t("openLeads") },
    { href: "/dashboard/reports/lead-quality", label: t("openLeadQuality") },
    { href: "/dashboard/reports/lead-suggestions", label: t("openLeadSuggestions") },
    { href: "/dashboard/reports/shares", label: t("openShares") },
    { href: "/dashboard/reports/connector-events", label: t("openConnectorEvents") },
    { href: "/dashboard/reports/crawler-visits", label: t("openCrawlerVisits") },
  ] as const;
}

function SnapshotBusinessLines({
  brandId,
  view,
  locale,
  t,
}: {
  brandId: string;
  view: SnapshotView["business"] | undefined;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  if (!view || view.state === "unavailable") {
    return <p className="break-words leading-6 text-muted-foreground">{t("businessUnavailable")}</p>;
  }
  if (view.state === "absent") {
    return <p className="break-words leading-6 text-muted-foreground">{t("businessAbsent")}</p>;
  }
  return (
    <div className="space-y-1 break-words">
      {businessFeedbackLines(locale, view.feedback).map((line) => (
        <p key={line} className="leading-6 text-muted-foreground">{line}</p>
      ))}
      {view.feedback.lead_feedback?.records.length ? (
        <details>
          <summary className="cursor-pointer py-2 font-medium">{t("businessLeadRecords")}</summary>
          <ul className="space-y-1">
            {view.feedback.lead_feedback.records.map(({ leadId, feedbackId }, index) => (
              <li key={feedbackId}>
                <Link className="inline-flex min-h-10 items-center underline underline-offset-4"
                  href={`/dashboard/reports/leads?brandId=${brandId}&leadId=${leadId}&feedbackId=${feedbackId}#lead-record`}>
                  {t("businessLeadRecord", { number: new Intl.NumberFormat(locale).format(index + 1) })}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SnapshotCostLines({
  view,
  locale,
  unavailable,
  absent,
}: {
  view: SnapshotCostView | undefined;
  locale: Locale;
  unavailable: string;
  absent: string;
}) {
  if (!view || view.state === "unavailable") {
    return <p className="mt-2 break-words text-muted-foreground">{unavailable}</p>;
  }
  if (view.state === "absent") {
    return <p className="mt-2 break-words text-muted-foreground">{absent}</p>;
  }
  const lines = presentSnapshotCost(locale, view.cost, view.labor);
  return (
    <div className="mt-2 space-y-1 break-words text-muted-foreground">
      <p>{lines.known}</p>
      <p>{lines.pending}</p>
      {lines.reason ? <p>{lines.reason}</p> : null}
      <p>{lines.labor}</p>
      <p>{lines.laborReason}</p>
    </div>
  );
}

const exclusionReason = {
  modified: "comparisonReason_modified",
  missing_side: "comparisonReason_missing_side",
  not_judgable: "comparisonReason_not_judgable",
  brand_question: "comparisonReason_brand_question",
  scope_mismatch: "comparisonReason_scope_mismatch",
} as const;

function SnapshotExclusions({
  excluded,
  t,
}: {
  excluded: readonly SnapshotExclusion[];
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  if (excluded.length === 0) return null;
  return (
    <div className="mt-3 break-words">
      <p className="font-medium">{t("excludedHeading")}</p>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {excluded.map((item) => (
          <li key={`${item.queryId}:${item.reason}`} className="[overflow-wrap:anywhere]">
            {t("excludedLine", { query: item.queryId, reason: t(exclusionReason[item.reason]) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SnapshotSourceNote({
  source,
  t,
}: {
  source: SnapshotSourceView | undefined;
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  if (!source?.sourceMissing) return null;
  let text = t("snapshotSourceMissing");
  if (source.missingObservationCount === 1) {
    text = t("snapshotSourceMissingCountOne", { count: source.missingObservationCount });
  } else if (source.missingObservationCount > 1) {
    text = t("snapshotSourceMissingCount", { count: source.missingObservationCount });
  }
  return <p className="mt-2 break-words leading-6" role="note">{text}</p>;
}

function SnapshotMetrics({ view, locale, t }: {
  view: SnapshotView | undefined;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  if (view?.comparisons) {
    const comparisons = view.comparisons;
    const points = new Intl.NumberFormat(locale, { signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (
      <dl className="space-y-2 break-words">
        {snapshotMetrics.map((metric) => {
          const { common_query_count, delta_pp } = comparisons[metric];
          const label = t(snapshotMetricLabels[metric]);
          return (
            <div key={metric} role="group" aria-label={label} className="min-w-0">
              <div className="flex flex-wrap gap-x-2">
                <dt>{label}</dt>
                <dd className="text-muted-foreground tabular-nums">
                  {t(common_query_count === 1 ? "snapshotMetricCountOne" : "snapshotMetricCount", {
                    common: common_query_count, delta: delta_pp === null ? "N/A" : `${points.format(delta_pp)}pp`,
                  })}
                </dd>
              </div>
              <p className="break-words leading-6 text-muted-foreground">
                {conclusionSentence(locale, view.conclusions[metric] ?? "missing")}
              </p>
            </div>
          );
        })}
      </dl>
    );
  }
  const label = view?.metric && Object.hasOwn(snapshotMetricLabels, view.metric)
    ? t(snapshotMetricLabels[view.metric as SnapshotMetric])
    : view?.metric;
  return (
    <div className="space-y-1">
      {label ? <p className="break-words text-muted-foreground">{t("snapshotLegacyMetric", { metric: label })}</p> : null}
      <p className="break-words leading-6 text-muted-foreground">{t("visibilityAbsent")}</p>
    </div>
  );
}

function SnapshotReading({
  id,
  brandId,
  view,
  locale,
  t,
}: {
  id: string;
  brandId: string;
  view: SnapshotView | undefined;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  const execution = view?.execution ?? { state: "unavailable" as const };
  const visits = view?.visits ?? { state: "unavailable" as const };
  return (
    <div className="mt-3 space-y-4">
      <section aria-labelledby={`${id}-execution`} className="min-w-0 space-y-1">
        <h3 id={`${id}-execution`} className="font-medium">{t("layerExecution")}</h3>
        <p className="break-words leading-6 text-muted-foreground">{executionSentence(locale, execution)}</p>
      </section>
      <section aria-labelledby={`${id}-visibility`} className="min-w-0 space-y-1">
        <h3 id={`${id}-visibility`} className="font-medium">{t("layerVisibility")}</h3>
        <SnapshotMetrics view={view} locale={locale} t={t} />
        <SnapshotExclusions excluded={view?.excluded ?? []} t={t} />
      </section>
      <section aria-labelledby={`${id}-visits`} className="min-w-0 space-y-1">
        <h3 id={`${id}-visits`} className="font-medium">{t("layerVisits")}</h3>
        {visitSentences(locale, visits).map((line) => (
          <p key={line} className="break-words leading-6 text-muted-foreground">{line}</p>
        ))}
      </section>
      <section aria-labelledby={`${id}-feedback`} className="min-w-0 space-y-1">
        <h3 id={`${id}-feedback`} className="font-medium">{t("businessHeading")}</h3>
        <SnapshotBusinessLines brandId={brandId} view={view?.business} locale={locale} t={t} />
      </section>
    </div>
  );
}

const decisionActionLabel: Record<ReportDecisionAction, "decisionContinueContent" | "decisionSupplementEvidence" | "decisionContinueObservation" | "decisionStop"> = {
  continue_content: "decisionContinueContent",
  supplement_evidence: "decisionSupplementEvidence",
  continue_observation: "decisionContinueObservation",
  stop: "decisionStop",
};

function SnapshotDecision({
  rows,
  canSave,
  brandId,
  snapshotId,
  t,
}: {
  rows: readonly ReportDecisionView[];
  canSave: boolean;
  brandId: string;
  snapshotId: string;
  t: Awaited<ReturnType<typeof getTranslator<"reports">>>;
}) {
  if (!canSave && rows.length === 0) return null;
  return (
    <div className="mt-3 min-w-0 space-y-2">
      <h3 className="font-medium">{t("decisionHeading")}</h3>
      {rows.length === 0 ? (
        <p className="break-words leading-6 text-muted-foreground">{t("decisionEmpty")}</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 break-all leading-6 text-muted-foreground">
              {t("decisionRecord", {
                action: t(decisionActionLabel[row.action]),
                time: row.decidedAt,
                decider: row.decidedBy,
              })}
            </li>
          ))}
        </ol>
      )}
      {canSave ? (
        <form action={saveReportDecisionAction} className="space-y-2">
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="snapshotId" value={snapshotId} />
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm leading-6 text-muted-foreground">{t("decisionHint")}</legend>
            {reportDecisionActions.map((action) => (
              <label key={action} className="flex min-h-10 items-start gap-2 break-words">
                <input className="mt-1" type="radio" name="action" value={action} required />
                <span>{t(decisionActionLabel[action])}</span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="outline" className={actionClass}>{t("decisionSave")}</Button>
        </form>
      ) : null}
    </div>
  );
}

function nextSnapshot(snapshots: readonly ReportSnapshotRow[]) {
  const current = snapshots.find((item) => item.status === "created");
  if (current) return { kind: "current" as const, snapshot: current };
  if (snapshots.length > 0) return { kind: "history" as const, snapshot: null };
  return { kind: "empty" as const, snapshot: null };
}

function ReportCanvas({
  title,
  summary,
  primary,
  relatedLabel,
  related,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  related: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
          {related.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

export default async function ReportsListPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; publicationId?: string; error?: string; notice?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslator("reports");
  const locale = await getLocale();
  const params = await searchParams;
  const actionError = params.error === "INVALID_INPUT" || params.error === "LOOP_NOT_READY" || params.error === "CONFLICT"
    || params.error === "NOT_FOUND" || params.error === "SERVICE_UNAVAILABLE" || params.error === "WINDOW_NOT_DUE"
    || params.error === "FORBIDDEN" || params.error === "NO_COMPARISON"
    || params.error === "WINDOWS_NOT_ORDERED" || params.error === "WINDOWS_MISSING_ANSWERS"
    ? params.error
    : null;
  const connection = getConnection();
  const requestedBrand = typeof params.brandId === "string" && params.brandId.trim() ? params.brandId.trim() : undefined;
  const scope = await workspaceBrand(connection, session.user.id, requestedBrand, "read");
  const brandId = scope?.brandId;
  const reportsHref = requestedBrand
    ? `/dashboard/reports?brandId=${encodeURIComponent(requestedBrand)}`
    : "/dashboard/reports";
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );
  const reloadAction = (
    <Button asChild className={actionClass}>
      <a href={reportsHref}>{t("reload")}</a>
    </Button>
  );

  if (!brandId) {
    return (
      <ReportCanvas
        title={t("title")}
        summary={<p role={requestedBrand ? "alert" : undefined} className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{requestedBrand ? t("NOT_FOUND") : t("noBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={relatedLinks(t)}
      />
    );
  }

  let result: Awaited<ReturnType<typeof listReports>> | { error: ReportError };
  try {
    result = await listReports(connection, session.user.id, brandId);
  } catch {
    console.error("reports-read-failed", { brandId });
    result = { error: "SERVICE_UNAVAILABLE" };
  }
  let views = new Map<string, SnapshotView>();
  if (!("error" in result)) {
    try {
      views = await snapshotViews(connection, session.user.id, result.snapshots);
    } catch {
      console.error("reports-snapshot-read-failed", { brandId });
    }
  }
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";
  const mockGate = m0StageGate({
    realBrand: false,
    officialAnswers: 0,
    consumerAnswers: 0,
    independentCompletions: 0,
  });
  const mockGateLabels: Record<string, string> = {
    real_brand: t("mockGateMissRealBrand"),
    official_api: t("mockGateMissOfficial"),
    consumer_manual: t("mockGateMissConsumer"),
    walkthrough: t("mockGateMissWalkthrough"),
  };
  if ("error" in result && result.error) {
    const code = result.error;
    return (
      <ReportCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{code === "SERVICE_UNAVAILABLE" ? t("reportsUnavailable") : t(code)}</p>}
        primary={code === "NOT_FOUND" ? brandsAction : reloadAction}
        relatedLabel={t("relatedEntries")}
        related={relatedLinks(t)}
      />
    );
  }

  let publications: ReportPublicationOption[] = [];
  try {
    const dao = new ContentDao(connection);
    const rows = await dao.listPublicationsForBrand(session.user.id, brandId, 20);
    const requestedPublication = brandIdSchema.safeParse(params.publicationId);
    if (requestedPublication.success && !rows.some((item) => item.id === requestedPublication.data)) {
      const row = await dao.getPublication(session.user.id, requestedPublication.data);
      if (row?.brandId === brandId) rows.unshift(row);
    }
    publications = rows.map((item) => ({ id: item.id, status: item.status, effectiveAt: item.effectiveAt }));
  } catch {
    console.error("reports-publication-read-failed", { brandId });
  }
  const publicationId = publications.find((item) => item.id === params.publicationId)?.id;
  const ownerView = scope?.role === "owner";
  let decisionRows: ReportDecisionView[] = [];
  if (ownerView) {
    try {
      const listed = await listBrandDecisions(connection, session.user.id, brandId, result.snapshots.map((item) => item.id));
      if (!("error" in listed)) decisionRows = listed.decisions;
    } catch {
      console.error("report-decision-read-failed", { brandId });
    }
  }
  const decisionsBySnapshot = new Map<string, ReportDecisionView[]>();
  for (const row of decisionRows) {
    const group = decisionsBySnapshot.get(row.snapshotId) ?? [];
    group.push(row);
    decisionsBySnapshot.set(row.snapshotId, group);
  }
  const openRetests = new Set(result.snapshots.filter((item) => item.status === "created").map((item) => item.retestId));
  const next = nextSnapshot(result.snapshots);
  const observationsHref = "/dashboard/reports/observations";
  const taskKey = next.kind === "current"
    ? "snapshotTaskCurrent"
    : next.kind === "history"
      ? "snapshotTaskHistory"
      : "snapshotTaskEmpty";
  const primary = next.snapshot ? (
    <Button asChild className={actionClass}>
      <a href={`/api/reports/snapshots/${next.snapshot.id}?format=json`}>{t("downloadCurrentJson")}</a>
    </Button>
  ) : (
    <Button asChild className={actionClass}>
      <Link href={observationsHref} prefetch={false}>{t("openObservations")}</Link>
    </Button>
  );

  return (
    <ReportCanvas
      title={t("title")}
      summary={(
        <div className="max-w-2xl space-y-2">
          <p role="status" className="break-words text-sm leading-7 text-muted-foreground">{t(taskKey)}</p>
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
      )}
      primary={primary}
      relatedLabel={t("relatedEntries")}
      related={relatedLinks(t, brandId).filter((item) => next.snapshot || item.href !== observationsHref)}
    >
      <ReportEntryPanel
        key={publicationId ?? brandId}
        brandId={brandId}
        publications={publications}
        publicationId={publicationId}
        error={actionError ? t(actionError) : null}
        downgraded={params.notice === "diagnostic-downgrade"}
        t={t}
      />
      {mockLane && (
        <div className="space-y-2">
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("mockRetestNote")}</p>
          <ApplyMockRetestButton
            brandId={brandId}
            label={t("applyMockRetest")}
            pendingLabel={t("mockRetestPending")}
            doneLabel={t("mockRetestDone")}
            failedLabel={t("mockRetestFailed")}
          />
        </div>
      )}

      <section className="space-y-3" aria-labelledby="retests-heading">
        <h2 id="retests-heading" className="text-lg font-semibold">{t("retests")}</h2>
        {result.retests.length === 0 ? (
          <p className={emptyClass}>{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {result.retests.map((item) => (
              <li key={item.id} className={itemClass}>
                <p className="break-words font-medium">{item.kind} · {item.status} · {item.intent}</p>
                <p className="mt-1 break-all text-muted-foreground">{item.id}</p>
                {readSavedWindows(item.comparisonJson) && !openRetests.has(item.id)
                  && (item.status === "completed" || item.status === "inconclusive") ? (
                  <form action={generateSavedSnapshotAction} className="mt-3">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="retestId" value={item.id} />
                    <Button type="submit" variant="outline" className={actionClass}>{t("generateSnapshot")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="todos-heading">
        <h2 id="todos-heading" className="text-lg font-semibold">{t("todos")}</h2>
        {result.todos.length === 0 ? (
          <p className={emptyClass}>{t("todosEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {result.todos.map((item) => {
              const progress = item.status === "scheduled" ? readTodoProgress(item.progressJson) : null;
              return (
                <li key={item.id} className={itemClass}>
                  <p className="break-words font-medium">{t("todoLine", { status: item.status, due: item.dueAt })}</p>
                  {progress ? (
                    <p className="mt-1 break-words text-muted-foreground">
                      {t("reminderProgress", { elapsed: progress.elapsedFullDays, remaining: progress.remainingFullDays })}
                    </p>
                  ) : null}
                  <p className="mt-1 text-muted-foreground">{t("noAutoCharge")}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="snapshots-heading">
        <h2 id="snapshots-heading" className="text-lg font-semibold">{t("snapshots")}</h2>
        {result.snapshots.length === 0 ? (
          <p className={emptyClass}>{t("snapshotsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {result.snapshots.map((item) => (
              <li key={item.id} className={itemClass}>
                <p className="break-words font-medium">
                  {t("snapshotLine", {
                    grade: item.grade,
                    intent: item.intent,
                    loop: item.loopCompleted ? t("loopYes") : t("loopNo"),
                  })}
                </p>
                <p className="mt-1 [overflow-wrap:anywhere] text-muted-foreground">
                  {t("snapshotStatus", { status: item.status })}
                  {item.predecessorId ? ` · ${t("snapshotPrevious", { id: item.predecessorId })}` : ""}
                </p>
                <SnapshotSourceNote source={views.get(item.id)?.source ?? result.sources[item.id]} t={t} />
                <SnapshotReading id={item.id} brandId={brandId} view={views.get(item.id)} locale={locale} t={t} />
                <SnapshotDecision
                  rows={decisionsBySnapshot.get(item.id) ?? []}
                  canSave={Boolean(ownerView && views.get(item.id)?.comparisons)}
                  brandId={brandId}
                  snapshotId={item.id}
                  t={t}
                />
                {item.status === "created" && views.get(item.id)?.comparisons ? (
                  <form action={reviseSavedSnapshotAction} className="mt-3">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="snapshotId" value={item.id} />
                    <Button type="submit" variant="outline" className={actionClass}>{t("reviseSnapshot")}</Button>
                  </form>
                ) : null}
                <SnapshotCostLines
                  view={views.get(item.id)?.cost}
                  locale={locale}
                  unavailable={t("costUnavailable")}
                  absent={t("costAbsent")}
                />
                <p className="mt-3 flex flex-wrap gap-3">
                  <Link href={`/api/reports/snapshots/${item.id}?format=json`} prefetch={false} className="underline underline-offset-4">
                    {t("downloadJson")}
                  </Link>
                  <Link href={`/api/reports/snapshots/${item.id}?format=html`} prefetch={false} className="underline underline-offset-4">
                    {t("downloadHtml")}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {mockLane && (
        <section className="space-y-3 rounded-2xl border bg-card px-4 py-4" aria-labelledby="mock-gate-heading">
          <h2 id="mock-gate-heading" className="text-lg font-semibold">{t("mockGateTitle")}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{t("mockGateNote")}</p>
          <p className="text-sm leading-6">{t("mockGateInputs")}</p>
          <p className="text-sm font-medium">{mockGate.passed ? t("mockGatePassed") : t("mockGateRefused")}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
            {mockGate.missing.map((code) => <li key={code}>{mockGateLabels[code] ?? code}</li>)}
          </ul>
          <p className="text-sm leading-6 text-muted-foreground">{t("mockGateContract")}</p>
        </section>
      )}
    </ReportCanvas>
  );
}
