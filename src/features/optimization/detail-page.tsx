import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authorizeBrandActor } from "../team-access/brand-scope";
import { readTaskDetail } from "./commands";
import { taskDisplayLabels, taskStatusOptions } from "./task-labels.ts";
import { TaskUpdateForm } from "./task-update-form";

const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";
const actionClass = "h-auto min-h-9 max-w-full whitespace-normal text-left";

export async function generateMetadata() {
  const t = await getTranslator("optimization");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

export default async function OptimizationDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const session = await requireSession();
  const { taskId } = await params;
  const locale = await getLocale();
  const messages = getMessages(locale).evidenceOverview;
  const t = await getTranslator("optimization");
  const connection = getConnection();
  const detail = await readTaskDetail(connection, session.user.id, taskId);
  if ("error" in detail) notFound();

  const { task, findings, checks } = detail;
  const canWrite = Boolean(await authorizeBrandActor(connection, session.user.id, task.brandId, "write"));
  const labels = taskDisplayLabels(messages, task);
  const publicStatusLabels = {
    reachable: t("fixtureReachable"),
    restricted: t("fixtureRestricted"),
    pending_verification: t("pageCheckPending"),
    not_applicable: t("pageCheckNotApplicable"),
  };
  const savedDetails = [
    { label: t("completionNote"), value: task.completionNote },
    { label: t("dismissReason"), value: task.dismissReason },
    { label: t("manualRank"), value: task.manualRank == null ? null : new Intl.NumberFormat(locale).format(task.manualRank) },
    { label: t("reorderReason"), value: task.reorderReason },
  ].filter(({ value }) => value);

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <Button asChild variant="outline" className={actionClass}>
          <Link href={`/dashboard/optimization?brandId=${encodeURIComponent(task.brandId)}`} prefetch={false}>
            {t("backToList")}
          </Link>
        </Button>
        <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight">{task.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{labels.priority}</Badge>
          <Badge variant="secondary">{labels.status}</Badge>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href="#update-status">{t("updateTitle")}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link
                href={`/dashboard/content?brandId=${encodeURIComponent(task.brandId)}&taskId=${encodeURIComponent(task.id)}&cluster=${encodeURIComponent(task.questionCluster)}&primaryPage=${encodeURIComponent(task.targetPage)}#new-brief-heading`}
                prefetch={false}
              >
                {t("createBrief")}
              </Link>
            </Button>
          </div>
        ) : null}
        <dl className="wrap-anywhere max-w-2xl space-y-1 text-sm">
          <dt className="font-medium">{t("targetPage")}</dt>
          <dd className="text-muted-foreground">{task.targetPage}</dd>
        </dl>
      </header>

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{t("findings")}</h2>
        <ul className="space-y-4">
          {findings.map((finding) => (
            <li key={finding.id} className="wrap-anywhere rounded-xl border px-4 py-4 text-sm leading-7">
              <p className="font-medium">{finding.problemStatement}</p>
              <p className="mt-2 text-muted-foreground">{finding.hypothesis}</p>
              <p className="mt-2">{finding.evidenceSummary}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("assumption")}: {finding.assumptionLevel}
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                {(JSON.parse(finding.stepsJson) as string[]).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3"><span className="font-medium">{t("completion")}:</span> {finding.completionCriteria}</p>
              <p><span className="font-medium">{t("retest")}:</span> {finding.retestMethod}</p>
            </li>
          ))}
        </ul>
      </section>

      {checks.length > 0 ? (
        <section aria-labelledby="task-page-checks" className={panelClass}>
          <h2 id="task-page-checks" className="text-lg font-semibold">{t("pageChecks")}</h2>
          <ul className="space-y-3">
            {checks.map((check) => (
              <li key={check.id} className="wrap-anywhere rounded-xl border px-4 py-3 text-sm">
                <p className="font-medium">{check.normalizedUrl}</p>
                <p className="mt-1 text-muted-foreground">{publicStatusLabels[check.publicStatus]} · {check.accessCondition}</p>
                <p className="mt-2">{check.discoverabilityNotes}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canWrite || savedDetails.length > 0 ? (
        <section id="update-status" tabIndex={-1} aria-labelledby="task-update-title" className={`${panelClass} scroll-mt-20`}>
          <h2 id="task-update-title" className="text-lg font-semibold">{canWrite ? t("updateTitle") : t("recordedDetails")}</h2>
          {savedDetails.length > 0 ? (
            <div role="group" aria-labelledby="task-recorded-details" className="wrap-anywhere space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <h3 id="task-recorded-details" className="font-semibold">{t("recordedDetails")}</h3>
              <dl className="space-y-2">
                {savedDetails.map(({ label, value }) => (
                  <div key={label}>
                    <dt className="font-medium">{label}</dt>
                    <dd className="whitespace-pre-wrap text-muted-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {canWrite ? (
            <>
              <p id="task-update-hint" className="text-sm leading-6 text-muted-foreground">{t("updateHint")}</p>
              <TaskUpdateForm
                key={task.id}
                brandId={task.brandId}
                taskId={task.id}
                initialStatus={task.status}
                options={taskStatusOptions(messages)}
                labels={{
                  status: t("status"),
                  completionNote: t("completionNote"),
                  dismissReason: t("dismissReason"),
                  manualRank: t("manualRank"),
                  reorderReason: t("reorderReason"),
                  save: t("save"),
                  saving: t("savingTask"),
                }}
                feedback={{
                  saved: t("taskSaved"),
                  INVALID_INPUT: t("taskUpdateInvalid"),
                  FORBIDDEN: t("FORBIDDEN"),
                  NOT_FOUND: t("NOT_FOUND"),
                  SERVICE_UNAVAILABLE: t("SERVICE_UNAVAILABLE"),
                }}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
