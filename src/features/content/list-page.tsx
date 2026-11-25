import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { brandFixtureOrigin, brandIntakeOrigin } from "../brands/intake";
import { ApplyMockContentButton, ApplyMockPublicationButton } from "@/features/functional-mock/run-buttons";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { exportConfirmAction, exportPreflightAction, generateBatchAction, saveBriefAction } from "./actions";
import { listBriefs, listContentVersions, readExportJob, type ContentVersionFilter } from "./commands";
import { exportUiError, type ExportUiError } from "./contracts";

const emptyClass = "rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const itemClass = "min-w-0 rounded-2xl border bg-card px-4 py-4 text-sm";
const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-5";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const fieldClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const areaClass = "w-full min-w-0 rounded-md border bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const actionClass = "h-auto max-w-full whitespace-normal";
const checkClass = "mt-1 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50";
const packageFiles = ["content.md", "content.html", "manifest.json", "public-sources.json", "publish-checklist.md"] as const;

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function relatedLinks(
  t: Awaited<ReturnType<typeof getTranslator<"content">>>,
  brandId: string,
) {
  const query = `brandId=${encodeURIComponent(brandId)}`;
  return [
    { href: `/dashboard/content/sources?${query}`, label: t("sourcesLink") },
    { href: `/dashboard/content/templates?${query}`, label: t("templatesLink") },
    { href: `/dashboard/content/channel-profiles?${query}`, label: t("channelProfilesLink") },
    { href: `/dashboard/content/assets?${query}`, label: t("assetsLink") },
    { href: `/dashboard/content/media-reviews?${query}`, label: t("mediaReviewsLink") },
    { href: `/dashboard/content/calendar?${query}`, label: t("calendarLink") },
  ] as const;
}

type ExportJob = Exclude<Awaited<ReturnType<typeof readExportJob>>, { error: string }>;

function ExportNotice({ code, t }: { code: ExportUiError | undefined; t: Awaited<ReturnType<typeof getTranslator<"content">>> }) {
  if (!code) return null;
  return <p role="alert" className="break-words text-sm leading-6">{t(code)}</p>;
}

