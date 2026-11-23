import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import {
  arriveSamplingPlanAction,
  createSamplingPlanAction,
  driveDueSamplingWindowAction,
  expireSamplingChannelAction,
  reviseSamplingBudgetAction,
  transitionSamplingPlanAction,
} from "./actions";
import { listSamplingPlans } from "./commands";
import type { SamplingPlanView } from "./commands";
import { listSamplingDueWindows } from "./due-commands";

const fieldClass = "h-10 w-full rounded-md border bg-background px-3";
const knownErrors = ["PLAN_PHASE_CONFLICT", "NOT_FOUND", "INVALID_INPUT", "VERSION_CONFLICT"] as const;
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
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
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

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listSamplingPlans(connection, session.user.id, active.id);
  const plans: SamplingPlanView[] = "error" in listed ? [] : listed.plans;
  const due = plans.length === 0
    ? { runs: [], readings: [] }
    : await listSamplingDueWindows(connection, session.user.id, plans.map((plan) => plan.id));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/monitoring/overview" prefetch={false}>{t("backOverview")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("recordedSpend")}</p>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("consumerNote")}</p>

      <form action={createSamplingPlanAction} className="space-y-4 rounded-2xl border bg-card p-5">
        <input type="hidden" name="brandId" value={active.id} />
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
          <label className="text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-muted-foreground">{t("nextAt")}</span>
            <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
            <span className="mt-1 block text-xs text-muted-foreground">{t("windowHint")}</span>
          </label>
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <fieldset key={index} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-5">
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

      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : plans.map((plan) => (
        <section key={plan.id} className="space-y-4 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("currentVersion", { version: plan.version })}</h2>
            <p className="text-sm">{phaseLabel[plan.phase]} · {amount(plan.currency, plan.budgetMinor)}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("minorUnit")}</p>
          <p className="text-sm text-muted-foreground">
            {t("spentMinor")} {amount(plan.currency, plan.spentMinor)} · {t("pendingMinor")} {amount(plan.currency, plan.pendingMinor)}
          </p>
          <ul className="space-y-1 text-sm">
            {plan.versions.map((item) => (
              <li key={item.version}>{t("versionBudget", { version: item.version, amount: amount(item.currency, item.budgetMinor) })}</li>
            ))}
          </ul>
          <p className="text-sm">{t("coverageLine", { count: plan.coverageSlotIds.length })}</p>
          {due.runs.filter((run) => run.planId === plan.id).map((run) => (
            <p key={run.id} className="text-sm">
              {run.kind === "manual"
                ? t("dueSheet", { slot: run.slotId })
                : run.status === "accepted"
                  ? t("dueOfficial", { slot: run.slotId, run: run.monitoringRunId ?? "", amount: amount(plan.currency, run.chargedMinor) })
                  : t("dueReserved", { slot: run.slotId })}
            </p>
          ))}
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
              {reading.coverageSufficient ? null : <p>{t("readingCoverage")}</p>}
            </div>
          ))}
          <p>
            <Link href="/dashboard/monitoring/alerts" prefetch={false} className="text-sm underline-offset-4 hover:underline">
              {t("openAlerts")}
            </Link>
          </p>
          {plan.phase === "active" ? (
            <form action={driveDueSamplingWindowAction} className="space-y-3 rounded-xl border p-4">
              <h3 className="text-sm font-medium">{t("driveTitle")}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{t("driveHint")}</p>
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
                  <span className="mb-1 block text-muted-foreground">{t("promptIds")}</span>
                  <input name="promptIds" className={fieldClass} />
                </label>
              </div>
              <Button type="submit" variant="outline">{t("driveWindow")}</Button>
            </form>
          ) : null}
          <div className="overflow-x-auto rounded-xl border">
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
                    <td className="px-4 py-3">{showTime(locale, slot.at)}</td>
                    <td className="px-4 py-3">{slot.channelId}</td>
                    <td className="px-4 py-3">{statusLabel[slot.status]}</td>
                    <td className="px-4 py-3">{slot.manual ? t("manualYes") : t("manualNo")}</td>
                    <td className="px-4 py-3">{amount(plan.currency, slot.costMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={reviseSamplingBudgetAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="planId" value={plan.id} />
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("newBudget")}</span>
              <input name="budgetMinor" required inputMode="numeric" className={fieldClass} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("optionalNextAt")}</span>
              <input name="nextAt" placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
            </label>
            <Button type="submit" variant="outline">{t("reviseBudget")}</Button>
          </form>

          <form action={transitionSamplingPlanAction} className="flex flex-wrap items-end gap-3">
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
            <input type="hidden" name="planId" value={plan.id} />
            <label className="min-w-64 flex-1 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("arrive")}</span>
              <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
            </label>
            <Button type="submit" variant="outline">{t("arrive")}</Button>
          </form>

          <form action={expireSamplingChannelAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="planId" value={plan.id} />
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("channelId")}</span>
              <input name="channelId" required maxLength={64} className={fieldClass} />
            </label>
            <label className="min-w-64 flex-1 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("nextAt")}</span>
              <input name="nextAt" required placeholder="2026-11-18T00:00:00.000Z" className={fieldClass} />
            </label>
            <Button type="submit" variant="outline">{t("expireChannel")}</Button>
          </form>
        </section>
      ))}
    </div>
  );
}
