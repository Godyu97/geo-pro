import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exportConfirmAction,
  exportPreflightAction,
  registerAssetAction,
  reviewVersionAction,
  submitPublicationAction,
  updateVariantAction,
} from "./actions";
import { readContentVersion, readExportJob } from "./commands";
import { exportUiError, type VersionStatus } from "./contracts";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("versionDetail"), robots: { index: false, follow: false } };
}

const assetErrorCodes = ["ASSET_TYPE_REJECTED", "ASSET_TOO_LARGE", "ASSET_UNREVIEWED", "INVALID_INPUT", "NOT_FOUND", "SERVICE_UNAVAILABLE"] as const;

function assetErrorCode(value: string | string[] | undefined) {
  const code = Array.isArray(value) ? value[0] : value;
  return assetErrorCodes.find((item) => item === code);
}

const actionClass = "h-auto max-w-full whitespace-normal";
const inputClass = "h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3";
const areaClass = "w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Translate = Awaited<ReturnType<typeof getTranslator<"content">>>;
type ReviewName = "submit-review" | "approve-content" | "reject-content";

function VersionCanvas({
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

function ReviewButton({
  action,
  version,
  label,
  variant,
}: {
  action: ReviewName;
  version: { id: string; brandId: string };
  label: string;
  variant?: "outline";
}) {
  return (
    <form action={reviewVersionAction}>
      <input type="hidden" name="brandId" value={version.brandId} />
      <input type="hidden" name="versionId" value={version.id} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" variant={variant} className={actionClass}>{label}</Button>
    </form>
  );
}

function ExportPreflightForm({
  version,
  t,
}: {
  version: { id: string; brandId: string };
  t: Translate;
}) {
  return (
    <form action={exportPreflightAction} className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
      <input type="hidden" name="brandId" value={version.brandId} />
      <input type="hidden" name="versionId" value={version.id} />
      <label className="block w-full min-w-0 max-w-full text-sm sm:w-auto">
        <span className="mb-1 block text-muted-foreground">{t("exportMode")}</span>
        <select name="mode" defaultValue="auto" className={inputClass}>
          <option value="auto">{t("modeAuto")}</option>
          <option value="formal">{t("modeFormal")}</option>
          <option value="review">{t("modeReview")}</option>
        </select>
      </label>
      <Button type="submit" className={actionClass}>{t("runPreflight")}</Button>
    </form>
  );
}

function taskCopy(t: Translate, status: VersionStatus, approvalCurrent: boolean, readOnly: boolean) {
  if (readOnly) return t("readOnly");
  if (status === "draft") return t("versionTaskDraft");
  if (status === "in_review") return t("versionTaskReview");
  if (status === "rejected") return t("versionTaskRejected");
  if (status === "invalidated") return t("versionTaskInvalidated");
  return approvalCurrent ? t("approvalCurrent") : t("approvalStale");
}

export default async function ContentVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { versionId } = await params;
  const query = await searchParams;
  const t = await getTranslator("content");
  const href = `/dashboard/content/versions/${versionId}`;
  const back = [{ href: "/dashboard/content", label: t("backToVersions") }];
  let detail: Awaited<ReturnType<typeof readContentVersion>>;
  try {
    detail = await readContentVersion(getConnection(), session.user.id, versionId);
  } catch {
    console.error("content-version-read-failed", { versionId });
    detail = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in detail) {
    if (detail.error === "NOT_FOUND") notFound();
    return (
      <VersionCanvas
        title={t("versionDetail")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("versionUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={href}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={back}
      />
    );
  }

  const db = getConnection();
  const { version, approvals, packages, assets, publications, approvalCurrent, readOnly } = detail;
  const operationId = typeof query.op === "string" ? query.op : null;
  const exportError = exportUiError(query.exportError);
  const exported = operationId
    ? await readExportJob(db, session.user.id, version.brandId, operationId)
    : null;
  const job = exported && !("error" in exported) ? exported : null;
  const canEdit = !readOnly;
  const assetError = assetErrorCode(query.assetError);
  const status = version.status;
  const headerPreflight = canEdit && status === "approved" && approvalCurrent;
  const links = [
    ...back,
    { href: `/dashboard/content/versions/${version.id}/variants`, label: t("openChannelVariants") },
    { href: `/dashboard/brands/${version.brandId}/facts`, label: t("brandFactsLink") },
    { href: `/dashboard/content/sources?brandId=${encodeURIComponent(version.brandId)}`, label: t("sourcesLink") },
  ];

  return (
    <VersionCanvas
      title={t("versionDetail")}
      summary={(
        <div className="max-w-2xl space-y-3">
          <p role="status" className="break-words text-sm leading-7 text-muted-foreground">
            {taskCopy(t, status, approvalCurrent, readOnly)}
          </p>
          <Badge variant="secondary">{status}</Badge>
          <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{version.id}</p>
        </div>
      )}
      primary={canEdit && (status === "draft" || status === "rejected" || status === "invalidated") ? (
        <ReviewButton action="submit-review" version={version} label={t("submit-review")} />
      ) : canEdit && status === "in_review" ? (
        <ReviewButton action="approve-content" version={version} label={t("approve-content")} />
      ) : headerPreflight ? (
        <ExportPreflightForm version={version} t={t} />
      ) : null}
      relatedLabel={t("relatedEntries")}
      related={links}
    >
      <section className="min-w-0 space-y-2">
        <h2 className="text-lg font-semibold">{t("titleField")}</h2>
        <p className="[overflow-wrap:anywhere] text-sm leading-6">{version.title}</p>
      </section>

      <section className="min-w-0 space-y-2 rounded-2xl border bg-card p-5 text-sm">
        <p className="[overflow-wrap:anywhere]">{t("channel")}: {version.targetChannel}</p>
        <p className="[overflow-wrap:anywhere]">{t("labelingVersion")}: {version.labelingProfileVersion}</p>
        <p>{t("labelingStatus")}: {t(version.labelingProfileStatus)}</p>
        <p>{t("imagesAttached")}: {assets.length}</p>
        <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{t("fingerprint")}: {detail.currentFingerprint}</p>
        {canEdit && status === "in_review" ? (
          <div className="pt-2">
            <ReviewButton action="reject-content" version={version} label={t("reject-content")} variant="outline" />
          </div>
        ) : null}
      </section>

      {canEdit ? (
        <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">{t("saveVariant")}</h2>
          <p className="break-words text-sm leading-6 text-muted-foreground">{t("variantHint")}</p>
          <form action={updateVariantAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <input type="hidden" name="brandId" value={version.brandId} />
            <input type="hidden" name="versionId" value={version.id} />
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("titleField")}</span>
              <input name="title" required defaultValue={version.title} className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("bodyMarkdown")}</span>
              <textarea name="bodyMarkdown" rows={10} required defaultValue={version.bodyMarkdown} className={areaClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("channel")}</span>
              <input name="targetChannel" required defaultValue={version.targetChannel} className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("labelingVersion")}</span>
              <input name="labelingProfileVersion" required defaultValue={version.labelingProfileVersion} className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("labelingStatus")}</span>
              <select name="labelingProfileStatus" defaultValue={version.labelingProfileStatus} className={inputClass}>
                <option value="unverified">{t("unverified")}</option>
                <option value="verified">{t("verified")}</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetIds")}</span>
              <textarea
                name="imageAssetIds"
                rows={2}
                defaultValue={assets.map((asset) => asset.id).join("\n")}
                className={areaClass}
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" className={actionClass}>{t("saveVariant")}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("assetsRegistered")}</h2>
        {assets.length ? (
          <ul className="space-y-2 text-sm">
            {assets.map((asset) => (
              <li key={asset.id} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="[overflow-wrap:anywhere]">{asset.id}</span>
                <Badge variant="outline">{asset.kind}</Badge>
                <Badge variant="outline">{asset.visibility === "public" ? t("assetPublic") : t("assetInternal")}</Badge>
                <Badge variant="outline">{asset.reviewStatus}</Badge>
                {asset.visibility === "public" && asset.reviewStatus !== "approved" ? (
                  <span className="text-muted-foreground">{t("ASSET_UNREVIEWED")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {assetError ? <p role="alert" className="break-words text-sm text-destructive">{t(assetError)}</p> : null}
        {canEdit ? (
          <form action={registerAssetAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <input type="hidden" name="brandId" value={version.brandId} />
            <input type="hidden" name="versionId" value={version.id} />
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetKind")}</span>
              <select name="kind" defaultValue="inline" className={inputClass}>
                <option value="cover">cover</option>
                <option value="inline">inline</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetVisibility")}</span>
              <select name="visibility" defaultValue="public" className={inputClass}>
                <option value="public">{t("assetPublic")}</option>
                <option value="internal">{t("assetInternal")}</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetSource")}</span>
              <input name="source" required className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetRights")}</span>
              <input name="rightsStatement" required className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetReview")}</span>
              <select name="reviewStatus" defaultValue="pending" className={inputClass}>
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("assetRef")}</span>
              <input name="contentRef" required className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("assetFile")}</span>
              <input name="file" type="file" accept="image/jpeg,image/png,image/webp" className={inputClass} />
              <span className="mt-1 block break-words text-xs text-muted-foreground">{t("assetFileHint")}</span>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="outline" className={actionClass}>{t("registerAsset")}</Button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("approvalHistory")}</h2>
        {approvals.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">{t("approvalsEmpty")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {approvals.map((approval) => (
              <li key={approval.id} className="min-w-0 rounded-2xl border bg-card px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">{approval.decision}</Badge>
                  <span className="text-xs text-muted-foreground">{approval.createdAt}</span>
                </div>
                <p className="mt-2 [overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">
                  {t("fingerprint")}: {approval.contentFingerprint}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("exportTitle")}</h2>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("exportHint")}</p>
        {exportError ? <p role="alert" className="break-words text-sm leading-6">{t(exportError)}</p> : null}
        {canEdit && !headerPreflight ? <ExportPreflightForm version={version} t={t} /> : null}

        {job ? (
          <div className="min-w-0 space-y-3 text-sm">
            <h3 className="font-medium">{t("preflightResult")}</h3>
            <ul className="space-y-2">
              {job.items.map((item) => (
                <li key={item.versionId} className="min-w-0 rounded-xl border px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant={item.eligible ? "secondary" : "outline"}>
                      {item.eligible ? t("eligible") : t("blocked")}
                    </Badge>
                    <Badge variant="outline">{item.kind === "formal" ? t("formal") : t("review")}</Badge>
                  </div>
                  {item.blockers.length ? (
                    <ul className="mt-2 list-disc pl-5 break-words text-muted-foreground" aria-label={t("blockers")}>
                      {item.blockers.map((code) => <li key={code}>{t(code)}</li>)}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            {job.job.status === "queued" && job.eligibleVersionIds.length && canEdit ? (
              <form action={exportConfirmAction}>
                <input type="hidden" name="brandId" value={version.brandId} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="operationId" value={job.job.operationId} />
                <input type="hidden" name="chosenVersionIds" value={job.eligibleVersionIds.join("\n")} />
                <Button type="submit" className={actionClass}>{t("confirmExport")}</Button>
              </form>
            ) : null}
            {job.job.status === "ready" ? <p role="status">{t("exportDone")}</p> : null}
            {job.job.status === "failed" ? <p role="alert" className="[overflow-wrap:anywhere]">{t("exportFailed")}: {job.job.error}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold">{t("packages")}</h2>
        {packages.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">{t("packagesEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {packages.map((pkg) => (
              <li key={pkg.id} className="min-w-0 rounded-2xl border bg-card px-4 py-4 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="secondary">{pkg.kind === "formal" ? t("formal") : t("review")}</Badge>
                  {pkg.nonPublishable ? <Badge variant="outline">{t("nonPublishable")}</Badge> : null}
                  {pkg.doNotReuse ? <Badge variant="outline">{t("doNotReuse")}</Badge> : null}
                  <span className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{pkg.targetChannel} · {pkg.createdAt}</span>
                </div>
                <p className="mt-2 flex min-w-0 flex-wrap gap-3">
                  {["content.md", "content.html", "manifest.json", "public-sources.json", "publish-checklist.md"].map((file) => (
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
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("publications")}</h2>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("publicationHint")}</p>
        {publications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("publicationsEmpty")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {publications.map((item) => (
              <li key={item.id} className="min-w-0 rounded-md border px-3 py-2">
                <Link
                  href={`/dashboard/content/publications/${item.id}`}
                  prefetch={false}
                  className="[overflow-wrap:anywhere] underline-offset-4 hover:underline"
                >
                  {item.status} · {item.pageUrl}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {t("effectiveAt")}: {item.effectiveAt ?? t("noEffectiveAt")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canEdit && version.status === "approved" && approvalCurrent ? (
          <form action={submitPublicationAction} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
            <input type="hidden" name="brandId" value={version.brandId} />
            <input type="hidden" name="versionId" value={version.id} />
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("pageUrl")}</span>
              <input name="pageUrl" required placeholder="https://example.com/published" className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("targetAccount")}</span>
              <input name="targetAccount" required className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("claimedPublishedAt")}</span>
              <input name="claimedPublishedAt" required placeholder="2026-11-20T10:00:00.000Z" className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("channelDeclaration")}</span>
              <input name="channelDeclaration" required className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("accessClass")}</span>
              <select name="accessClass" className={inputClass} defaultValue="">
                <option value="">{t("skipFixture")}</option>
                <option value="public">public</option>
                <option value="login_wall">login_wall</option>
                <option value="draft_box">draft_box</option>
                <option value="removed">removed</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">{t("httpStatus")}</span>
              <input name="httpStatus" type="number" defaultValue={200} className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("fixtureTitle")}</span>
              <input name="fixtureTitle" className={inputClass} />
            </label>
            <label className="block min-w-0 text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">{t("fixtureBody")}</span>
              <textarea name="fixtureBody" rows={5} className={areaClass} />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" className={actionClass}>{t("submitPublication")}</Button>
            </div>
          </form>
        ) : null}
      </section>
    </VersionCanvas>
  );
}
