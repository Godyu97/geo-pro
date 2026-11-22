import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listBusinessLeads, type BusinessLeadView } from "./commands";
import { LeadImportForm } from "./import-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
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
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const evidenceLabel = {
    referral: t("evidenceReferral"),
    self_report: t("evidenceSelfReport"),
    landing_page: t("evidenceLandingPage"),
    unknown: t("evidenceUnknown"),
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

  const listed = await listBusinessLeads(connection, session.user.id, active.id);
  const leads: BusinessLeadView[] = "error" in listed ? [] : listed.leads;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/reports/lead-quality" prefetch={false}>{t("openQuality")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/reports?brandId=${active.id}`} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>
      <LeadImportForm locale={locale} messages={messages} brandId={active.id} />

      {leads.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("ledger")}</h2>
          {leads.map((lead) => (
            <article key={lead.id} className="space-y-2 rounded-2xl border p-5">
              <h3 className="text-base font-semibold tabular-nums">{t("eventLine", { id: lead.eventId })}</h3>
              <p className="text-sm">{t("countLine")}</p>
              <p className="text-sm">{t("primaryLine", { primary: evidenceLabel[lead.primary] })}</p>
              <div>
                <p className="text-sm font-medium">{t("evidenceHeading")}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {lead.evidence.map((category, index) => (
                    <li key={`${lead.id}-${index}`}>{evidenceLabel[category]}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
