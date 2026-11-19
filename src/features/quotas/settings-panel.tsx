import "server-only";

import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getTranslator } from "@/lib/i18n/server";
import { quotaKinds } from "./contracts";
import { emptyLedger, QuotaDao } from "./dao";
import { grantState } from "./ledger";
import { QuotaRetryButton } from "./retry-button";

function formatMinorUnits(locale: Locale, amount: number, currency: string) {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(amount / 10 ** digits);
}

async function readQuotas(ownerId: string) {
  try {
    return { items: await new QuotaDao(getConnection()).ownerSummary(ownerId) };
  } catch {
    const traceId = randomUUID();
    console.error("pilot-quota-read-unavailable", { traceId });
    return { traceId };
  }
}

export async function PilotQuotaPanel({ ownerId, locale }: { ownerId: string; locale: Locale }) {
  const [t, result] = await Promise.all([getTranslator("quotas"), readQuotas(ownerId)]);
  if (!result.items) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("SERVICE_UNAVAILABLE")}</p>
        <QuotaRetryButton label={t("retry")} />
        <p className="break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </div>
    );
  }

  const now = new Date().toISOString();
  return (
    <>
      {result.items.length === 0 && <p className="text-sm text-muted-foreground">{t("noBrand")}</p>}
      <div className="grid min-w-0 gap-3 text-sm">
        {quotaKinds.map((kind) => {
          const { grant, ledger } = result.items.find((item) => item.kind === kind) ?? { grant: null, ledger: emptyLedger };
          const state = grantState(grant, now);
          const remaining = grant && state === "active" ? Math.max(0, grant.countLimit - ledger.reserved - ledger.settled) : 0;
          const status = state === "active" && remaining === 0 ? "limitReached" : state;
          return (
            <div key={kind} className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">{t(kind)}</h3>
              <p className="text-muted-foreground">{t(status)}</p>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-2 gap-y-1 wrap-anywhere">
                <dt>{t("remaining")}</dt><dd>{formatNumber(locale, remaining)}</dd>
                {grant && <>
                  <dt>{t("reserved")}</dt><dd>{formatNumber(locale, ledger.reserved)}</dd>
                  <dt>{t("settled")}</dt><dd>{formatNumber(locale, ledger.settled)}</dd>
                  <dt>{t("expiry")}</dt><dd><time dateTime={grant.expiresAt}>{formatDateTime(locale, new Date(grant.expiresAt))}</time></dd>
                  <dt>{t("budget")}</dt><dd>{formatMinorUnits(locale, grant.budgetMinor, grant.currency)}</dd>
                  <dt>{t("costCeiling")}</dt><dd>{formatMinorUnits(locale, ledger.committedMinor, grant.currency)}</dd>
                  <dt>{t("costConfirmed")}</dt>
                  <dd>{ledger.unresolved > 0 && ledger.actualMinor === 0 ? t("pending") : formatMinorUnits(locale, ledger.actualMinor, grant.currency)}</dd>
                </>}
              </dl>
              {grant && state === "active" && ledger.committedMinor >= grant.budgetMinor && (
                <p className="text-muted-foreground">{t("budgetCommitted")}</p>
              )}
              {ledger.unresolved > 0 && <p className="text-muted-foreground">{t("pendingDetail")}</p>}
            </div>
          );
        })}
      </div>
      {result.items.some(({ grant }) => grant) && <p className="text-sm text-muted-foreground">{t("pilotCharge")}</p>}
      <Link href="/dashboard/settings/usage" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("openUsage")}</Link>
    </>
  );
}
