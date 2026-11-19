import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { quotaKinds } from "../quotas/contracts";
import { emptyLedger } from "../quotas/dao";
import { grantState } from "../quotas/ledger";
import { readOwnerUsage, usageFilterSchema } from "./activity";
import { formatMinorUnits } from "./format";

const states = ["reserved", "settled", "released"] as const;

function query(filter: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `/dashboard/settings/usage?${text}` : "/dashboard/settings/usage";
}

export async function generateMetadata() {
  const t = await getTranslator("quotas");
  return { title: t("usageTitle"), robots: { index: false, follow: false } };
}

export default async function MonitoringUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("quotas");
  const raw = await searchParams;
  const one = (key: string) => {
    const value = raw[key];
    return typeof value === "string" ? value : undefined;
  };
  const kind = one("kind");
  const state = one("state");
  const currency = one("currency");
  const beforeCreatedAt = one("beforeCreatedAt");
  const beforeId = one("beforeId");
  const parsed = usageFilterSchema.safeParse({
    ...(kind ? { kind } : {}), ...(state ? { state } : {}), ...(currency ? { currency } : {}),
    ...(beforeCreatedAt ? { beforeCreatedAt } : {}), ...(beforeId ? { beforeId } : {}),
  });
  const result = parsed.success ? await readOwnerUsage(getConnection(), session.user.id, parsed.data) : { traceId: "invalid-filter" };
  if (!("items" in result)) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t("usageTitle")}</h1>
        <p>{t("SERVICE_UNAVAILABLE")}</p>
        <Link className="underline underline-offset-4" href="/dashboard/settings/usage">{t("retry")}</Link>
        <p className="break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </div>
    );
  }

  const filter = parsed.success ? parsed.data : {};
  const current = { kind: filter.kind, state: filter.state, currency: filter.currency };
  const sampling = result.grants.find((item) => item.kind === "sampling") ?? { grant: null, ledger: emptyLedger };
  const grantStatus = grantState(sampling.grant, new Date().toISOString());
  const remaining = sampling.grant && grantStatus === "active"
    ? Math.max(0, sampling.grant.countLimit - sampling.ledger.reserved - sampling.ledger.settled) : 0;
  const attempts = new Map<string, typeof result.attempts>();
  for (const attempt of result.attempts) {
    const list = attempts.get(attempt.reservationId) ?? [];
    list.push(attempt);
    attempts.set(attempt.reservationId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("usageTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("usageDescription")}</p>
      </div>
      <p className="text-sm">{t("customerPayable")}: {formatNumber(locale, result.customerPayableMinor)}</p>
      {!sampling.grant && <p className="text-sm">{t("zeroQuota")} <Link className="underline underline-offset-4" href="/dashboard/settings#pilot-quotas">{t("backSettings")}</Link></p>}
      {sampling.grant && grantStatus === "active" && remaining === 0 && (
        <p className="text-sm">{t("overLimit")} <Link className="underline underline-offset-4" href="/dashboard/monitoring/new">{t("adjustScope")}</Link></p>
      )}
      <section className="space-y-2" aria-labelledby="currency-summary">
        <h2 id="currency-summary" className="font-medium">{t("currencySummary")}</h2>
        {result.summaries.length === 0 && <p className="text-sm text-muted-foreground">{t("noUsage")}</p>}
        <ul className="space-y-2 text-sm">
          {result.summaries.map((summary) => (
            <li key={summary.currency} className="rounded-lg border p-3">
              <p>{summary.currency}</p>
              <p>{t("supplierReserved")}: {formatMinorUnits(locale, summary.reservedMinor, summary.currency)}</p>
              <p>{t("supplierActual")}: {formatMinorUnits(locale, summary.actualMinor, summary.currency)}</p>
              <p>{t("supplierPending")}: {summary.unresolved > 0 ? t("unknownAmount") : formatMinorUnits(locale, summary.pendingMinor, summary.currency)}</p>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2 text-sm">
        <span>{t("filterKind")}</span>
        <Link className="underline underline-offset-4" href={query({ ...current, kind: undefined })}>{t("all")}</Link>
        {quotaKinds.map((kind) => <Link key={kind} className="underline underline-offset-4" href={query({ ...current, kind })}>{t(kind)}</Link>)}
        <span>{t("filterState")}</span>
        {states.map((state) => <Link key={state} className="underline underline-offset-4" href={query({ ...current, state })}>{t(state === "reserved" ? "reserved" : state === "settled" ? "settled" : "released")}</Link>)}
        {(filter.kind || filter.state || filter.currency) && <Link className="underline underline-offset-4" href="/dashboard/settings/usage">{t("clearFilters")}</Link>}
      </div>
      {result.items.length === 0 && <p className="text-sm">{filter.kind || filter.state || filter.currency ? t("emptyFilter") : t("noUsage")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">{t("filterKind")}</th>
              <th className="py-2 pr-3 font-medium">{t("filterState")}</th>
              <th className="py-2 pr-3 font-medium">{t("supplierEstimate")}</th>
              <th className="py-2 pr-3 font-medium">{t("supplierActual")}</th>
              <th className="py-2 pr-3 font-medium">{t("slotLabel")}</th>
              <th className="py-2 font-medium">{t("runLink")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => {
              const related = attempts.get(item.id) ?? [];
              const known = related.filter((attempt) => attempt.state === "known" && attempt.actualMinor !== null);
              const unknown = related.some((attempt) => attempt.state !== "known");
              return (
                <tr key={`${item.kind}-${item.id}`} className="border-b align-top">
                  <td className="py-2 pr-3">{t(item.kind)}</td>
                  <td className="py-2 pr-3">{t(item.state === "reserved" ? "reserved" : item.state === "settled" ? "settled" : "released")}</td>
                  <td className="py-2 pr-3">{formatMinorUnits(locale, item.upperMinor, item.currency)}</td>
                  <td className="py-2 pr-3">{unknown || known.length === 0 ? t("unknownAmount") : formatMinorUnits(locale, known.reduce((sum, attempt) => sum + (attempt.actualMinor ?? 0), 0), item.currency)}</td>
                  <td className="py-2 pr-3 wrap-anywhere">{item.slotId ?? t("unknownAmount")}</td>
                  <td className="py-2">{item.runId ? <Link className="underline underline-offset-4" href={`/dashboard/monitoring/runs/${item.runId}`}>{t("runLink")}</Link> : t("unknownAmount")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.next && (
        <Link className="inline-block text-sm underline underline-offset-4" href={query({
          ...current, beforeCreatedAt: result.next.beforeCreatedAt, beforeId: result.next.beforeId,
        })}>{t("nextPage")}</Link>
      )}
      <Link className="inline-block text-sm underline underline-offset-4" href="/dashboard/settings">{t("backSettings")}</Link>
    </div>
  );
}
