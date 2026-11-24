import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "@/features/brands/dao";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockRetestButton } from "@/features/functional-mock/run-buttons";
import { Button } from "@/components/ui/button";
import { presentSnapshotCost } from "./cost-copy";
import { listReports, snapshotCostViews, type SnapshotCostView } from "./commands";
import { m0StageGate } from "./m0-stage-gate";
import type { ReportError } from "./contracts";

const emptyClass = "rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const itemClass = "rounded-2xl border bg-card px-4 py-4 text-sm";
const relatedClass = "inline-flex min-w-0 max-w-full min-h-10 items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export async function generateMetadata() {
  const t = await getTranslator("reports");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function relatedLinks(t: Awaited<ReturnType<typeof getTranslator<"reports">>>) {
  return [
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
    <div className="space-y-8">
      <header className="space-y-3">
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
  searchParams: Promise<{ brandId?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslator("reports");
  const locale = await getLocale();
  const params = await searchParams;
  const connection = getConnection();
  const requestedBrand = typeof params.brandId === "string" ? params.brandId : undefined;
  const brandId = requestedBrand || (await new BrandDao(connection).active(session.user.id))?.id;
  const related = relatedLinks(t);
  const brandsAction = (
    <Button asChild>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );

  if (!brandId) {
    return (
      <ReportCanvas
        title={t("title")}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={related}
      />
    );
  }

  const result = await listReports(connection, session.user.id, brandId);
  const costViews = "error" in result
    ? new Map()
    : await snapshotCostViews(connection, session.user.id, result.snapshots);
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
  if ("error" in result) {
    const code = result.error as ReportError;
    return (
      <ReportCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7">{t(code)}</p>}
        primary={code === "NOT_FOUND" ? brandsAction : undefined}
        relatedLabel={t("relatedEntries")}
        related={related}
      />
    );
  }

  return (
    <ReportCanvas
      title={t("title")}
      summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
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
            {result.todos.map((item) => (
              <li key={item.id} className={itemClass}>
                <p className="break-words font-medium">{t("todoLine", { status: item.status, due: item.dueAt })}</p>
                <p className="mt-1 text-muted-foreground">{t("noAutoCharge")}</p>
              </li>
            ))}
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
                <p className="mt-1 break-words text-muted-foreground">
                  {t("snapshotStatus", { status: item.status })}
                  {item.predecessorId ? ` · ${t("snapshotPrevious", { id: item.predecessorId })}` : ""}
                </p>
                <SnapshotCostLines
                  view={costViews.get(item.id)}
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
