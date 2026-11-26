import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmBriefAction, saveBriefAction } from "./actions";
import { listApprovedBriefFacts, readBriefDetail } from "./commands";
import type { ContentGapCode } from "./contracts";
import { FactDraftButton } from "./fact-draft-button";

const actionClass = "h-auto max-w-full whitespace-normal";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const fieldClass = "h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const areaClass = "w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Translate = Awaited<ReturnType<typeof getTranslator<"content">>>;

const gapFields = {
  audienceMissing: { text: "gapAudienceMissing", action: "gapActionAudience", field: "brief-audience" },
  targetGapMissing: { text: "gapTargetGapMissing", action: "gapActionTargetGap", field: "brief-target-gap" },
  boundaryMissing: { text: "gapBoundaryMissing", action: "gapActionBoundary", field: "brief-boundary" },
  sourceMissing: { text: "gapSourceMissing", action: "gapActionFacts", field: "brief-facts" },
  primaryPageMissing: { text: "gapPrimaryPageMissing", action: "gapActionPrimaryPage", field: "brief-primary-page" },
  conversionActionMissing: { text: "gapConversionMissing", action: "gapActionConversion", field: "brief-conversion" },
  templateMissing: { text: "gapTemplateMissing", action: "gapActionTemplate", field: "brief-template" },
  titlesMissing: { text: "gapTitlesMissing", action: "gapActionTitles", field: "brief-titles" },
  factsMissing: { text: "gapFactsMissing", action: "gapActionFacts", field: "brief-facts" },
  competitorSourceMissing: { text: "gapCompetitorMissing", action: "gapActionCompetitor", field: "brief-competitor" },
} as const satisfies Record<ContentGapCode, { text: Parameters<Translate>[0]; action: Parameters<Translate>[0]; field: string }>;

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("briefDetail"), robots: { index: false, follow: false } };
}

