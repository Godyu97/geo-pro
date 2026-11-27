import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { PromptDao } from "../prompts/dao";
import { authorizeBrandActor, workspaceBrand } from "../team-access/brand-scope";
import { windowIdSchema } from "./contracts";
import {
  arriveSamplingPlanAction,
  createSamplingPlanAction,
  driveDueSamplingWindowAction,
  expireSamplingChannelAction,
  reviseSamplingBudgetAction,
  saveSamplingTrendThresholdAction,
  transitionSamplingPlanAction,
} from "./actions";
import { listSamplingPlans } from "./commands";
import type { SamplingPlanView } from "./commands";
import { listAttachableOfficialRuns, listSamplingDueWindows, manualSheetsForBrand, readSamplingWindowDetail } from "./due-commands";
import { ManualSheetQuestions } from "./manual-sheet-questions";

const fieldClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const knownErrors = ["PLAN_PHASE_CONFLICT", "NOT_FOUND", "FORBIDDEN", "INVALID_INPUT", "EXISTING_RUN_REJECTED", "VERSION_CONFLICT"] as const;
const phases = ["draft", "active", "paused", "ended"] as const;
const statuses = ["scheduled", "completed", "failed", "paused"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function showTime(locale: Locale, value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(locale, date);
}

export async function generateMetadata() {
  const t = await getTranslator("samplingPlans");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SamplingPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("samplingPlans");
  const monitoring = await getTranslator("monitoring");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const requestedBrandId = typeof params.brandId === "string" && params.brandId.trim() ? params.brandId.trim() : undefined;
  if (requestedBrandId !== undefined && !brandIdSchema.safeParse(requestedBrandId).success) notFound();
  const connection = getConnection();
  const phaseLabel = {
    draft: t("phaseDraft"),
    active: t("phaseActive"),
    paused: t("phasePaused"),
    ended: t("phaseEnded"),
  } as const;
  const statusLabel = {
    scheduled: t("statusScheduled"),
    completed: t("statusCompleted"),
    failed: t("statusFailed"),
    paused: t("statusPaused"),
  } as const;
  const amount = (currency: string, minor: number) => t("amountMinor", {
    currency,
    amount: formatNumber(locale, minor),
  });

  if (params.planId !== undefined || params.windowId !== undefined) {
    if (typeof params.planId !== "string" || typeof params.windowId !== "string") notFound();
    const parsedPlan = brandIdSchema.safeParse(params.planId);
    const parsedWindow = windowIdSchema.safeParse(params.windowId);
    if (!parsedPlan.success || !parsedWindow.success) notFound();
    const focused = await readSamplingWindowDetail(connection, session.user.id, parsedPlan.data, parsedWindow.data);
    if ("error" in focused) notFound();
    const { detail } = focused;
    if (requestedBrandId && detail.brandId !== requestedBrandId) notFound();
    const detailBrandQuery = requestedBrandId ? `?brandId=${encodeURIComponent(detail.brandId)}` : "";
    const alertsT = await getTranslator("qualityAlerts");
    const runStatusLabel = {
      queued: "statusQueued",
      running: "statusRunning",
      paused: "statusPaused",
      succeeded: "statusSucceeded",
      partial: "statusPartial",
      failed: "statusFailed",
      cancelled: "statusCancelled",
    } as const;
    const alertKindLabel = { data_quality: alertsT("kindDataQuality"), trend: alertsT("kindTrend") } as const;
    const alertReasonLabel = {
      coverage_insufficient: alertsT("reasonCoverage"),
      citation_field_changed: alertsT("reasonCitation"),
      mode_changed: alertsT("reasonMode"),
      recommendation_drop: alertsT("reasonTrend"),
    } as const;
    const failedSlotCount = detail.slots.filter((slot) => slot.status === "failed").length;
    const denominatorCount = detail.slots.filter((slot) => slot.status === "completed" || slot.status === "failed").length;
    const sheetByRun = new Map(detail.manualSheets.map((sheet) => [sheet.runId, sheet]));
    return (
      <div className="min-w-0 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{t("windowDetailTitle")}</h1>
            {detail.brandName ? (
              <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{detail.brandName}</p>
            ) : null}
          </div>
          <div className="flex max-w-full flex-wrap gap-2">
            <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
              <Link href={`/dashboard/monitoring/alerts${detailBrandQuery}`} prefetch={false}>{t("backAlerts")}</Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
              <Link href={`/dashboard/monitoring/plans${detailBrandQuery}`} prefetch={false}>{t("allPlans")}</Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
              <Link href={`/dashboard/monitoring/overview${detailBrandQuery}`} prefetch={false}>{t("backOverview")}</Link>
            </Button>
          </div>
        </header>

        <section className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <p className="font-mono text-sm [overflow-wrap:anywhere]">
            {t("windowMetaPlan", {
              id: detail.plan.id,
              version: formatNumber(locale, detail.plan.version),
              phase: phaseLabel[detail.plan.phase],
            })}
          </p>
          <p className="text-sm font-medium wrap-anywhere">
            {t("windowMetaScope", { window: detail.reading.windowId, timezone: detail.reading.timezone })}
          </p>
          <dl className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-4">
            {([
              [t("windowPlannedLabel"), detail.reading.plannedCount],
              [t("windowEligibleLabel"), detail.reading.eligibleCount],
              [t("windowJudgedLabel"), detail.reading.judgedCount],
              [t("windowRecommendedLabel"), detail.reading.recommendedCount],
            ] as const).map(([label, count]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground wrap-anywhere">{label}</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">{formatNumber(locale, count)}</dd>
              </div>
            ))}
          </dl>
          {detail.reading.coverageSufficient ? null : <p className="text-sm wrap-anywhere">{t("readingCoverage")}</p>}
          <p className="text-sm text-muted-foreground wrap-anywhere">
            {detail.reading.waitingForTrend
              ? t("readingWaiting", { count: formatNumber(locale, detail.reading.comparableWindows) })
              : t("readingReady")}
          </p>
          {detail.alert ? (
            <div className="min-w-0 space-y-1 rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="wrap-anywhere">
                {t("windowLinkedAlert", {
                  kind: alertKindLabel[detail.alert.kind],
                  reason: alertReasonLabel[detail.alert.reason],
                })}
              </p>
              {detail.alert.claimBrandDecline ? null : (
                <p className="text-muted-foreground wrap-anywhere">{t("windowNoDecline")}</p>
              )}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="window-runs-heading" className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <h2 id="window-runs-heading" className="text-lg font-semibold">{t("windowRunsTitle")}</h2>
          {detail.acceptedRuns.length === 0 && detail.reservedRuns.length === 0 && detail.manualSheets.length === 0 ? (
            <p className="text-sm text-muted-foreground wrap-anywhere">{t("windowNoRuns")}</p>
          ) : (
            <div className="min-w-0 space-y-3">
              {detail.acceptedRuns.map((run) => {
                const statusKey = run.runStatus && run.runStatus in runStatusLabel
                  ? runStatusLabel[run.runStatus as keyof typeof runStatusLabel]
                  : null;
                return (
                  <div key={run.dueRunId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]">
                    <p className="font-mono text-xs [overflow-wrap:anywhere]">
                      {t("windowRunItem", {
                        id: run.monitoringRunId,
                        slot: run.slotId,
                        channel: run.channelId,
                        amount: amount(detail.plan.currency, run.chargedMinor),
                      })}
                    </p>
                    {statusKey ? (
                      <>
                        <p className="tabular-nums wrap-anywhere">
                          {t("windowRunCounts", {
                            status: monitoring(statusKey),
                            total: formatNumber(locale, run.slotCount),
                            succeeded: formatNumber(locale, run.succeededSlotCount),
                            failed: formatNumber(locale, run.failedSlotCount),
                            answers: formatNumber(locale, run.observationCount),
                          })}
                        </p>
                        {run.observationCount === 0 ? (
                          <p className="text-muted-foreground wrap-anywhere">{t("windowRunNoAnswers")}</p>
                        ) : null}
                        <Button asChild variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal">
                          <Link href={`/dashboard/monitoring/runs/${encodeURIComponent(run.monitoringRunId)}`} prefetch={false}>
                            {t("windowRunOpenDetail")}
                          </Link>
                        </Button>
                      </>
                    ) : (
                      <p className="text-muted-foreground wrap-anywhere">{t("windowRunMissing")}</p>
                    )}
                  </div>
                );
              })}
              {detail.reservedRuns.map((run) => (
                <div key={run.id} className="min-w-0 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]">
                  <p>{t("dueReserved", { slot: run.slotId })}</p>
                </div>
              ))}
              {detail.manualSheets.map((sheet) => {
                const resolved = sheetByRun.get(sheet.runId);
                return (
                  <div key={sheet.runId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]">
                    <p className="font-medium [overflow-wrap:anywhere]">{t("dueSheet", { slot: sheet.slotId })}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {resolved?.versionVerified && resolved.promptSetId && resolved.promptSetVersion !== null
                        ? t("dueSheetFrozenVersion", {
                          version: formatNumber(locale, resolved.promptSetVersion),
                          id: resolved.promptSetId,
                        })
                        : t("dueSheetVersionUnverified")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="window-slots-heading" className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <h2 id="window-slots-heading" className="text-lg font-semibold">{t("windowSlotsTitle")}</h2>
          <p className="text-sm wrap-anywhere">{t("coverageLine", { count: formatNumber(locale, denominatorCount) })}</p>
          {failedSlotCount > 0 ? (
            <p className="text-sm font-medium wrap-anywhere">
              {t("windowFailedSlotsKept", { count: formatNumber(locale, failedSlotCount) })}
            </p>
          ) : null}
          {detail.slots.length === 0 ? (
            <p className="text-sm text-muted-foreground wrap-anywhere">{t("windowNoSlots")}</p>
          ) : (
            <div role="region" aria-label={t("windowSlotsTitle")} tabIndex={0}
              className="max-w-full overflow-x-auto rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium" scope="col">{t("slotAt")}</th>
                    <th className="px-4 py-3 font-medium" scope="col">{t("channel")}</th>
                    <th className="px-4 py-3 font-medium" scope="col">{t("status")}</th>
                    <th className="px-4 py-3 font-medium" scope="col">{t("manual")}</th>
                    <th className="px-4 py-3 font-medium" scope="col">{t("costMinor")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.slots.map((slot) => (
                    <tr key={slot.id} className="border-t">
                      <td className="whitespace-nowrap px-4 py-3">{showTime(locale, slot.at)}</td>
                      <td className="min-w-36 max-w-48 px-4 py-3 [overflow-wrap:anywhere]">{slot.channelId}</td>
                      <td className="whitespace-nowrap px-4 py-3">{statusLabel[slot.status]}</td>
                      <td className="whitespace-nowrap px-4 py-3">{slot.manual ? t("manualYes") : t("manualNo")}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{amount(detail.plan.currency, slot.costMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  const scope = await workspaceBrand(connection, session.user.id, requestedBrandId, "read");
  if (requestedBrandId && !scope) notFound();

  if (!scope) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const [brand, writeScope, listed, attachable] = await Promise.all([
    new BrandDao(connection).version(scope.ownerId, scope.brandId),
    authorizeBrandActor(connection, session.user.id, scope.brandId, "write"),
    listSamplingPlans(connection, session.user.id, scope.brandId),
    listAttachableOfficialRuns(connection, session.user.id, scope.brandId),
  ]);
  if (!brand) notFound();
  const canWrite = Boolean(writeScope);
  const brandQuery = requestedBrandId ? `?brandId=${encodeURIComponent(scope.brandId)}` : "";
  const brandParam = requestedBrandId ? `&brandId=${encodeURIComponent(scope.brandId)}` : "";
  const returnBrandInput = requestedBrandId
    ? <input type="hidden" name="returnBrandId" value={scope.brandId} />
    : null;
  const plans: SamplingPlanView[] = "error" in listed ? [] : listed.plans;
  const due = plans.length === 0
    ? { runs: [], readings: [] }
    : await listSamplingDueWindows(connection, session.user.id, plans.map((plan) => plan.id));
  const sheets = await manualSheetsForBrand(connection, scope.brandId, due.runs);
  const sheetByRun = new Map(sheets.map((sheet) => [sheet.runId, sheet]));
  const promptVersions = canWrite && plans.some((plan) => plan.phase === "active")
    ? (await new PromptDao(connection, scope.brandId).versions()).slice(0, 20).map((set) => ({
      id: set.id,
      version: set.version,
      questions: set.content.questions
        .filter((question) => question.status === "confirmed")
        .map(({ id, text }) => ({ id, text })),
    }))
    : [];
  const { promptSetVersion, promptSetOption, manualSheetQuestions, manualSheetSelection, manualSheetNoQuestions } = getMessages(locale).samplingPlans;

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{brand.fields.name}</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex max-w-full flex-wrap gap-2">
          {canWrite ? (
            <Button asChild variant={plans.length === 0 ? "default" : "outline"} className="h-auto min-h-8 max-w-full whitespace-normal">
              <a href="#new-sampling-plan">{t("createTitle")}</a>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
            <Link href={`/dashboard/monitoring/alerts${brandQuery}`} prefetch={false}>{t("openAlerts")}</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
            <Link href={`/dashboard/monitoring/overview${brandQuery}`} prefetch={false}>{t("backOverview")}</Link>
          </Button>
        </div>
      </header>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <section aria-labelledby="attachable-runs-title" className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <h2 id="attachable-runs-title" className="text-lg font-semibold">{t("completedRunsTitle")}</h2>
        {attachable.length === 0 ? (
          <p className="text-sm text-muted-foreground wrap-anywhere">{t("completedRunsEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-2">
            {attachable.map((run) => (
              <li key={run.id} className="font-mono text-sm [overflow-wrap:anywhere]">
                {t("completedRunLine", {
                  id: run.id,
                  at: run.createdAt,
                  channel: run.channelId,
                  amount: amount(run.currency, run.knownMinor),
                })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {plans.length === 0 ? (
        "error" in listed ? null : (
          <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        )
      ) : plans.map((plan) => (
        <section key={plan.id} aria-labelledby={`plan-${plan.id}`} className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id={`plan-${plan.id}`} className="text-lg font-semibold">{t("currentVersion", { version: plan.version })}</h2>
            <Badge variant="secondary">{phaseLabel[plan.phase]}</Badge>
          </div>
          <dl className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-3">
            {([
              [t("budgetMinor"), plan.budgetMinor],
              [t("spentMinor"), plan.spentMinor],
              [t("pendingMinor"), plan.pendingMinor],
            ] as const).map(([label, minor]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">{amount(plan.currency, minor)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{t("minorUnit")}</p>
          <p className="text-sm">{t("currentThreshold", { value: formatNumber(locale, plan.trendThresholdPp) })}</p>
          <ul className="space-y-1 text-sm">
            {plan.versions.map((item) => (
              <li key={item.version}>
                {t("versionBudget", { version: item.version, amount: amount(item.currency, item.budgetMinor) })}
                {" "}
                {t("versionThreshold", { value: formatNumber(locale, item.trendThresholdPp) })}
              </li>
            ))}
          </ul>
          <p className="text-sm">{t("coverageLine", { count: plan.coverageSlotIds.length })}</p>
          {due.runs.filter((run) => run.planId === plan.id).map((run) => {
            const sheet = run.kind === "manual" ? sheetByRun.get(run.id) : undefined;
            return run.kind === "manual" ? (
              <div key={run.id} className="space-y-2 rounded-xl border p-3 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{t("dueSheet", { slot: run.slotId })}</p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {sheet?.versionVerified && sheet.promptSetId && sheet.promptSetVersion !== null
                    ? t("dueSheetFrozenVersion", {
                      version: formatNumber(locale, sheet.promptSetVersion),
                      id: sheet.promptSetId,
                    })
                    : t("dueSheetVersionUnverified")}
                </p>
                <ul className="space-y-2">
                  {(sheet?.lines ?? []).map((line, index) => (
                    <li key={`${run.id}-${index}`} className="rounded-xl border px-3 py-2">
                      <p>{t("dueSheetManual")}</p>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{line.id}</p>
                      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {line.missing
                          ? (sheet?.versionVerified ? t("duePromptMissing") : t("duePromptUnverified"))
                          : line.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div key={run.id} className="space-y-3 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]">
                {run.status === "accepted" && run.monitoringRunId ? (
                  <>
                    <p>{t("dueOfficial", { slot: run.slotId, run: run.monitoringRunId, amount: amount(plan.currency, run.chargedMinor) })}</p>
                    <Button asChild variant="outline">
                      <Link href={`/dashboard/monitoring/runs/${encodeURIComponent(run.monitoringRunId)}`} prefetch={false}>
                        {monitoring("openRun", { id: run.monitoringRunId.slice(0, 8) })}
                      </Link>
                    </Button>
                  </>
                ) : <p>{t("dueReserved", { slot: run.slotId })}</p>}
              </div>
            );
          })}
          {due.readings.filter((reading) => reading.planId === plan.id).map((reading) => (
            <div key={reading.windowId} className="space-y-1 text-sm">
              <p>{t("readingLine", {
                window: reading.windowId,
                planned: formatNumber(locale, reading.plannedCount),
                eligible: formatNumber(locale, reading.eligibleCount),
              })}</p>
              <p className="text-muted-foreground">
                {reading.waitingForTrend
                  ? t("readingWaiting", { count: formatNumber(locale, reading.comparableWindows) })
                  : t("readingReady")}
              </p>
              <Button asChild variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal">
                <Link href={`/dashboard/monitoring/plans?planId=${encodeURIComponent(plan.id)}&windowId=${encodeURIComponent(reading.windowId)}${brandParam}`} prefetch={false}>
                  {t("openWindow")}
                </Link>
              </Button>
              {reading.coverageSufficient ? null : <p>{t("readingCoverage")}</p>}
            </div>
          ))}
          {canWrite && plan.phase === "active" ? (
            <form action={driveDueSamplingWindowAction} className="space-y-3 rounded-xl border p-4">
              <h3 className="text-sm font-medium">{t("driveTitle")}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{t("driveHint")}</p>
              {returnBrandInput}
              <input type="hidden" name="planId" value={plan.id} />
              {plan.slots.map((slot) => <input key={slot.id} type="hidden" name="channelId" value={slot.channelId} />)}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("timezone")}</span>
                  <input name="timezone" required defaultValue="Asia/Shanghai" maxLength={64} className={fieldClass} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("degradeChannel")}</span>
                  <input name="degradeChannelId" maxLength={64} className={fieldClass} />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">{t("existingRun")}</span>
                  <select name="existingRunId" defaultValue="" className={fieldClass}>
                    <option value="">{t("existingRunNone")}</option>
                    {attachable
                      .filter((run) => plan.slots.some((slot) => !slot.manual && slot.channelId === run.channelId))
                      .map((run) => (
                        <option key={run.id} value={run.id}>
                          {t("existingRunOption", {
                            id: run.id.slice(0, 8),
                            at: run.createdAt,
                            amount: amount(run.currency, run.knownMinor),
                          })}
                        </option>
                      ))}
                  </select>
                  <span className="mt-1 block text-xs text-muted-foreground">{t("existingRunHint")}</span>
                </label>
                {promptVersions.length > 0 ? (
                  <ManualSheetQuestions key={promptVersions[0]?.id} versions={promptVersions} locale={locale} fieldClass={fieldClass}
                    messages={{ promptSetVersion, promptSetOption, manualSheetQuestions, manualSheetSelection, manualSheetNoQuestions }} />
                ) : (
                  <p className="text-sm text-muted-foreground sm:col-span-2">{t("noPromptSet")}</p>
                )}
              </div>
              <Button type="submit" variant="outline">{t("driveWindow")}</Button>
            </form>
          ) : null}
          <div role="region" aria-label={t("slotSchedule")} tabIndex={0}
            className="max-w-full overflow-x-auto rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium" scope="col">{t("slotAt")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("channel")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("status")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("manual")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("costMinor")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.slots.map((slot) => (
                  <tr key={slot.id} className="border-t">
                    <td className="whitespace-nowrap px-4 py-3">{showTime(locale, slot.at)}</td>
                    <td className="min-w-36 max-w-48 px-4 py-3 [overflow-wrap:anywhere]">{slot.channelId}</td>
                    <td className="whitespace-nowrap px-4 py-3">{statusLabel[slot.status]}</td>
                    <td className="whitespace-nowrap px-4 py-3">{slot.manual ? t("manualYes") : t("manualNo")}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{amount(plan.currency, slot.costMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canWrite && plan.phase === "draft" ? (
            <form action={saveSamplingTrendThresholdAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              {returnBrandInput}
              <input type="hidden" name="planId" value={plan.id} />
              <div className="text-sm">
                <label>
                  <span className="mb-1 block text-muted-foreground">{t("draftThreshold")}</span>
                  <input name="trendThresholdPp" inputMode="decimal" defaultValue={plan.trendThresholdPp} className={fieldClass} />
                </label>
                <span className="mt-1 block text-xs text-muted-foreground">{t("trendThresholdHint")}</span>
              </div>
              <Button type="submit" variant="outline">{t("saveThreshold")}</Button>
            </form>
          ) : null}

          {canWrite ? (
            <>
              <form action={reviseSamplingBudgetAction} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                {returnBrandInput}
                <input type="hidden" name="planId" value={plan.id} />
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("newBudget")}</span>
                  <input name="budgetMinor" required inputMode="numeric" className={fieldClass} />
                </label>
                <div className="text-sm">
                  <label>
                    <span className="mb-1 block text-muted-foreground">{t("newThreshold")}</span>
                    <input name="trendThresholdPp" inputMode="decimal" placeholder="10" className={fieldClass} />
                  </label>
                  <span className="mt-1 block text-xs text-muted-foreground">{t("newThresholdHint")}</span>
                </div>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("optionalNextAt")}</span>
                  <input name="nextAt" placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
                </label>
                <Button type="submit" variant="outline">{t("reviseBudget")}</Button>
              </form>

              <form action={transitionSamplingPlanAction} className="flex flex-wrap items-end gap-3">
                {returnBrandInput}
                <input type="hidden" name="planId" value={plan.id} />
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("phase")}</span>
                  <select name="phase" defaultValue={plan.phase} className={fieldClass}>
                    {phases.map((phase) => <option key={phase} value={phase}>{phaseLabel[phase]}</option>)}
                  </select>
                </label>
                <Button type="submit" variant="outline">{t("transition")}</Button>
              </form>

              <form action={arriveSamplingPlanAction} className="flex flex-wrap items-end gap-3">
                {returnBrandInput}
                <input type="hidden" name="planId" value={plan.id} />
                <label className="min-w-0 flex-1 basis-60 text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("arrive")}</span>
                  <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
                </label>
                <Button type="submit" variant="outline">{t("arrive")}</Button>
              </form>

              <form action={expireSamplingChannelAction} className="flex flex-wrap items-end gap-3">
                {returnBrandInput}
                <input type="hidden" name="planId" value={plan.id} />
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("channelId")}</span>
                  <input name="channelId" required maxLength={64} className={fieldClass} />
                </label>
                <label className="min-w-0 flex-1 basis-60 text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("nextAt")}</span>
                  <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
                </label>
                <Button type="submit" variant="outline">{t("expireChannel")}</Button>
              </form>
            </>
          ) : null}
        </section>
      ))}

      {canWrite ? (
        <form id="new-sampling-plan" aria-labelledby="new-sampling-plan-title" action={createSamplingPlanAction}
          className="min-w-0 scroll-mt-20 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
          <h2 id="new-sampling-plan-title" className="text-lg font-semibold">{t("createTitle")}</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("recordedSpend")}</p>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("consumerNote")}</p>
          {returnBrandInput}
          <input type="hidden" name="brandId" value={scope.brandId} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("phase")}</span>
            <select name="phase" defaultValue="active" className={fieldClass}>
              {phases.map((phase) => <option key={phase} value={phase}>{phaseLabel[phase]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("currency")}</span>
            <input name="currency" required maxLength={3} placeholder="CNY" className={fieldClass} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("budgetMinor")}</span>
            <input name="budgetMinor" required inputMode="numeric" className={fieldClass} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("spentMinor")}</span>
            <input name="spentMinor" required inputMode="numeric" className={fieldClass} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("pendingMinor")}</span>
            <input name="pendingMinor" required inputMode="numeric" className={fieldClass} />
          </label>
          <div className="text-sm">
            <label>
              <span className="mb-1 block text-muted-foreground">{t("trendThreshold")}</span>
              <input name="trendThresholdPp" inputMode="decimal" placeholder="10" className={fieldClass} />
            </label>
            <span className="mt-1 block text-xs text-muted-foreground">{t("trendThresholdHint")}</span>
          </div>
          <label className="text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-muted-foreground">{t("nextAt")}</span>
            <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
            <span className="mt-1 block text-xs text-muted-foreground">{t("windowHint")}</span>
          </label>
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <fieldset key={index} className="grid min-w-0 gap-3 rounded-xl border p-3 sm:grid-cols-2 xl:grid-cols-5">
              <legend className="px-1 text-xs text-muted-foreground">{t("slotLegend", { index: index + 1 })}</legend>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t("channel")}</span>
                <input name="channelId" maxLength={64} className={fieldClass} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t("slotAt")}</span>
                <input name="at" placeholder="2026-11-20T04:05:06.000Z" className={fieldClass} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t("status")}</span>
                <select name="status" defaultValue="scheduled" className={fieldClass}>
                  {statuses.map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t("manual")}</span>
                <select name="manual" defaultValue="1" className={fieldClass}>
                  <option value="1">{t("manualYes")}</option>
                  <option value="0">{t("manualNo")}</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t("costMinor")}</span>
                <input name="costMinor" inputMode="numeric" className={fieldClass} />
              </label>
            </fieldset>
          ))}
        </div>
        <Button type="submit">{t("savePlan")}</Button>
      </form>
      ) : null}
    </div>
  );
}
