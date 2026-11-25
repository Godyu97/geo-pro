import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const filterActionClass = "h-auto min-h-9 max-w-full whitespace-normal";
const emptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-6 text-sm leading-7 text-muted-foreground";
const usagePath = "/dashboard/settings/usage";
const settingsQuotaPath = "/dashboard/settings#pilot-quotas";

function query(filter: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${usagePath}?${text}` : usagePath;
}

function stateKey(state: (typeof states)[number]) {
  return state === "reserved" ? "reserved" : state === "settled" ? "settled" : "released";
}

function stateBadgeVariant(state: (typeof states)[number]): "default" | "secondary" | "outline" {
  if (state === "reserved") return "default";
  if (state === "settled") return "secondary";
  return "outline";
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
    const retryHref = parsed.success
      ? query({
        kind: parsed.data.kind,
        state: parsed.data.state,
        currency: parsed.data.currency,
        beforeCreatedAt: parsed.data.beforeCreatedAt,
        beforeId: parsed.data.beforeId,
      })
      : usagePath;
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("usageTitle")}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("SERVICE_UNAVAILABLE")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={retryHref}>{t("retry")}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href={settingsQuotaPath} prefetch={false}>{t("backSettings")}</Link>
            </Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </header>
      </div>
    );
  }

  const filter = parsed.success ? parsed.data : {};
  const current = { kind: filter.kind, state: filter.state, currency: filter.currency };
  const hasFilters = Boolean(filter.kind || filter.state || filter.currency);
  const sampling = result.grants.find((item) => item.kind === "sampling") ?? { grant: null, ledger: emptyLedger };
  const grantStatus = grantState(sampling.grant, new Date().toISOString());
  const remaining = sampling.grant && grantStatus === "active"
    ? Math.max(0, sampling.grant.countLimit - sampling.ledger.reserved - sampling.ledger.settled) : 0;
  const samplingBadgeKey = !sampling.grant
    ? "ungranted"
    : grantStatus === "active" && remaining === 0
      ? "limitReached"
      : grantStatus;
  const samplingBadgeVariant: "default" | "secondary" | "outline" =
    samplingBadgeKey === "active" ? "default" : samplingBadgeKey === "limitReached" || samplingBadgeKey === "expired" ? "secondary" : "outline";

  const currencies = Array.from(new Set([
    ...result.summaries.map((summary) => summary.currency),
    ...(filter.currency ? [filter.currency] : []),
  ]));

  const attempts = new Map<string, typeof result.attempts>();
  for (const attempt of result.attempts) {
    const list = attempts.get(attempt.reservationId) ?? [];
    list.push(attempt);
    attempts.set(attempt.reservationId, list);
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("usageTitle")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("usageDescription")}</p>
        <div className="flex flex-wrap gap-2">
          {!sampling.grant ? (
            <Button asChild className={actionClass}>
              <Link href={settingsQuotaPath} prefetch={false}>{t("backSettings")}</Link>
            </Button>
          ) : grantStatus === "active" && remaining === 0 ? (
            <>
              <Button asChild className={actionClass}>
                <Link href="/dashboard/monitoring/new" prefetch={false}>{t("adjustScope")}</Link>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href={settingsQuotaPath} prefetch={false}>{t("backSettings")}</Link>
              </Button>
            </>
          ) : result.items.length > 0 ? (
            <>
              <Button asChild className={actionClass}>
                <a href="#usage-ledger">{t("viewLedger")}</a>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href={settingsQuotaPath} prefetch={false}>{t("backSettings")}</Link>
              </Button>
            </>
          ) : (
            <Button asChild className={actionClass}>
              <Link href={settingsQuotaPath} prefetch={false}>{t("backSettings")}</Link>
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="py-0 shadow-none">
          <CardContent className="space-y-2 p-5">
            <h2 className="text-sm font-medium text-muted-foreground">{t("customerPayable")}</h2>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatNumber(locale, result.customerPayableMinor)}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">{t("pilotCharge")}</p>
          </CardContent>
        </Card>

        <Card className="py-0 shadow-none">
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("sampling")}</h2>
              <Badge variant={samplingBadgeVariant}>{t(samplingBadgeKey)}</Badge>
            </div>
            {!sampling.grant ? (
              <p className="text-sm leading-6 text-muted-foreground">{t("zeroQuota")}</p>
            ) : (
              <>
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-3 gap-y-1 text-sm tabular-nums">
                  <dt className="text-muted-foreground">{t("remaining")}</dt>
                  <dd className="font-medium">{formatNumber(locale, remaining)}</dd>
                  <dt className="text-muted-foreground">{t("reserved")}</dt>
                  <dd>{formatNumber(locale, sampling.ledger.reserved)}</dd>
                  <dt className="text-muted-foreground">{t("settled")}</dt>
                  <dd>{formatNumber(locale, sampling.ledger.settled)}</dd>
                </dl>
                {grantStatus === "active" && remaining === 0 && (
                  <p className="text-sm leading-6 text-muted-foreground">{t("overLimit")}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="currency-summary">
        <h2 id="currency-summary" className="text-base font-semibold">{t("currencySummary")}</h2>
        {result.summaries.length === 0 ? (
          <p className={emptyClass}>{t("noUsage")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.summaries.map((summary) => (
              <li key={summary.currency} className="min-w-0">
                <Card className="h-full py-0 shadow-none">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold tracking-tight">{summary.currency}</h3>
                      {summary.unresolved > 0 && <Badge variant="outline">{t("pending")}</Badge>}
                    </div>
                    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-3 gap-y-1.5 text-sm tabular-nums">
                      <dt className="text-muted-foreground">{t("supplierReserved")}</dt>
                      <dd className="wrap-anywhere text-right">{formatMinorUnits(locale, summary.reservedMinor, summary.currency)}</dd>
                      <dt className="text-muted-foreground">{t("supplierActual")}</dt>
                      <dd className="wrap-anywhere text-right">{formatMinorUnits(locale, summary.actualMinor, summary.currency)}</dd>
                      <dt className="text-muted-foreground">{t("supplierPending")}</dt>
                      <dd className="wrap-anywhere text-right">
                        {summary.unresolved > 0 ? t("unknownAmount") : formatMinorUnits(locale, summary.pendingMinor, summary.currency)}
                      </dd>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="usage-ledger" className="space-y-4" aria-labelledby="usage-ledger-heading">
        <h2 id="usage-ledger-heading" className="text-base font-semibold">{t("ledgerHeading")}</h2>

        <Card className="py-0 shadow-none">
          <CardContent className="space-y-3 p-4">
            <div role="group" aria-labelledby="usage-filter-kind" className="flex flex-wrap items-center gap-2">
              <span id="usage-filter-kind" className="text-sm font-medium text-muted-foreground">{t("filterKind")}</span>
              <Button asChild size="sm" variant={!filter.kind ? "default" : "outline"} className={filterActionClass}>
                <Link href={query({ ...current, kind: undefined })} prefetch={false} aria-current={!filter.kind ? "page" : undefined}>
                  {t("all")}
                </Link>
              </Button>
              {quotaKinds.map((entryKind) => {
                const active = filter.kind === entryKind;
                return (
                  <Button key={entryKind} asChild size="sm" variant={active ? "default" : "outline"} className={filterActionClass}>
                    <Link href={query({ ...current, kind: entryKind })} prefetch={false} aria-current={active ? "page" : undefined}>
                      {t(entryKind)}
                    </Link>
                  </Button>
                );
              })}
            </div>

            <div role="group" aria-labelledby="usage-filter-state" className="flex flex-wrap items-center gap-2">
              <span id="usage-filter-state" className="text-sm font-medium text-muted-foreground">{t("filterState")}</span>
              <Button asChild size="sm" variant={!filter.state ? "default" : "outline"} className={filterActionClass}>
                <Link href={query({ ...current, state: undefined })} prefetch={false} aria-current={!filter.state ? "page" : undefined}>
                  {t("all")}
                </Link>
              </Button>
              {states.map((entryState) => {
                const active = filter.state === entryState;
                return (
                  <Button key={entryState} asChild size="sm" variant={active ? "default" : "outline"} className={filterActionClass}>
                    <Link href={query({ ...current, state: entryState })} prefetch={false} aria-current={active ? "page" : undefined}>
                      {t(stateKey(entryState))}
                    </Link>
                  </Button>
                );
              })}
            </div>

            {currencies.length > 0 && (
              <div role="group" aria-labelledby="usage-filter-currency" className="flex flex-wrap items-center gap-2">
                <span id="usage-filter-currency" className="text-sm font-medium text-muted-foreground">{t("filterCurrency")}</span>
                <Button asChild size="sm" variant={!filter.currency ? "default" : "outline"} className={filterActionClass}>
                  <Link href={query({ ...current, currency: undefined })} prefetch={false} aria-current={!filter.currency ? "page" : undefined}>
                    {t("all")}
                  </Link>
                </Button>
                {currencies.map((entryCurrency) => {
                  const active = filter.currency === entryCurrency;
                  return (
                    <Button key={entryCurrency} asChild size="sm" variant={active ? "default" : "outline"} className={filterActionClass}>
                      <Link href={query({ ...current, currency: entryCurrency })} prefetch={false} aria-current={active ? "page" : undefined}>
                        {entryCurrency}
                      </Link>
                    </Button>
                  );
                })}
              </div>
            )}

            {hasFilters && (
              <div>
                <Button asChild size="sm" variant="outline" className={filterActionClass}>
                  <Link href={usagePath} prefetch={false}>{t("clearFilters")}</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {result.items.length === 0 ? (
          <div className={emptyClass}>
            <p>{hasFilters ? t("emptyFilter") : t("noUsage")}</p>
            {hasFilters && (
              <Button asChild size="sm" variant="outline" className={`mt-3 ${filterActionClass}`}>
                <Link href={usagePath} prefetch={false}>{t("clearFilters")}</Link>
              </Button>
            )}
          </div>
        ) : (
          <Card className="py-0 shadow-none">
            <CardContent className="p-0">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 py-3">{t("filterKind")}</TableHead>
                    <TableHead className="px-4 py-3">{t("filterState")}</TableHead>
                    <TableHead className="px-4 py-3">{t("supplierEstimate")}</TableHead>
                    <TableHead className="px-4 py-3">{t("supplierActual")}</TableHead>
                    <TableHead className="px-4 py-3">{t("slotLabel")}</TableHead>
                    <TableHead className="px-4 py-3">{t("runLink")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => {
                    const related = attempts.get(item.id) ?? [];
                    const known = related.filter((attempt) => attempt.state === "known" && attempt.actualMinor !== null);
                    const unknown = related.some((attempt) => attempt.state !== "known");
                    return (
                      <TableRow key={`${item.kind}-${item.id}`}>
                        <TableCell className="px-4 py-3 align-top">{t(item.kind)}</TableCell>
                        <TableCell className="px-4 py-3 align-top">
                          <Badge variant={stateBadgeVariant(item.state)}>{t(stateKey(item.state))}</Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top tabular-nums">
                          {formatMinorUnits(locale, item.upperMinor, item.currency)}
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top tabular-nums">
                          {unknown || known.length === 0
                            ? t("unknownAmount")
                            : formatMinorUnits(locale, known.reduce((sum, attempt) => sum + (attempt.actualMinor ?? 0), 0), item.currency)}
                        </TableCell>
                        <TableCell className="min-w-44 max-w-xs px-4 py-3 align-top font-mono text-xs whitespace-normal [overflow-wrap:anywhere]">
                          {item.slotId ?? t("unknownAmount")}
                        </TableCell>
                        <TableCell className="px-4 py-3 align-top">
                          {item.runId ? (
                            <Button asChild size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal">
                              <Link href={`/dashboard/monitoring/runs/${item.runId}`} prefetch={false}>{t("runLink")}</Link>
                            </Button>
                          ) : t("unknownAmount")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {result.next && (
          <div>
            <Button asChild variant="outline" className={actionClass}>
              <Link
                href={query({
                  ...current,
                  beforeCreatedAt: result.next.beforeCreatedAt,
                  beforeId: result.next.beforeId,
                })}
                prefetch={false}
              >
                {t("nextPage")}
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
