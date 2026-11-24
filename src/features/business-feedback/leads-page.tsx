import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listBusinessLeads } from "./commands";
import { LeadImportForm } from "./import-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const leadsPath = "/dashboard/reports/leads";
const reportsPath = "/dashboard/reports";
const rowsId = "lead-rows";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const brand = await new BrandDao(connection).active(ownerId);
    if (!brand) return { kind: "noBrand" } as const;
    const listed = await listBusinessLeads(connection, ownerId, brand.id);
    if (listed.error) return { kind: "error", code: listed.error } as const;
    return { kind: "ready", brand, leads: listed.leads } as const;
  } catch {
    console.error("business-leads-page-read-unavailable");
    return { kind: "error", code: "SERVICE_UNAVAILABLE" } as const;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("businessLeads");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function BusinessLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("businessLeads");
  const messages = getMessages(locale).businessLeads;
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const workspace = await readWorkspace(session.user.id);
  const ready = workspace.kind === "ready" ? workspace : null;
  const reportsHref = ready ? `${reportsPath}?brandId=${encodeURIComponent(ready.brand.id)}` : reportsPath;
  const evidenceLabel = {
    referral: t("evidenceReferral"),
    self_report: t("evidenceSelfReport"),
    landing_page: t("evidenceLandingPage"),
    unknown: t("evidenceUnknown"),
  } as const;

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {ready ? <p className={summaryClass}>{ready.brand.name}</p> : null}
        {workspace.kind === "error" ? (
          <p role="alert" className={summaryClass}>{t(workspace.code)}</p>
        ) : (
          <p className={summaryClass}>{t(workspace.kind === "noBrand" ? "noBrand" : "description")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {workspace.kind === "error" && workspace.code === "SERVICE_UNAVAILABLE" ? (
            <Button asChild className={actionClass}><a href={leadsPath}>{t("reload")}</a></Button>
          ) : null}
          {workspace.kind === "noBrand" || (workspace.kind === "error" && workspace.code === "NOT_FOUND") ? (
            <Button asChild className={actionClass}><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
          ) : null}
          {ready ? (
            <>
              <Button asChild className={actionClass}><a href={`#${rowsId}`}>{t("startImport")}</a></Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/lead-quality" prefetch={false}>{t("openQuality")}</Link>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/lead-suggestions" prefetch={false}>{t("openSuggestions")}</Link>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={reportsHref} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </header>

      {ready ? (
        <>
          {isKnownError(errorCode) ? (
            <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-sm">{t(errorCode)}</p>
          ) : null}
          {ready.leads.length === 0 ? (
            <p role="status" className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
          <LeadImportForm key={ready.brand.id} locale={locale} messages={messages} brandId={ready.brand.id} rowsId={rowsId} />

          {ready.leads.length > 0 ? (
            <section aria-labelledby="lead-ledger" className="space-y-4">
              <h2 id="lead-ledger" className="text-lg font-semibold">{t("ledger")}</h2>
              {ready.leads.map((lead) => (
                <article key={lead.id} className="space-y-2 rounded-2xl border bg-card p-5 [overflow-wrap:anywhere]">
                  <h3 className="text-base font-semibold tabular-nums">{t("eventLine", { id: lead.eventId })}</h3>
                  <p className="text-sm">{t("countLine")}</p>
                  <p className="text-sm">{t("primaryLine", { primary: evidenceLabel[lead.primary] })}</p>
                  <div>
                    <p className="text-sm font-medium">{t("evidenceHeading")}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {lead.evidence.map((category) => <li key={category}>{evidenceLabel[category]}</li>)}
                    </ul>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
