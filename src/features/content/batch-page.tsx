import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { batchControlAction } from "./actions";
import { readBatch } from "./commands";
import type { BatchStatus } from "./contracts";
import type { UnitRow } from "./dao";
import { canCancel, canPause, canResume, canRetryFailed } from "./rules";

const actionClass = "h-auto max-w-full whitespace-normal";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Translate = Awaited<ReturnType<typeof getTranslator<"content">>>;
type BatchControlName = "pause-batch" | "resume-batch" | "cancel-batch" | "retry-failed";

const controlOrder = ["pause-batch", "resume-batch", "retry-failed", "cancel-batch"] as const satisfies readonly BatchControlName[];

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("batchDetail"), robots: { index: false, follow: false } };
}

function BatchCanvas({
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
    <div className="min-w-0 space-y-8">
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

function BatchControl({
  action,
  brandId,
  batchId,
  label,
  variant = "default",
}: {
  action: BatchControlName;
  brandId: string;
  batchId: string;
  label: string;
  variant?: "default" | "outline";
}) {
  return (
    <form action={batchControlAction}>
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" variant={variant} className={actionClass}>{label}</Button>
    </form>
  );
}

function controlAllowed(action: BatchControlName, status: BatchStatus, hasFailed: boolean) {
  if (action === "pause-batch") return canPause(status);
  if (action === "resume-batch") return canResume(status);
  if (action === "cancel-batch") return canCancel(status);
  return hasFailed && canRetryFailed(status);
}

function taskCopy(t: Translate, status: BatchStatus, units: UnitRow[]) {
  if (canPause(status)) return t("batchTaskRunning");
  if (status === "paused") return t("batchTaskPaused");
  if (units.some((unit) => unit.status === "failed")) return t("batchTaskRetry");
  if (units.some((unit) => unit.status === "blocked")) return t("batchTaskBlocked");
  if (status === "cancelled") return t("batchTaskCancelled");
  return t("batchTaskCompleted");
}

function readLedger(json: string) {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object") return null;
    const mode = "mode" in value ? value.mode : null;
    const upperMinor = "upperMinor" in value ? value.upperMinor : null;
    const currency = "currency" in value ? value.currency : null;
    if (mode !== "quota" && mode !== "unknown_pending") return null;
    if (typeof upperMinor !== "number" || !Number.isInteger(upperMinor)) return null;
    if (typeof currency !== "string" || !currency.trim()) return null;
    return { mode, upperMinor, currency };
  } catch {
    return null;
  }
}

export default async function ContentBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await requireSession();
  const { batchId } = await params;
  const locale = await getLocale();
  const t = await getTranslator("content");
  const href = `/dashboard/content/batches/${batchId}`;
  const back = [{ href: "/dashboard/content", label: t("backToList") }];
  let detail: Awaited<ReturnType<typeof readBatch>>;
  try {
    detail = await readBatch(getConnection(), session.user.id, batchId);
  } catch {
    console.error("content-batch-read-failed", { batchId });
    detail = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in detail) {
    if (detail.error === "NOT_FOUND") notFound();
    return (
      <BatchCanvas
        title={t("batchDetail")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("batchUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={href}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={back}
      />
    );
  }

  const { batch, units } = detail;
  const hasFailed = units.some((unit) => unit.status === "failed");
  const allowed = controlOrder.filter((action) => controlAllowed(action, batch.status, hasFailed));
  const primaryControl = allowed.find((action) => action !== "cancel-batch");
  const succeeded = units.find((unit) => unit.status === "succeeded" && unit.contentVersionId);
  const links = [
    ...back,
    { href: `/dashboard/brands/${batch.brandId}/facts`, label: t("brandFactsLink") },
    { href: `/dashboard/content/sources?brandId=${encodeURIComponent(batch.brandId)}`, label: t("sourcesLink") },
  ];
  const ledger = readLedger(batch.costLedgerJson);

  return (
    <BatchCanvas
      title={t("batchDetail")}
      summary={(
        <div className="max-w-2xl space-y-3">
          <p className="break-words text-sm leading-7 text-muted-foreground">{taskCopy(t, batch.status, units)}</p>
          <Badge variant="secondary">{batch.status}</Badge>
          <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{batch.id}</p>
        </div>
      )}
      primary={primaryControl ? (
        <BatchControl
          action={primaryControl}
          brandId={batch.brandId}
          batchId={batch.id}
          label={t(primaryControl)}
        />
      ) : succeeded?.contentVersionId ? (
        <Button asChild className={actionClass}>
          <Link href={`/dashboard/content/versions/${succeeded.contentVersionId}`} prefetch={false}>
            {t("openVersion")}
          </Link>
        </Button>
      ) : (
        <Button asChild className={actionClass}>
          <Link href="/dashboard/content" prefetch={false}>{t("backToList")}</Link>
        </Button>
      )}
      relatedLabel={t("relatedEntries")}
      related={links}
    >
      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("units")}</h2>
        {units.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">{t("batchUnitsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {units.map((unit) => (
              <li key={unit.id} className="min-w-0 rounded-2xl border bg-card px-4 py-4 text-sm">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 [overflow-wrap:anywhere] font-medium">{unit.briefId}</p>
                  <Badge variant="outline">{unit.status}</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{t("batchAttempts", { count: formatNumber(locale, unit.attemptCount) })}</p>
                {unit.contentVersionId ? (
                  <Link href={`/dashboard/content/versions/${unit.contentVersionId}`} prefetch={false} className={`${relatedClass} mt-3`}>
                    {t("openVersion")}
                  </Link>
                ) : null}
                {unit.lastError ? (
                  <p className="mt-2 min-w-0 [overflow-wrap:anywhere] text-muted-foreground">
                    <span>{t("batchErrorLabel")}</span>{" "}
                    <span>{unit.lastError}</span>
                  </p>
                ) : null}
                {unit.blockedReason ? (
                  <p className="mt-2 min-w-0 [overflow-wrap:anywhere] text-muted-foreground">
                    <span>{t("batchBlockedLabel")}</span>{" "}
                    <span>{unit.blockedReason}</span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {allowed.some((action) => action !== primaryControl) ? (
        <section className="flex min-w-0 flex-wrap gap-2">
          {allowed.filter((action) => action !== primaryControl).map((action) => (
            <BatchControl
              key={action}
              action={action}
              brandId={batch.brandId}
              batchId={batch.id}
              label={t(action)}
              variant="outline"
            />
          ))}
        </section>
      ) : null}

      <section className="min-w-0 space-y-2">
        <h2 className="text-lg font-semibold">{t("ledgerHint")}</h2>
        {ledger ? (
          <>
            <p className="text-sm text-muted-foreground">
              {ledger.mode === "quota" ? t("batchLedgerQuota") : t("batchLedgerPending")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("batchLedgerUpper", { amount: formatNumber(locale, ledger.upperMinor), currency: ledger.currency })}
            </p>
          </>
        ) : null}
        <p className="min-w-0 max-w-full [overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{batch.costLedgerJson}</p>
      </section>
    </BatchCanvas>
  );
}