function BriefCanvas({
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

export default async function ContentBriefPage({
  params,
}: {
  params: Promise<{ briefId: string }>;
}) {
  const session = await requireSession();
  const { briefId } = await params;
  const t = await getTranslator("content");
  const href = `/dashboard/content/briefs/${briefId}`;
  const related = [
    { href: "/dashboard/content", label: t("backToList") },
  ];
  let detail: Awaited<ReturnType<typeof readBriefDetail>>;
  try {
    detail = await readBriefDetail(getConnection(), session.user.id, briefId);
  } catch {
    console.error("content-brief-read-failed", { briefId });
    detail = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in detail) {
    if (detail.error === "NOT_FOUND") notFound();
    return (
      <BriefCanvas
        title={t("briefDetail")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("briefUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={href}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={related}
      />
    );
  }

  const { brief, version, gaps, fields } = detail;
  const approvedFacts = await listApprovedBriefFacts(getConnection(), session.user.id, brief.brandId);
  const approvedFactIds = new Set(approvedFacts.map((fact) => fact.id));
  const otherFactIds = fields?.factVersionIds.filter((id) => !approvedFactIds.has(id)) ?? [];
  const heading = fields?.titleCandidates.find((item) => item.trim()) || t("briefDetail");
  const task = gaps.length > 0
    ? t("briefTaskGaps")
    : brief.status === "confirmed"
      ? t("briefTaskConfirmed")
      : t("briefTaskReady");
  const firstGap = gaps[0] ? gapFields[gaps[0].code] : null;
  const links = [
    ...related,
    { href: `/dashboard/brands/${brief.brandId}/facts`, label: t("brandFactsLink") },
    { href: `/dashboard/content/sources?brandId=${encodeURIComponent(brief.brandId)}`, label: t("sourcesLink") },
  ];

  return (
    <BriefCanvas
      title={heading}
      summary={(
        <div className="max-w-2xl space-y-3">
          <p className="break-words text-sm leading-7 text-muted-foreground">{task}</p>
          <Badge variant="secondary">{brief.status}</Badge>
        </div>
      )}
      primary={firstGap ? (
        <Button asChild className={actionClass}>
          <a href={`#${firstGap.field}`}>{t(firstGap.action)}</a>
        </Button>
      ) : brief.status !== "confirmed" ? (
        <form action={confirmBriefAction}>
          <input type="hidden" name="brandId" value={brief.brandId} />
          <input type="hidden" name="briefId" value={brief.id} />
          <Button type="submit" className={actionClass}>{t("confirmBrief")}</Button>
        </form>
      ) : (
        <FactDraftButton
          brandId={brief.brandId}
          briefId={brief.id}
          label={t("generateFactDraft")}
          pendingLabel={t("generatingFactDraft")}
          readyLabel={t("factDraftReady")}
          openLabel={t("openVersion")}
          fallbackError={t("AI_FAILED")}
        />
      )}
      relatedLabel={t("relatedEntries")}
      related={links}
    >
      {gaps.length > 0 ? (
        <section className="min-w-0 rounded-2xl border border-dashed bg-card px-4 py-4 text-sm">
          <p className="font-medium">{t("gapsTitle")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 break-words text-muted-foreground">
            {gaps.map((gap) => <li key={gap.code}>{t(gapFields[gap.code].text)}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("editBrief")}</h2>
        {fields?.primaryPage ? (
          <p className="[overflow-wrap:anywhere] text-sm leading-6 text-muted-foreground">{fields.primaryPage}</p>
        ) : null}
        <form action={saveBriefAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brief.brandId} />
          <input type="hidden" name="briefId" value={brief.id} />
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-audience">
            <span className="mb-1 block text-muted-foreground">{t("audience")}</span>
            <input id="brief-audience" name="audience" defaultValue={fields?.audience ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-target-gap">
            <span className="mb-1 block text-muted-foreground">{t("targetGap")}</span>
            <input id="brief-target-gap" name="targetGap" defaultValue={fields?.targetGap ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-boundary">
            <span className="mb-1 block text-muted-foreground">{t("boundary")}</span>
            <input id="brief-boundary" name="applicableBoundary" defaultValue={fields?.applicableBoundary ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-primary-page">
            <span className="mb-1 block text-muted-foreground">{t("primaryPage")}</span>
            <input id="brief-primary-page" name="primaryPage" defaultValue={fields?.primaryPage ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-conversion">
            <span className="mb-1 block text-muted-foreground">{t("conversionAction")}</span>
            <input id="brief-conversion" name="conversionAction" defaultValue={fields?.conversionAction ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <label className="block min-w-0 text-sm break-words" htmlFor="brief-template">
            <span className="mb-1 block text-muted-foreground">{t("templateKind")}</span>
            <select id="brief-template" name="templateKind" defaultValue={fields?.templateKind ?? "fact_faq"} className={`${fieldClass} scroll-mt-28`}>
              <option value="fact_faq">fact_faq</option>
              <option value="scenario_solution">scenario_solution</option>
              <option value="verifiable_comparison">verifiable_comparison</option>
            </select>
          </label>
          <label className="block min-w-0 text-sm break-words sm:col-span-2" htmlFor="brief-titles">
            <span className="mb-1 block text-muted-foreground">{t("titles")}</span>
            <textarea
              id="brief-titles"
              name="titleCandidates"
              rows={2}
              defaultValue={(fields?.titleCandidates ?? []).join("\n")}
              className={`${areaClass} scroll-mt-28`}
            />
          </label>
          <fieldset id="brief-facts" className="min-w-0 space-y-2 text-sm scroll-mt-28 sm:col-span-2">
            <legend className="text-muted-foreground">{t("selectApprovedFacts")}</legend>
            {approvedFacts.length === 0 ? (
              <p className="text-muted-foreground">{t("noApprovedFacts")}</p>
            ) : (
              <ul className="space-y-2">
                {approvedFacts.map((fact) => (
                  <li key={fact.id}>
                    <label className="flex min-w-0 items-start gap-2.5 break-words">
                      <input
                        type="checkbox"
                        name="factVersionId"
                        value={fact.id}
                        defaultChecked={fields?.factVersionIds.includes(fact.id) ?? false}
                        className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{fact.title}</span>
                        {" — "}
                        <span className="text-muted-foreground">{fact.claim}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <label className="block min-w-0 text-sm break-words sm:col-span-2" htmlFor="brief-fact-ids">
            <span className="mb-1 block text-muted-foreground">{t("factIds")}</span>
            <textarea
              id="brief-fact-ids"
              name="factVersionIds"
              rows={2}
              defaultValue={otherFactIds.join("\n")}
              className={`${areaClass} scroll-mt-28 [overflow-wrap:anywhere]`}
            />
          </label>
          <label className="block min-w-0 text-sm break-words sm:col-span-2" htmlFor="brief-competitor">
            <span className="mb-1 block text-muted-foreground">{t("competitorSource")}</span>
            <input id="brief-competitor" name="competitorSource" defaultValue={fields?.competitorSource ?? ""} className={`${fieldClass} scroll-mt-28`} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" className={actionClass}>{t("saveBrief")}</Button>
          </div>
        </form>
        <p className="break-all text-xs leading-5 text-muted-foreground">{brief.id}</p>
        {version ? (
          <p className="text-xs text-muted-foreground">
            rev {version.revision} · {version.templateKind}
          </p>
        ) : null}
      </section>
    </BriefCanvas>
  );
}
