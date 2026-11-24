import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { createInterventionBatchAction, registerInterventionPageAction } from "./intervention-actions";
import { listInterventionBatches, type InterventionBatchView } from "./intervention-commands";

const interventionsPath = "/dashboard/reports/interventions";
const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";
const focusClass = "focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

type Translate = Awaited<ReturnType<typeof getTranslator<"interventionBatches">>>;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const active = await new BrandDao(connection).active(ownerId);
    if (!active) return { kind: "noBrand" } as const;
    const listed = await listInterventionBatches(connection, ownerId, active.id);
    if ("error" in listed) return { kind: "error", code: listed.error } as const;
    return { kind: "ready", brand: active, batches: listed.batches } as const;
  } catch {
    console.error("intervention-batches-read-unavailable");
    return { kind: "error", code: "SERVICE_UNAVAILABLE" } as const;
  }
}

function BatchCard({ batch, t }: { batch: InterventionBatchView; t: Translate }) {
  const headingId = `intervention-batch-${batch.id}`;
  const pageFieldId = `intervention-page-${batch.id}`;
  const timeFieldId = `intervention-time-${batch.id}`;

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-5 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} tabIndex={-1} className={`scroll-mt-4 text-lg font-semibold ${focusClass}`}>
          {t(batch.status === "effective" ? "statusEffective" : "statusPending")}
        </h2>
        <p className="text-sm tabular-nums [overflow-wrap:anywhere]">
          {batch.effectiveAt ? t("effectiveLine", { time: batch.effectiveAt }) : t("pendingLine")}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{t("pagesHeading")}</h3>
        {batch.pages.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("noPages")}</p>
        ) : (
          <ul className="space-y-2">
            {batch.pages.map((page) => (
              <li key={page.id} className="rounded-xl border px-4 py-3 text-sm [overflow-wrap:anywhere]">
                <p>{page.pageKey}</p>
                <p className="mt-1 tabular-nums text-muted-foreground">
                  {page.verifiedAt ? t("verifiedLine", { time: page.verifiedAt }) : t("unverifiedLine")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={registerInterventionPageAction} className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <h3 className="text-base font-semibold sm:col-span-2">{t("pageTitle")}</h3>
        <input type="hidden" name="batchId" value={batch.id} />
        <div className="min-w-0 space-y-2 text-sm">
          <label htmlFor={pageFieldId} className="font-medium">{t("pageKey")}</label>
          <Input id={pageFieldId} name="pageKey" required maxLength={300} autoComplete="off" spellCheck={false}
            aria-describedby={`${pageFieldId}-hint`} className="h-10 scroll-mt-10 bg-background" />
          <p id={`${pageFieldId}-hint`} className="text-muted-foreground">{t("pageKeyHint")}</p>
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          <label htmlFor={timeFieldId} className="font-medium">{t("verifiedAt")}</label>
          <Input id={timeFieldId} name="verifiedAt" maxLength={40} autoComplete="off" spellCheck={false}
            aria-describedby={`${timeFieldId}-hint`} className="h-10 bg-background tabular-nums" />
          <p id={`${timeFieldId}-hint`} className="text-muted-foreground">{t("verifiedAtHint")}</p>
        </div>
        <div>
          <Button type="submit" variant="outline" className={actionClass}>{t("savePage")}</Button>
        </div>
      </form>
    </section>
  );
}

export async function generateMetadata() {
  const t = await getTranslator("interventionBatches");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function InterventionBatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("interventionBatches");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const workspace = await readWorkspace(session.user.id);
  const ready = workspace.kind === "ready" ? workspace : null;
  const pending = ready?.batches.find((batch) => batch.status === "pending");
  const latest = ready?.batches[0];
  const reportsHref = ready ? `/dashboard/reports?brandId=${encodeURIComponent(ready.brand.id)}` : "/dashboard/reports";

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {ready ? <p className={summaryClass}>{ready.brand.name}</p> : null}
        {workspace.kind === "error" ? (
          <p role="alert" className={summaryClass}>{t(workspace.code)}</p>
        ) : (
          <p className={summaryClass}>
            {t(workspace.kind === "noBrand" ? "noBrand" : pending ? "taskPending" : latest ? "taskEffective" : "empty")}
          </p>
        )}
        {ready && isKnownError(errorCode) ? (
          <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-sm">{t(errorCode)}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {workspace.kind === "error" && workspace.code === "SERVICE_UNAVAILABLE" ? (
            <Button asChild className={actionClass}><a href={interventionsPath}>{t("reload")}</a></Button>
          ) : null}
          {workspace.kind === "noBrand" || (workspace.kind === "error" && workspace.code === "NOT_FOUND") ? (
            <Button asChild className={actionClass}><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
          ) : null}
          {pending ? (
            <Button asChild className={actionClass}>
              <a href={`#intervention-page-${pending.id}`}>{t("openRegistration")}</a>
            </Button>
          ) : latest ? (
            <Button asChild className={actionClass}>
              <a href={`#intervention-batch-${latest.id}`}>{t("reviewPages")}</a>
            </Button>
          ) : null}
          {ready ? (
            <form action={createInterventionBatchAction}>
              <input type="hidden" name="brandId" value={ready.brand.id} />
              <Button type="submit" variant={latest ? "outline" : "default"} className={actionClass}>{t("create")}</Button>
            </form>
          ) : null}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={reportsHref} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </header>

      {ready ? (
        <>
          {ready.batches.map((batch) => <BatchCard key={batch.id} batch={batch} t={t} />)}
          <details className="rounded-2xl border bg-card px-4 py-3 text-sm">
            <summary className={`cursor-pointer font-medium ${focusClass}`}>{t("effectiveRule")}</summary>
            <p className={`mt-2 ${summaryClass}`}>{t("description")}</p>
          </details>
        </>
      ) : null}
    </div>
  );
}
