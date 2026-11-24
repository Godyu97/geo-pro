import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { BrandDao } from "../brands/dao";
import {
  briefStatusAction,
  inspectCitationAction,
  proposeBriefAction,
  recordMentionsAction,
  saveCompetitorSetAction,
} from "./actions";
import { readCompetitorWorkspace } from "./commands";

const actionClass = "h-auto max-w-full whitespace-normal text-left";
const linkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";
const emptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-sm leading-7 break-words text-muted-foreground";
const fieldClass = "w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2";
const selectWrap = "grid min-w-0 grid-cols-[minmax(0,1fr)]";

const sourceState = {
  observed: "state_observed",
  limited: "state_limited",
  resolved: "state_resolved",
  unknown: "state_unknown",
} as const;

function shareText(share: number | null, na: string) {
  return share === null ? na : String(share);
}

function citationOption(url: string) {
  if (url.length <= 72) return url;
  return `${url.slice(0, 40)}…${url.slice(-24)}`;
}

function knownError(error: string) {
  if (error === "NOT_FOUND" || error === "INVALID_INPUT" || error === "OPERATION_CONFLICT") return error;
  return "INVALID_INPUT";
}

function Canvas({
  title,
  summary,
  primary,
  relatedLabel,
  answersHref,
  overviewHref,
  answersLabel,
  overviewLabel,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  answersHref: string;
  overviewHref: string;
  answersLabel: string;
  overviewLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{title}</h1>
        {summary}
        {primary}
        <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
          <Link href={answersHref} prefetch={false} className={linkClass}>{answersLabel}</Link>
          <Link href={overviewHref} prefetch={false} className={linkClass}>{overviewLabel}</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

export async function generateMetadata() {
  const t = await getTranslator("competitorAnalysis");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CompetitorAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("competitorAnalysis");
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const requestedBrand = typeof params.brandId === "string" ? params.brandId : undefined;
  const brandId = requestedBrand ?? active?.id;
  const version = typeof params.version === "string" && /^[1-9]\d*$/.test(params.version)
    ? Number(params.version)
    : undefined;
  const error = typeof params.error === "string" ? params.error : "";
  const reason = typeof params.reason === "string" ? params.reason : "";
  const relatedLabel = t("relatedEntries");
  const answersHref = brandId ? `/dashboard/monitoring/answers?brandId=${brandId}` : "/dashboard/monitoring/answers";
  const overviewHref = brandId ? `/dashboard/monitoring/overview?brandId=${brandId}` : "/dashboard/monitoring/overview";
  const canvasLinks = {
    relatedLabel,
    answersHref,
    overviewHref,
    answersLabel: t("backAnswers"),
    overviewLabel: t("backOverview"),
  };

  if (!brandId) {
    return (
      <Canvas
        title={t("title")}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
          </Button>
        )}
        {...canvasLinks}
      />
    );
  }

  const workspace = await readCompetitorWorkspace(connection, session.user.id, brandId, version);
  if ("error" in workspace) {
    const recoveryHref = active ? "/dashboard/monitoring/competitors" : "/dashboard/brands";
    return (
      <Canvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7 wrap-anywhere">{t(knownError(workspace.error))}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <Link href={recoveryHref} prefetch={false}>{active ? t("currentBrand") : t("goBrands")}</Link>
          </Button>
        )}
        {...canvasLinks}
        answersHref={active ? `/dashboard/monitoring/answers?brandId=${active.id}` : "/dashboard/monitoring/answers"}
        overviewHref={active ? `/dashboard/monitoring/overview?brandId=${active.id}` : "/dashboard/monitoring/overview"}
      />
    );
  }

  const notice = reason === "copied_replacement"
    ? t("copied")
    : reason === "missing_evidence"
      ? t("missingEvidence")
      : error
        ? t(knownError(error))
        : "";
  const brandName = active?.id === brandId ? active.name : "";

  return (
    <Canvas
      title={t("title")}
      summary={(
        <>
          {brandName ? <p className="text-sm font-medium wrap-anywhere">{brandName}</p> : null}
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </>
      )}
      {...canvasLinks}
    >
      {notice ? <p role="alert" className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm leading-6 wrap-anywhere">{notice}</p> : null}

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{t("sets")}</h2>
        {workspace.sets.length === 0 ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("setsEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-2 text-sm">
            {workspace.sets.map((set) => (
              <li key={set.id} className="min-w-0">
                <Link
                  href={`/dashboard/monitoring/competitors?brandId=${brandId}&version=${set.version}`}
                  prefetch={false}
                  className="underline-offset-4 hover:underline"
                  aria-current={workspace.selected?.id === set.id ? "page" : undefined}
                >
                  {t("version", { version: set.version })}
                </Link>
                <p className="text-muted-foreground">
                  {set.labels.length === 0 ? t("shareNa") : set.labels.map((label) => (
                    <span key={label} className="mr-2 inline-block max-w-full align-top [overflow-wrap:anywhere]">{label}</span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={saveCompetitorSetAction} className="space-y-3">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("labels")}</span>
            <textarea name="labels" rows={3} className={fieldClass} />
          </label>
          <Button type="submit" className={actionClass}>{t("saveSet")}</Button>
        </form>
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("share")}</h2>
        {workspace.truncated ? <p className={emptyClass}>{t("truncated")}</p> : null}
        {!workspace.truncated && workspace.rows.length === 0 ? (
          <p className={emptyClass}>{t("setsEmpty")}</p>
        ) : null}
        {workspace.rows.length > 0 ? (
          <div
            role="region"
            aria-label={t("shareRegion")}
            tabIndex={0}
            className="max-w-full overflow-x-auto rounded-2xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full table-fixed text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-3 font-medium" scope="col">{t("brand")}</th>
                  <th className="w-16 px-2 py-3 align-bottom text-xs font-medium leading-4 [overflow-wrap:anywhere]" scope="col">{t("count")}</th>
                  <th className="w-16 px-2 py-3 align-bottom text-xs font-medium leading-4 [overflow-wrap:anywhere]" scope="col">{t("denominator")}</th>
                  <th className="w-16 px-2 py-3 align-bottom text-xs font-medium leading-4 [overflow-wrap:anywhere]" scope="col">{t("shareValue")}</th>
                </tr>
              </thead>
              <tbody>
                {workspace.rows.map((row) => (
                  <tr key={row.brandId} className="border-b">
                    <td className="px-3 py-3 align-top [overflow-wrap:anywhere]">{row.brandId}</td>
                    <td className="whitespace-nowrap px-2 py-3 align-top tabular-nums">{row.count}</td>
                    <td className="whitespace-nowrap px-2 py-3 align-top tabular-nums">{row.denominator}</td>
                    <td className="whitespace-nowrap px-2 py-3 align-top tabular-nums">{shareText(row.share, t("shareNa"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {workspace.rank.unorderedCount > 0 && !workspace.rank.ranked ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("unordered")}</p>
        ) : null}
        {workspace.rank.ranked ? (
          <p className="text-sm leading-7 text-muted-foreground">
            {t("mean", { mean: workspace.rank.mean === null ? t("shareNa") : workspace.rank.mean })}
          </p>
        ) : null}
        {workspace.rank.ranked && workspace.rank.excludedAbsent.length > 0 ? (
          <p className="text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">{t("absent", { names: workspace.rank.excludedAbsent.join(" · ") })}</p>
        ) : null}
        {workspace.rank.ranked && workspace.rank.unorderedCount > 0 ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("unorderedExcluded", { count: workspace.rank.unorderedCount })}</p>
        ) : null}
      </section>

      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{t("record")}</h2>
        {workspace.observations.length === 0 || !workspace.selected ? (
          <p className="text-sm leading-7 text-muted-foreground">{t("noObservations")}</p>
        ) : (
          <form action={recordMentionsAction} className="min-w-0 space-y-3">
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="setId" value={workspace.selected.id} />
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("observation")}</span>
              <span className={selectWrap}>
                <select name="observationId" className="h-10 w-full max-w-full rounded-md border bg-background px-3">
                  {workspace.observations.map((item) => (
                    <option key={item.id} value={item.id}>{item.questionText}</option>
                  ))}
                </select>
              </span>
            </label>
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm text-muted-foreground">{t("brand")}</legend>
              {workspace.selected.labels.map((label) => (
                <div key={label} className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input type="checkbox" name="label" value={label} className="mt-1" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                  </label>
                  <input
                    name={`position:${label}`}
                    inputMode="numeric"
                    aria-label={`${t("position")} ${label}`}
                    className="h-9 w-20 shrink-0 rounded-md border bg-background px-2"
                  />
                </div>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ordered" />
              <span>{t("ordered")}</span>
            </label>
            <Button type="submit" className={actionClass}>{t("saveMentions")}</Button>
          </form>
        )}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("sources")}</h2>
        {workspace.hosts.length > 0 ? (
          <ul className="min-w-0 text-sm leading-6 text-muted-foreground">
            {workspace.hosts.map((host) => (
              <li key={host.host} className="[overflow-wrap:anywhere]">{t("hosts")}: {host.host} · {host.pages}</li>
            ))}
          </ul>
        ) : null}
        {workspace.citations.length === 0 ? (
          <p className={emptyClass}>{t("sourcesEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {workspace.citations.map((citation) => (
              <li key={citation.citationId} className="min-w-0 rounded-2xl border bg-card px-4 py-3 text-sm">
                <p className="[overflow-wrap:anywhere]">{citation.rawUrl}</p>
                <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
                  <span>{t(sourceState[citation.state])}</span>
                  <span>{citation.support === "supports" ? t("supportSupports") : t("supportUnknown")}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {workspace.citations.length > 0 ? (
          <form action={inspectCitationAction} className={`${panelClass}`}>
            <h3 className="font-medium">{t("inspect")}</h3>
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("sources")}</span>
              <span className={selectWrap}>
                <select name="citationId" className="h-10 w-full max-w-full rounded-md border bg-background px-3">
                  {workspace.citations.map((citation) => (
                    <option key={citation.citationId} value={citation.citationId}>{citationOption(citation.rawUrl)}</option>
                  ))}
                </select>
              </span>
            </label>
            {(["pageLive", "readable", "authorKnown", "supportsBrand"] as const).map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} />
                <span>{t(name)}</span>
              </label>
            ))}
            <Button type="submit" className={actionClass}>{t("saveInspection")}</Button>
          </form>
        ) : null}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("briefs")}</h2>
        {workspace.briefs.length === 0 ? (
          <p className={emptyClass}>{t("briefsEmpty")}</p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {workspace.briefs.map((brief) => (
              <li key={brief.id} className="min-w-0 rounded-2xl border bg-card px-4 py-3 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{brief.questionCluster}</p>
                <p className="mt-1 [overflow-wrap:anywhere]">{brief.gap}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground">
                  <span>{t(brief.status)}</span>
                  <span>{brief.sourceIds.length}</span>
                </p>
                {brief.status === "proposed" ? (
                  <form action={briefStatusAction} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="briefId" value={brief.id} />
                    <Button type="submit" name="status" value="accepted" size="sm" className={actionClass}>{t("accept")}</Button>
                    <Button type="submit" name="status" value="dismissed" size="sm" variant="outline" className={actionClass}>{t("dismiss")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form action={proposeBriefAction} className={panelClass}>
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("questionCluster")}</span>
            <input name="questionCluster" required className={`${fieldClass} h-10`} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("gap")}</span>
            <textarea name="gap" required rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("facts")}</span>
            <textarea name="facts" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("briefSources")}</span>
            <span className={selectWrap}>
              <select name="sourceId" multiple className="min-h-24 w-full max-w-full rounded-md border bg-background px-3 py-2">
                {workspace.citations.map((citation) => (
                  <option key={citation.citationId} value={citation.citationId}>{citationOption(citation.rawUrl)}</option>
                ))}
              </select>
            </span>
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceText")}</span>
            <textarea name="sourceText" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("briefText")}</span>
            <textarea name="briefText" rows={3} className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceBrand")}</span>
            <input name="sourceBrand" className={`${fieldClass} h-10`} />
          </label>
          <label className="block min-w-0 text-sm">
            <span className="mb-1 block text-muted-foreground">{t("ownBrand")}</span>
            <input name="ownBrand" className={`${fieldClass} h-10`} />
          </label>
          <Button type="submit" className={actionClass}>{t("saveBrief")}</Button>
        </form>
      </section>
    </Canvas>
  );
}
