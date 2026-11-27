import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { createInterventionBatchAction, registerInterventionPageAction } from "./intervention-actions";
import { listInterventionBatches, type InterventionBatchView } from "./intervention-commands";

import { interventionsPath, readRetestWorkspace, reportsPath, retestHref } from "./workspace";
const knownErrors = ["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"] as const;
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";
const focusClass = "focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

type Translate = Awaited<ReturnType<typeof getTranslator<"interventionBatches">>>;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

async function readWorkspace(actorId: string, brandParam: string | string[] | undefined) {
  try {
    const connection = getConnection();
    const workspace = await readRetestWorkspace(actorId, brandParam);
    if (workspace.kind !== "ready") return workspace;
    const listed = await listInterventionBatches(connection, actorId, workspace.brand.id);
    if ("error" in listed) return { kind: "notFound" } as const;
    return { ...workspace, batches: listed.batches };
  } catch {
    console.error("intervention-batches-read-unavailable");
    return { kind: "error" } as const;
  }
}

function BatchCard({ batch, canWrite, t }: {
  batch: InterventionBatchView;
  canWrite: boolean;
  t: Translate;
}) {
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

      {canWrite && <form action={registerInterventionPageAction} className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <h3 className="text-base font-semibold sm:col-span-2">{t("pageTitle")}</h3>
        <input type="hidden" name="brandId" value={batch.brandId} />
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
      </form>}
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
  const workspace = await readWorkspace(session.user.id, params.brandId);
  if (workspace.kind === "notFound") notFound();
  const ready = workspace.kind === "ready" ? workspace : null;
  const pending = ready?.batches.find((batch) => batch.status === "pending");
  const latest = ready?.batches[0];
  const reportsHref = retestHref(reportsPath, ready?.brand.id);
  const retryHref = retestHref(interventionsPath, typeof params.brandId === "string" ? params.brandId : undefined);
  const summaryKey = workspace.kind === "noBrand" ? "noBrand"
    : ready?.canWrite ? pending ? "taskPending" : latest ? "taskEffective" : "empty"
      : latest ? "readOnly" : "emptyReadOnly";

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {ready ? <p className={summaryClass}>{ready.brand.name}</p> : null}
        {workspace.kind === "error" ? (
          <p role="alert" className={summaryClass}>{t("SERVICE_UNAVAILABLE")}</p>
        ) : (
          <p className={summaryClass}>
            {t(summaryKey)}
          </p>
        )}
        {ready && isKnownError(errorCode) ? (
          <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-sm">{t(errorCode)}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {workspace.kind === "error" ? (
            <Button asChild className={actionClass}><a href={retryHref}>{t("reload")}</a></Button>
          ) : null}
          {workspace.kind === "noBrand" ? (
            <Button asChild className={actionClass}><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
          ) : null}
          {pending && ready?.canWrite ? (
            <Button asChild className={actionClass}>
              <a href={`#intervention-page-${pending.id}`}>{t("openRegistration")}</a>
            </Button>
          ) : latest ? (
            <Button asChild className={actionClass}>
              <a href={`#intervention-batch-${latest.id}`}>{t("reviewPages")}</a>
            </Button>
          ) : null}
          {ready?.canWrite ? (
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
          {ready.batches.map((batch) => <BatchCard key={batch.id} batch={batch} canWrite={ready.canWrite} t={t} />)}
          <details className="rounded-2xl border bg-card px-4 py-3 text-sm">
            <summary className={`cursor-pointer font-medium ${focusClass}`}>{t("effectiveRule")}</summary>
            <p className={`mt-2 ${summaryClass}`}>{t("description")}</p>
          </details>
        </>
      ) : null}
    </div>
  );
}
