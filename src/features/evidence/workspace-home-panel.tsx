import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { TaskSummaryList } from "../optimization/task-summary.tsx";
import { MetricCard } from "./metric-card.tsx";
import { readWorkspaceHome, workspaceEntryHrefs } from "./workspace-home.ts";

const entryOrder = ["brands", "monitoring", "optimization", "content", "reports"] as const;

function formatRate(locale: "zh-CN" | "en", value: number | null) {
  if (value == null) return "N/A";
  return formatPercent(locale, value);
}

export async function WorkspaceHomePanel({ ownerId }: { ownerId: string }) {
  const locale = await getLocale();
  const dashboard = await getTranslator("dashboard");
  const overview = await getTranslator("evidenceOverview");
  const evidence = await getTranslator("evidence");
  const messages = getMessages(locale);
  const home = await readWorkspaceHome(getConnection(), ownerId);
  const entries = entryOrder.map((id) => ({ id, href: workspaceEntryHrefs[id] }));

  if (home.state === "no-brand") {
    return (
      <section aria-labelledby="home-summary-title" className="space-y-5 rounded-2xl border bg-card p-6">
        <div>
          <h2 id="home-summary-title" className="text-lg font-semibold">{dashboard("noBrandTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{dashboard("noBrandBody")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={workspaceEntryHrefs.brands} prefetch={false}>{dashboard("goBrands")}</Link>
          </Button>
        </div>
        <EntryNav label={dashboard("entriesTitle")} entries={entries.filter((item) => item.id !== "brands")} titleFor={(id) => messages.modules[moduleTitleKey(id)]} openLabel={(title) => dashboard("openEntry", { title })} />
      </section>
    );
  }

  if (home.state === "unavailable") {
    return (
      <section aria-labelledby="home-summary-title" className="rounded-2xl border bg-card p-6">
        <h2 id="home-summary-title" className="text-lg font-semibold">{overview("title")}</h2>
        <p role="alert" className="mt-3 text-sm leading-7">{evidence(home.error)}</p>
      </section>
    );
  }

  const view = home.overview;
  const metrics = [
    ["mentionRate", view.metrics.mentioned] as const,
    ["recommendRate", view.metrics.recommended] as const,
    ["officialCiteRate", view.metrics.officialSiteCited] as const,
  ];

  return (
    <section aria-labelledby="home-summary-title" className="space-y-6">
      <div className="space-y-3">
        <h2 id="home-summary-title" className="text-lg font-semibold">{overview("title")}</h2>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {dashboard("scopeDefault", { brand: view.scope.brandName })}
        </p>
        <EntryNav
          label={dashboard("entriesTitle")}
          entries={entries}
          titleFor={(id) => messages.modules[moduleTitleKey(id)]}
          openLabel={(title) => dashboard("openEntry", { title })}
        />
      </div>

      {view.smallSample ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground" role="status">
          {overview("smallSample")}
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{dashboard("metricsTitle")}</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {metrics.map(([key, metric]) => (
            <MetricCard
              key={key}
              title={overview(key)}
              metric={metric}
              locale={locale}
              equalWeightHint={overview("equalWeightHint", {
                covered: formatNumber(locale, metric.coveredQuestions),
                fixed: formatNumber(locale, metric.fixedQuestions),
              })}
              pooledHint={overview("pooledHint", {
                rate: formatRate(locale, metric.pooled.rate),
                num: formatNumber(locale, metric.pooled.numerator),
                den: formatNumber(locale, metric.pooled.denominator),
              })}
              unknownRatioLabel={overview("unknownRatio", {
                ratio: formatRate(locale, metric.unknownRatio),
              })}
              metricNa={overview("metricNa")}
              officialNa={overview("officialNa")}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{overview("suggestions")}</h3>
        <TaskSummaryList items={view.suggestions} messages={messages.evidenceOverview} empty={overview("suggestionsEmpty")} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{overview("activeTasks")}</h3>
        <TaskSummaryList items={view.activeTasks} messages={messages.evidenceOverview} empty={overview("activeTasksEmpty")} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{dashboard("nextTitle")}</h3>
        <div className="flex flex-wrap gap-2">
          {view.nextActions.map((action) => (
            <Button key={action.id} asChild variant={action.kind === "start_monitoring" ? "default" : "outline"}>
              <Link href={action.href} prefetch={false}>{nextLabel(overview, action.kind)}</Link>
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

function moduleTitleKey(id: (typeof entryOrder)[number]) {
  switch (id) {
    case "brands": return "brandsTitle" as const;
    case "monitoring": return "monitoringTitle" as const;
    case "optimization": return "optimizationTitle" as const;
    case "content": return "contentTitle" as const;
    case "reports": return "reportsTitle" as const;
  }
}

function nextLabel(
  overview: (key: "startMonitoring" | "viewAnswers" | "viewTasks") => string,
  kind: "start_monitoring" | "view_answers" | "view_tasks",
) {
  switch (kind) {
    case "start_monitoring": return overview("startMonitoring");
    case "view_answers": return overview("viewAnswers");
    case "view_tasks": return overview("viewTasks");
  }
}

function EntryNav({
  label,
  entries,
  titleFor,
  openLabel,
}: {
  label: string;
  entries: Array<{ id: string; href: string }>;
  titleFor: (id: (typeof entryOrder)[number]) => string;
  openLabel: (title: string) => string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const title = titleFor(entry.id as (typeof entryOrder)[number]);
          return (
            <li key={entry.id}>
              <Button asChild variant="outline">
                <Link href={entry.href} prefetch={false}>{openLabel(title)}</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
