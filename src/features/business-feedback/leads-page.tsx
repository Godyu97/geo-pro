import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { authorizeBrandActor, workspaceBrand } from "../team-access/brand-scope";
import { TeamAccessDao } from "../team-access/dao";
import { authorizePlatformAdmin } from "../team-access/platform-role";
import { readBrandSyncSurface } from "../data-connections/commands";
import { listBusinessLeads, readBusinessLead } from "./commands";
import { LeadFeedbackDao, type LeadFeedback } from "./feedback-dao";
import { LeadFeedbackForm } from "./feedback-form";
import { LeadQualityDao } from "./quality-dao";
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

async function readWorkspace(actorId: string, params: Record<string, string | string[] | undefined>) {
  const requested = brandIdSchema.safeParse(params.brandId);
  const leadId = brandIdSchema.safeParse(params.leadId);
  const feedbackId = brandIdSchema.safeParse(params.feedbackId);
  if ((!requested.success && params.brandId !== undefined) || (!leadId.success && params.leadId !== undefined)
    || (params.feedbackId !== undefined && (!leadId.success || !feedbackId.success))) {
    return { kind: "error", code: "INVALID_INPUT" } as const;
  }
  try {
    const connection = getConnection();
    const brandDao = new BrandDao(connection);
    const own = requested.success ? null : await brandDao.active(actorId);
    const brandId = requested.data ?? own?.id;
    const scope = await workspaceBrand(connection, actorId, brandId, "read");
    const canAdminRead = !scope && requested.success && await authorizePlatformAdmin(connection, actorId);
    const adminBrand = canAdminRead ? await new TeamAccessDao(connection).brandActor(actorId, requested.data) : null;
    const ownerId = scope?.ownerId ?? adminBrand?.ownerId;
    const resolvedBrandId = scope?.brandId ?? brandId;
    const brand = ownerId && resolvedBrandId ? await brandDao.ownedSummary(ownerId, resolvedBrandId) : null;
    if (!brand || !ownerId) return requested.success || leadId.success
      ? { kind: "error", code: "NOT_FOUND" } as const : { kind: "noBrand" } as const;

    const dao = new LeadFeedbackDao(connection);
    const canWrite = scope ? Boolean(await authorizeBrandActor(connection, actorId, brand.id, "write")) : false;
    let selected: { current: LeadFeedback | null; saved: LeadFeedback | null } | null = null;
    let rules: { id: string; version: number }[] = [];
    const listed = leadId.success
      ? await readBusinessLead(connection, ownerId, leadId.data)
      : await listBusinessLeads(connection, ownerId, brand.id);
    if ("error" in listed) return { kind: "error", code: "NOT_FOUND" } as const;
    const leads = "lead" in listed ? [listed.lead] : listed.leads;
    if (leads.some((lead) => lead.brandId !== brand.id)) return { kind: "error", code: "NOT_FOUND" } as const;
    if (leadId.success) {
      const current = await dao.read(leadId.data);
      const saved = feedbackId.success && feedbackId.data !== current?.id ? await dao.read(leadId.data, feedbackId.data) : current;
      if (feedbackId.success && !saved) return { kind: "error", code: "NOT_FOUND" } as const;
      selected = { current, saved };
      if (canWrite && !feedbackId.success) rules = await new LeadQualityDao(connection).frozenRulesForBrand(ownerId, brand.id);
    }
    const statuses = selected ? [] : await dao.currentForBrand(ownerId, brand.id);
    const surface = await readBrandSyncSurface(connection, ownerId, brand.id, leads.map((lead) => lead.eventId));
    return { kind: "ready", brand, leads, surface, selected, rules, canWrite, feedbackId: feedbackId.data,
      canImport: canWrite && scope?.ownerId === actorId, statuses: new Map(statuses.map((item) => [item.leadId, item])) } as const;
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
  const workspace = await readWorkspace(session.user.id, params);
  const ready = workspace.kind === "ready" ? workspace : null;
  const syncSources = ready ? [...new Set(ready.surface.sources.map((source) => source.source))] : [];
  const reportsHref = ready ? `${reportsPath}?brandId=${encodeURIComponent(ready.brand.id)}` : reportsPath;
  const ledgerHref = ready ? `${leadsPath}?brandId=${encodeURIComponent(ready.brand.id)}` : leadsPath;
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
            <Button asChild className={actionClass}><a href={`${leadsPath}${typeof params.brandId === "string" ? `?brandId=${encodeURIComponent(params.brandId)}` : ""}`}>{t("reload")}</a></Button>
          ) : null}
          {workspace.kind === "noBrand" || (workspace.kind === "error" && workspace.code === "NOT_FOUND") ? (
            <Button asChild className={actionClass}><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
          ) : null}
          {ready ? (
            <>
              {ready.selected ? (
                <Button asChild className={actionClass}><Link href={ledgerHref}>{t("feedbackBackLedger")}</Link></Button>
              ) : ready.canImport ? (
                <Button asChild className={actionClass}><a href={`#${rowsId}`}>{t("startImport")}</a></Button>
              ) : null}
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
          {ready.canImport && !ready.selected ? (
            <LeadImportForm key={ready.brand.id} locale={locale} messages={messages} brandId={ready.brand.id} rowsId={rowsId} />
          ) : null}
          <section aria-labelledby="lead-sync" className="min-w-0 space-y-3">
            <h2 id="lead-sync" className="text-lg font-semibold">{t("syncHeading")}</h2>
            {(ready.surface.connections.length > 0 ? ready.surface.connections : [null]).map((connection) => (
              <article key={connection?.id ?? "sync-empty"} className="min-w-0 space-y-2 rounded-xl border bg-card p-4 text-sm leading-6">
                {connection ? <h3 className="font-medium [overflow-wrap:anywhere]">{connection.displayName}</h3> : null}
                <p className="[overflow-wrap:anywhere]">{connection?.syncCursor ?? t("syncCursorEmpty")}</p>
                {connection?.coverageComplete === false ? <p>{t("coverageIncomplete")}</p> : null}
                {connection?.missingHistoricalReceipts ? <p>{t("missingHistoricalReceipts")}</p> : null}
                {connection?.syncStopped ? <p>{t("syncStoppedNotice")}</p> : null}
                <p className="font-medium">{t("sourcesHeading")}</p>
                <p>{syncSources.length === 0 ? t("sourcesEmpty") : syncSources.map((source) => t(source === "csv" ? "sourceCsv" : "sourceConnector")).join(" · ")}</p>
              </article>
            ))}
          </section>

          {ready.leads.length > 0 ? (
            <section aria-labelledby="lead-ledger" className="space-y-4">
              <h2 id="lead-ledger" className="text-lg font-semibold">{t("ledger")}</h2>
              {ready.leads.map((lead) => {
                const detailHref = `${ledgerHref}&leadId=${lead.id}#lead-record`;
                const feedback = ready.selected ? ready.selected.saved : ready.statuses.get(lead.id);
                return (
                  <article key={lead.id} id={ready.selected ? "lead-record" : undefined} tabIndex={ready.selected ? -1 : undefined} className="space-y-2 rounded-2xl border bg-card p-5 [overflow-wrap:anywhere]">
                    <h3 className="text-base font-semibold tabular-nums">{t("eventLine", { id: lead.eventId })}</h3>
                    <p className="text-sm">{t("countLine")}</p>
                    <p className="text-sm">{t("primaryLine", { primary: evidenceLabel[lead.primary] })}</p>
                    <div>
                      <p className="text-sm font-medium">{t("evidenceHeading")}</p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {lead.evidence.map((category) => <li key={category}>{evidenceLabel[category]}</li>)}
                      </ul>
                    </div>
                    <p className="text-sm font-medium">{t("sourcesHeading")}</p>
                    <p className="text-sm">
                      {ready.surface.sources.some((source) => source.eventId === lead.eventId)
                        ? ready.surface.sources
                          .filter((source) => source.eventId === lead.eventId)
                          .map((source) => t(source.source === "csv" ? "sourceCsv" : "sourceConnector"))
                          .join(" · ")
                        : t("sourcesEmpty")}
                    </p>
                    <p className="text-sm">{t("feedbackStatusLine", { status: t(`qualification_${feedback?.status ?? "unknown"}`) })}</p>
                    <p className="text-sm">{t("feedbackOutcomeLine", { outcome: t(`outcome_${feedback?.outcome ?? "unknown"}`) })}</p>
                    {ready.selected?.saved ? (
                      <p className="text-sm">{t("feedbackRevisionLine", {
                        revision: ready.selected.saved.revision, version: ready.selected.saved.ruleVersion,
                      })}</p>
                    ) : null}
                    {!ready.selected || ready.feedbackId ? (
                      <Link href={detailHref} className="inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4">
                        {t(!ready.selected && ready.canWrite ? "feedbackEdit" : "feedbackViewCurrent")}
                      </Link>
                    ) : ready.canWrite && ready.rules.length ? (
                      <LeadFeedbackForm key={lead.id} brandId={ready.brand.id} leadId={lead.id}
                        current={ready.selected.current} rules={ready.rules} locale={locale} messages={messages} />
                    ) : ready.canWrite ? (
                      <p className="text-sm">{t("feedbackNoRules")}</p>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
