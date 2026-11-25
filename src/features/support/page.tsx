import Link from "next/link";
import { ArrowLeft, LifeBuoy, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import { opaqueIdSchema } from "../maintenance/contracts";
import { currentMaintenanceAccess } from "../maintenance/service";
import type { SupportMatch } from "./contracts";
import { lookupSupport } from "./service";

export async function generateMetadata() {
  const t = await getTranslator("support");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const supportPath = "/dashboard/maintenance/support";
const actionClass = "h-auto min-h-10 whitespace-normal py-2";

export default async function SupportLookupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const raw = await searchParams;
  const keys = Object.keys(raw);
  const parsed = opaqueIdSchema.safeParse(raw.operationId);
  const operationId = parsed.success ? parsed.data : null;
  const invalid = !parsed.success || keys.some((key) => key !== "operationId");
  const access = await currentMaintenanceAccess("support.read");
  const result = access.status === "allowed" && keys.length > 0
    ? await lookupSupport(operationId, invalid)
    : null;
  const unavailable = access.status === "unavailable" ? access : result?.status === "unavailable" ? result : null;
  const invalidInput = result?.status === "denied" && result.reason === "invalid-input" ? result : null;
  const denied = access.status === "denied" ? access : result?.status === "denied" && !invalidInput ? result : null;
  const blocked = unavailable ?? denied;
  const retryHref = operationId ? `${supportPath}?${new URLSearchParams({ operationId })}` : supportPath;
  const t = await getTranslator("support");
  const failureLabel = (failure: SupportMatch["failure"]) => {
    switch (failure) {
      case "cost-unknown": return t("failure.cost-unknown");
      case "partial-failure": return t("failure.partial-failure");
      case "deletion-incomplete": return t("failure.deletion-incomplete");
      case "deletion-frozen": return t("failure.deletion-frozen");
      case "channel-degraded": return t("failure.channel-degraded");
      case "channel-disabled": return t("failure.channel-disabled");
      default: return t("failure.none");
    }
  };
  const recoveryLabel = (recovery: SupportMatch["recovery"]) => {
    switch (recovery) {
      case "monitoring.reconcile": return t("recovery.monitoring.reconcile");
      case "brands.purge.retry": return t("recovery.brands.purge.retry");
      case "owner.recover": return t("recovery.owner.recover");
      case "capabilities.review": return t("recovery.capabilities.review");
      default: return t("recovery.none");
    }
  };
  const statusLabel = (status: SupportMatch["status"]) => {
    switch (status) {
      case "queued": return t("status.queued");
      case "running": return t("status.running");
      case "paused": return t("status.paused");
      case "succeeded": return t("status.succeeded");
      case "partial": return t("status.partial");
      case "failed": return t("status.failed");
      case "cancelled": return t("status.cancelled");
      case "cleared": return t("status.cleared");
      case "incomplete": return t("status.incomplete");
      case "frozen": return t("status.frozen");
      case "candidate": return t("status.candidate");
      case "verified": return t("status.verified");
      case "degraded": return t("status.degraded");
      default: return t("status.disabled");
    }
  };
  const kindLabel = (kind: SupportMatch["kind"]) => kind === "monitoring-run"
    ? t("kind.monitoring-run")
    : kind === "brand-deletion" ? t("kind.brand-deletion") : t("kind.capability");

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <LifeBuoy className="size-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <Button asChild variant="outline" className={actionClass}>
          <Link href="/dashboard/maintenance"><ArrowLeft aria-hidden="true" />{t("back")}</Link>
        </Button>
      </header>
      {blocked && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div role={unavailable ? "alert" : "status"}>
            <p className="font-medium">{t(unavailable ? "unavailable" : "denied")}</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{t(unavailable ? "retryDescription" : "contactDescription")}</p>
          </div>
          {unavailable && (
            <Button asChild className={actionClass}>
              <a href={retryHref}><RefreshCw aria-hidden="true" />{t("retry")}</a>
            </Button>
          )}
          <p className="break-all text-xs leading-6 text-muted-foreground">{t("trace", { id: blocked.traceId })}</p>
        </section>
      )}
      {access.status === "allowed" && !denied && (
        <form method="get" action={supportPath} className="max-w-xl space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-2">
            <label htmlFor="operationId" className="text-sm font-medium">{t("operationLabel")}</label>
            <Input
              id="operationId" name="operationId" required maxLength={128} autoComplete="off" spellCheck={false}
              defaultValue={operationId ?? ""} pattern={String.raw`[A-Za-z0-9_\-]{1,128}`}
              aria-invalid={Boolean(invalidInput) || undefined} aria-describedby="support-operation-format" className="h-10"
            />
            <p id="support-operation-format" className="text-sm text-muted-foreground">{t("operationFormat")}</p>
          </div>
          {invalidInput && (
            <div role="alert">
              <p className="text-sm font-medium text-destructive">{t("invalidInput")}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{t("trace", { id: invalidInput.traceId })}</p>
            </div>
          )}
          <Button type="submit" variant={unavailable ? "outline" : "default"} className={actionClass}>{t("lookup")}</Button>
        </form>
      )}
      {result?.status === "allowed" && (
        <section aria-labelledby="support-results" className="space-y-4">
          <h2 id="support-results" className="text-lg font-semibold">{t("resultsTitle")}</h2>
          {result.data.matches.length ? (
            <p className="text-sm text-muted-foreground">{t("resultsDescription")}</p>
          ) : (
            <p className="rounded-xl border border-dashed bg-card p-5 text-sm text-muted-foreground">{t("notFound")}</p>
          )}
          <p className="text-sm text-muted-foreground">{result.cache === "hit" ? t("cache.hit") : result.cache === "origin" ? t("cache.origin") : t("cache.blocked")}</p>
          {result.data.matches.map((match) => (
            <article key={`${match.kind}:${match.subjectId}:${match.status}`} className="space-y-3 rounded-xl border bg-card p-5">
              <h3 className="font-medium">{kindLabel(match.kind)}</h3>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-muted-foreground">{t("subject")}</dt><dd className="break-all">{match.subjectId}</dd></div>
                <div><dt className="text-muted-foreground">{t("status")}</dt><dd>{statusLabel(match.status)}</dd></div>
                <div><dt className="text-muted-foreground">{t("failure")}</dt><dd>{failureLabel(match.failure)}</dd></div>
                <div><dt className="text-muted-foreground">{t("reconciliation")}</dt><dd>{match.reconciliation === "required" ? t("reconciliation.required") : t("reconciliation.clear")}</dd></div>
                <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">{t("remaining")}</dt><dd className="break-all">{match.remaining.length ? match.remaining.join(", ") : t("noneRemaining")}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("recovery")}</dt><dd>{recoveryLabel(match.recovery)}</dd></div>
              </dl>
            </article>
          ))}
          <p className="break-all text-xs leading-6 text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </section>
      )}
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("healthBoundary")}</p>
    </div>
  );
}
