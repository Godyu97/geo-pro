import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { createInterventionBatchAction, registerInterventionPageAction } from "./intervention-actions";
import { listInterventionBatches, type InterventionBatchView } from "./intervention-commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const inputClass = "h-10 w-full rounded-md border bg-background px-3";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
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
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const statusLabel: Record<InterventionBatchView["status"], string> = {
    pending: t("statusPending"),
    effective: t("statusEffective"),
  };

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listInterventionBatches(connection, session.user.id, active.id);
  const batches: InterventionBatchView[] = "error" in listed ? [] : listed.batches;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/reports?brandId=${active.id}`} prefetch={false}>{t("backReports")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>

      <form action={createInterventionBatchAction} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <Button type="submit">{t("create")}</Button>
      </form>

      {batches.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : batches.map((batch) => (
        <section key={batch.id} className="space-y-5 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{statusLabel[batch.status]}</h2>
            <p className="text-sm tabular-nums">
              {batch.effectiveAt ? t("effectiveLine", { time: batch.effectiveAt }) : t("pendingLine")}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold">{t("pagesHeading")}</h3>
            {batch.pages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPages")}</p>
            ) : (
              <ul className="space-y-2">
                {batch.pages.map((page) => (
                  <li key={page.id} className="rounded-xl border border-dashed px-4 py-3 text-sm">
                    <p className="break-all">{page.pageKey}</p>
                    <p className="mt-1 tabular-nums text-muted-foreground">
                      {page.verifiedAt ? t("verifiedLine", { time: page.verifiedAt }) : t("unverifiedLine")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form action={registerInterventionPageAction} className="grid gap-4 sm:grid-cols-2">
            <h3 className="text-base font-semibold sm:col-span-2">{t("pageTitle")}</h3>
            <input type="hidden" name="batchId" value={batch.id} />
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>{t("pageKey")}</span>
              <input name="pageKey" required maxLength={300} autoComplete="off" spellCheck={false} className={inputClass} />
              <span className="block text-muted-foreground">{t("pageKeyHint")}</span>
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>{t("verifiedAt")}</span>
              <input name="verifiedAt" maxLength={40} autoComplete="off" spellCheck={false} className={`${inputClass} tabular-nums`} />
              <span className="block text-muted-foreground">{t("verifiedAtHint")}</span>
            </label>
            <div>
              <Button type="submit">{t("savePage")}</Button>
            </div>
          </form>
        </section>
      ))}
    </div>
  );
}
