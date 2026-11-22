import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { confirmAssistantPlanAction, createAssistantPlanAction, executeAssistantPlanAction } from "./actions";
import { listAssistantPlans, type AssistantPlanView } from "./commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "AI_FAILED", "INVALID_MODEL_OUTPUT"] as const;
const inputClass = "h-10 w-full rounded-md border bg-background px-3";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("assistant");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AssistantPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("assistant");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const statusLabel = {
    draft: t("statusDraft"),
    confirmed: t("statusConfirmed"),
    executed: t("statusExecuted"),
    blocked: t("statusBlocked"),
  } as const;

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listAssistantPlans(connection, session.user.id, active.id);
  const plans: AssistantPlanView[] = "error" in listed ? [] : listed.plans;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard" prefetch={false}>{t("backOverview")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>

      <form action={createAssistantPlanAction} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">{t("createTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("material")}</span>
          <textarea name="material" required maxLength={4000} className="min-h-28 w-full rounded-md border bg-background px-3 py-2" />
          <span className="block text-muted-foreground">{t("materialHint")}</span>
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("budget")}</span>
          <input name="budgetMinor" type="number" required min={0} max={1000000000} inputMode="numeric" className={`${inputClass} tabular-nums`} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("successes")}</span>
          <input name="successes" type="number" required min={0} max={1000000} inputMode="numeric" className={`${inputClass} tabular-nums`} />
        </label>
        {Array.from({ length: 5 }, (_, index) => {
          const slot = index + 1;
          return (
            <div key={slot} className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>{t("action", { index: slot })}</span>
                <input name={`action${slot}`} maxLength={200} className={inputClass} />
              </label>
              <label className="space-y-2 text-sm">
                <span>{t("factVersion", { index: slot })}</span>
                <input name={`fact${slot}`} maxLength={36} className={inputClass} />
              </label>
            </div>
          );
        })}
        <div className="sm:col-span-2">
          <Button type="submit">{t("create")}</Button>
        </div>
      </form>

      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : plans.map((plan) => (
        <section key={plan.id} className="space-y-5 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("planHeading", { count: plan.items.length })}</h2>
            <p className="text-sm">{plan.status === "settled" ? t("planSettled") : t("planDraft")}</p>
          </div>
          <p className="text-sm tabular-nums">{t("budgetLine", { amount: formatNumber(locale, plan.budgetMinor) })}</p>
          <p className="text-sm tabular-nums">{t("successLine", { count: formatNumber(locale, plan.strategy.successes) })}</p>
          <p className="text-sm">{t("strategyObservation")}</p>
          <p className="text-sm">{t("strategyNotGuaranteed")}</p>
          {plan.ignored ? <p className="text-sm leading-7">{t("ignored")}</p> : null}

          <form action={confirmAssistantPlanAction} className="space-y-3">
            <input type="hidden" name="planId" value={plan.id} />
            <ul className="space-y-3">
              {plan.items.map((item) => (
                <li key={item.id} className="rounded-xl border border-dashed p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-medium">{item.action}</p>
                    <p className="text-sm">{statusLabel[item.status]}</p>
                  </div>
                  {item.status === "blocked" && item.blockReason === "fact_stale" ? (
                    <p className="mt-2 text-sm leading-7">{t("blockFactStale")}</p>
                  ) : null}
                  {item.status === "draft" ? (
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" name="itemId" value={item.id} />
                      <span>{t("selectItem")}</span>
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button type="submit">{t("confirm")}</Button>
          </form>

          <form action={executeAssistantPlanAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <Button type="submit" variant="outline">{t("execute")}</Button>
          </form>
        </section>
      ))}
    </div>
  );
}