function ContentCanvas({
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
  relatedLabel?: string;
  related?: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        {related && relatedLabel ? (
          <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
            {related.map((item) => (
              <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export default async function ContentListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("content");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );

  if (!brandId) {
    return (
      <ContentCanvas
        title={t("title")}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={brandsAction}
      />
    );
  }

  const listed = await listBriefs(connection, session.user.id, brandId, 50);
  if ("error" in listed) {
    return (
      <ContentCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl text-sm leading-7">{t(listed.error)}</p>}
        primary={brandsAction}
      />
    );
  }

  const filter: ContentVersionFilter | undefined = params.filter === "pending_review" || params.filter === "deliverable"
    ? params.filter
    : undefined;
  const versionList = await listContentVersions(connection, session.user.id, brandId, 50, filter);
  const versions = "versions" in versionList ? versionList.versions : [];
  const filters = [
    { key: undefined, label: t("filterAll") },
    { key: "pending_review", label: t("filterPending") },
    { key: "deliverable", label: t("filterDeliverable") },
  ] as const;

  const confirmedIds = listed.briefs
    .filter((item) => item.brief.status === "confirmed")
    .map((item) => item.brief.id);
  const fixtureSampling = Boolean(brandFixtureOrigin(await headers()));
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";
  const related = relatedLinks(t, brandId);
  const operationId = typeof params.op === "string" ? params.op : "";
  const exportError = exportUiError(params.exportError);
  const exported = operationId ? await readExportJob(connection, session.user.id, brandId, operationId) : null;
  const job: ExportJob | null = exported && !("error" in exported) ? exported : null;
  const jobError = exported && "error" in exported ? exportUiError(exported.error) : undefined;

  return (
    <ContentCanvas
      title={t("title")}
      summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      {mockLane && (
        <div className="space-y-2">
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("mockContentNote")}</p>
          <ApplyMockContentButton
            brandId={brandId}
            label={t("applyMockContent")}
            pendingLabel={t("mockContentPending")}
            doneLabel={t("mockContentDone")}
            failedLabel={t("mockContentFailed")}
          />
          <ApplyMockPublicationButton
            brandId={brandId}
            label={t("applyMockPublication")}
            pendingLabel={t("mockPublicationPending")}
            doneLabel={t("mockPublicationDone")}
            failedLabel={t("mockPublicationFailed")}
          />
        </div>
      )}

      <section className={panelClass} aria-labelledby="new-brief-heading">
        <h2 id="new-brief-heading" className="text-lg font-semibold">{t("newBrief")}</h2>
        <form action={saveBriefAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block min-w-0 text-sm break-words sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("questionCluster")}</span>
            <input name="questionCluster" required className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("audience")}</span>
            <input name="audience" className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("targetGap")}</span>
            <input name="targetGap" className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("boundary")}</span>
            <input name="applicableBoundary" className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("primaryPage")}</span>
            <input name="primaryPage" className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("conversionAction")}</span>
            <input name="conversionAction" className={fieldClass} />
          </label>
          <label className="block min-w-0 text-sm break-words">
            <span className="mb-1 block text-muted-foreground">{t("templateKind")}</span>
            <select name="templateKind" defaultValue="fact_faq" className={fieldClass}>
              <option value="fact_faq">fact_faq</option>
              <option value="scenario_solution">scenario_solution</option>
              <option value="verifiable_comparison">verifiable_comparison</option>
            </select>
          </label>
          <label className="block min-w-0 text-sm break-words sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("titles")}</span>
            <textarea name="titleCandidates" rows={2} className={areaClass} />
          </label>
          <label className="block min-w-0 text-sm break-words sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("factIds")}</span>
            <textarea name="factVersionIds" rows={2} className={areaClass} />
          </label>
          <label className="block min-w-0 text-sm break-words sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("competitorSource")}</span>
            <input name="competitorSource" className={fieldClass} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" className={actionClass}>{t("saveBrief")}</Button>
          </div>
        </form>
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="briefs-heading">
        <h2 id="briefs-heading" className="text-lg font-semibold">{t("briefs")}</h2>
        {listed.briefs.length === 0 ? (
          <p className={emptyClass}>{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {listed.briefs.map(({ brief, version, gaps }) => (
              <li key={brief.id} className={itemClass}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/content/briefs/${brief.id}`}
                      prefetch={false}
                      className="break-words font-medium underline-offset-4 hover:underline"
                    >
                      {version ? JSON.parse(version.titleCandidatesJson)[0] || brief.id : brief.id}
                    </Link>
                    <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">
                      {version?.primaryPage ?? "—"}
                      {" · "}
                      {t("gapCount", { count: formatNumber(locale, gaps.length) })}
                    </p>
                  </div>
                  <Badge variant="secondary">{brief.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="text-lg font-semibold">{t("plans")}</h2>
        {listed.plans.length === 0 ? (
          <p className={emptyClass}>{t("plansEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {listed.plans.map((plan) => (
              <li key={plan.id} className={itemClass}>
                <p className="break-words font-medium">{plan.questionCluster}</p>
                <p className="mt-2 break-all text-muted-foreground">{plan.coverageJson}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="text-lg font-semibold">{t("versions")}</h2>
        <nav className="flex min-w-0 flex-wrap gap-2 text-sm" aria-label={t("versions")}>
          {filters.map((item) => {
            const search = new URLSearchParams({ brandId });
            if (item.key) search.set("filter", item.key);
            if (operationId) search.set("op", operationId);
            return (
              <Link
                key={item.label}
                href={`/dashboard/content?${search.toString()}`}
                prefetch={false}
                aria-current={item.key === filter ? "page" : undefined}
                className={`inline-flex min-h-9 max-w-full items-center rounded-full border px-3 py-1 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${item.key === filter ? "bg-muted font-medium" : "bg-card"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {versions.length === 0 ? (
          <p className={emptyClass}>{t("versionsEmpty")}</p>
        ) : (
          <form action={exportPreflightAction} className="min-w-0 space-y-3">
            <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">{t("batchExportHint")}</p>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="source" value="list" />
            {filter ? <input type="hidden" name="filter" value={filter} /> : null}
            <label className="block min-w-0 max-w-sm text-sm break-words">
              <span className="mb-1 block text-muted-foreground">{t("exportMode")}</span>
              <select name="mode" defaultValue="auto" className={fieldClass}>
                <option value="auto">{t("modeAuto")}</option>
                <option value="formal">{t("modeFormal")}</option>
                <option value="review">{t("modeReview")}</option>
              </select>
            </label>
            <ul className="space-y-3">
              {versions.map((version) => (
                <li key={version.id} className={itemClass}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        name="versionId"
                        value={version.id}
                        aria-label={t("selectForPreflight", { title: version.title })}
                        className={checkClass}
                      />
                      <Link
                        href={`/dashboard/content/versions/${version.id}`}
                        prefetch={false}
                        className="min-w-0 break-words font-medium underline-offset-4 hover:underline"
                      >
                        {version.title}
                      </Link>
                    </div>
                    <Badge variant="secondary">{version.status}</Badge>
                  </div>
                  <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">{version.targetChannel} · {version.updatedAt}</p>
                </li>
              ))}
            </ul>
            <Button type="submit" className={actionClass}>{t("runBatchPreflight")}</Button>
          </form>
        )}
        {job ? null : <ExportNotice code={exportError ?? jobError} t={t} />}
      </section>

      {job ? (
        <section className={panelClass} aria-labelledby="batch-preflight-heading">
          <h2 id="batch-preflight-heading" className="text-lg font-semibold">{t("batchPreflightTitle")}</h2>
          <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">{t("batchPreflightHint")}</p>
          <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{job.job.operationId}</p>
          <ExportNotice code={exportError ?? jobError} t={t} />
          <ul className="space-y-2">
            {job.items.map((item) => (
              <li key={item.versionId} className="min-w-0 rounded-xl border px-4 py-3 text-sm">
                <p className="break-words font-medium">{item.title}</p>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={item.eligible ? "secondary" : "outline"}>
                    {item.eligible ? t("eligible") : t("blocked")}
                  </Badge>
                  <Badge variant="outline">{item.kind === "formal" ? t("formal") : t("review")}</Badge>
                </div>
                {item.blockers.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 break-words text-muted-foreground" aria-label={t("blockers")}>
                    {item.blockers.map((code) => (
                      <li key={code}>
                        <span className="font-mono text-xs">{code}</span>
                        {" "}
                        {t(code)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {job.job.status === "queued" ? (
            <form action={exportConfirmAction} className="min-w-0 space-y-3">
              <input type="hidden" name="brandId" value={brandId} />
              <input type="hidden" name="source" value="list" />
              <input type="hidden" name="operationId" value={job.job.operationId} />
              {filter ? <input type="hidden" name="filter" value={filter} /> : null}
              <ul className="space-y-2">
                {job.items.map((item) => (
                  <li key={item.versionId}>
                    <label className="flex min-w-0 items-start gap-3 text-sm break-words">
                      <input
                        type="checkbox"
                        name="chosenVersionId"
                        value={item.versionId}
                        aria-label={t("chooseForExport", { title: item.title })}
                        className={checkClass}
                      />
                      <span className="min-w-0">
                        {item.title}
                        {" · "}
                        {item.eligible ? t("eligible") : t("blocked")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button type="submit" className={actionClass}>{t("confirmBatchExport")}</Button>
            </form>
          ) : null}
          {job.job.status === "ready" ? <p role="status" className="text-sm">{t("exportDone")}</p> : null}
          {job.job.status === "failed" ? (
            <p role="alert" className="break-words text-sm">{t("exportFailed")}{job.job.error ? `: ${t(exportUiError(job.job.error) ?? "SERVICE_UNAVAILABLE")}` : ""}</p>
          ) : null}
          <h3 className="text-base font-semibold">{t("batchPackages")}</h3>
          {job.packages.length === 0 ? (
            <p className={emptyClass}>{t("packagesEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {job.packages.map((pkg) => {
                const title = job.items.find((item) => item.versionId === pkg.contentVersionId)?.title ?? pkg.contentVersionId;
                return (
                  <li key={pkg.id} className="min-w-0 rounded-xl border px-4 py-3 text-sm">
                    <p className="break-words font-medium">{title}</p>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="secondary">{pkg.kind === "formal" ? t("formal") : t("review")}</Badge>
                      {pkg.nonPublishable ? <Badge variant="outline">{t("nonPublishable")}</Badge> : null}
                      {pkg.doNotReuse ? <Badge variant="outline">{t("doNotReuse")}</Badge> : null}
                    </div>
                    <p className="mt-2 flex min-w-0 flex-wrap gap-3">
                      {packageFiles.map((file) => (
                        <a
                          key={file}
                          href={`/api/content/packages/${pkg.id}?file=${file}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {t("download")} {file}
                        </a>
                      ))}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {confirmedIds.length > 0 ? (
        <section className={panelClass} aria-labelledby="generate-batch-heading">
          <h2 id="generate-batch-heading" className="text-lg font-semibold">{t("generateBatch")}</h2>
          <form action={generateBatchAction} className="min-w-0 space-y-3">
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block min-w-0 text-sm break-words">
              <span className="mb-1 block text-muted-foreground">{t("briefIds")}</span>
              <textarea
                name="briefIds"
                rows={2}
                defaultValue={confirmedIds.slice(0, 5).join("\n")}
                className={areaClass}
              />
            </label>
            {fixtureSampling ? (
              <label className="block min-w-0 text-sm break-words">
                <span className="mb-1 block text-muted-foreground">{t("fixtureFailBriefs")}</span>
                <textarea name="failBriefIds" rows={2} className={areaClass} />
              </label>
            ) : null}
            <Button type="submit" className={actionClass}>{t("runGenerate")}</Button>
          </form>
        </section>
      ) : null}
    </ContentCanvas>
  );
}
