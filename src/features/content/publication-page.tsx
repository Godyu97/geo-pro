import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isPublicPageFetchEnabled } from "@/lib/http/public-page-fetch";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { submitManualEvidenceAction, verifyPublicationAction } from "./actions";
import { readPublication } from "./commands";
import type { PublicationStatus } from "./contracts";
import { manualScreenshotSummary } from "./verify";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("publicationDetail"), robots: { index: false, follow: false } };
}

const actionClass = "h-auto max-w-full whitespace-normal";
const inputClass = "h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3";
const areaClass = "w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const evidenceErrorCodes = [
  "EVIDENCE_TYPE_REJECTED",
  "EVIDENCE_TOO_LARGE",
  "SCREENSHOT_REQUIRED",
  "EVIDENCE_REQUIRED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "SERVICE_UNAVAILABLE",
  "PUBLICATION_CONFLICT",
  "APPROVAL_REQUIRED",
  "APPROVAL_INVALID",
] as const;

type Translate = Awaited<ReturnType<typeof getTranslator<"content">>>;
type HeaderAction = "check" | "manual";

function evidenceErrorCode(value: string | string[] | undefined) {
  const code = Array.isArray(value) ? value[0] : value;
  return evidenceErrorCodes.find((item) => item === code);
}

function PublicationCanvas({
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

function taskCopy(t: Translate, status: PublicationStatus, readOnly: boolean) {
  if (readOnly) return t("readOnly");
  if (status === "prepared" || status === "submitted" || status === "pending_check") return t("publicationTaskCheck");
  if (status === "draft_only") return t("publicationTaskDraft");
  if (status === "access_limited") return t("publicationTaskLimited");
  if (status === "verified_public") return t("publicationTaskPublic");
  if (status === "verified_manual") return t("publicationTaskManual");
  if (status === "mismatch") return t("publicationTaskMismatch");
  return t("publicationTaskRemoved");
}

function headerAction(status: PublicationStatus, readOnly: boolean): HeaderAction | null {
  if (readOnly) return null;
  if (status === "draft_only" || status === "access_limited") return "manual";
  if (status === "verified_public" || status === "verified_manual") return null;
  return "check";
}

function PublicCheckForm({
  publication,
  t,
  liveFetchEnabled,
}: {
  publication: { id: string; brandId: string };
  t: Translate;
  liveFetchEnabled: boolean;
}) {
  return (
    <form action={verifyPublicationAction} className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2">
      <input type="hidden" name="brandId" value={publication.brandId} />
      <input type="hidden" name="publicationId" value={publication.id} />
      <div className="sm:col-span-2">
        <Button type="submit" className={actionClass}>{t("runPublicCheck")}</Button>
      </div>
      <p className="break-words text-sm leading-6 text-muted-foreground sm:col-span-2">{t("fixtureHint")}</p>
      <p className="break-words text-sm leading-6 text-muted-foreground sm:col-span-2">
        {liveFetchEnabled ? t("liveFetchEnabled") : t("liveFetchDisabled")}
      </p>
      <label className="flex min-w-0 items-start gap-2 text-sm sm:col-span-2">
        <input name="useLiveFetch" type="checkbox" value="true" className="mt-1" />
        <span className="break-words">{t("useLiveFetch")}</span>
      </label>
      <label className="block min-w-0 text-sm">
        <span className="mb-1 block text-muted-foreground">{t("accessClass")}</span>
        <select name="accessClass" className={inputClass} defaultValue="public">
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
        <textarea name="fixtureBody" rows={6} className={areaClass} />
      </label>
    </form>
  );
}

function ManualEvidenceForm({
  publication,
  t,
  evidenceError,
}: {
  publication: { id: string; brandId: string };
  t: Translate;
  evidenceError?: (typeof evidenceErrorCodes)[number];
}) {
  return (
    <form action={submitManualEvidenceAction} className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2">
      <input type="hidden" name="brandId" value={publication.brandId} />
      <input type="hidden" name="publicationId" value={publication.id} />
      <div className="sm:col-span-2">
        <Button type="submit" className={actionClass}>{t("submitManualEvidence")}</Button>
      </div>
      {evidenceError ? <p role="alert" className="break-words text-sm text-destructive sm:col-span-2">{t(evidenceError)}</p> : null}
      <p className="break-words text-sm leading-6 text-muted-foreground sm:col-span-2">{t("manualEvidenceHint")}</p>
      <label className="block min-w-0 text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">{t("screenshotFile")}</span>
        <input
          name="screenshot"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className={inputClass}
        />
        <span className="mt-1 block break-words text-xs text-muted-foreground">{t("screenshotFileHint")}</span>
      </label>
      <label className="block min-w-0 text-sm">
        <span className="mb-1 block text-muted-foreground">{t("pageMarker")}</span>
        <input name="pageMarker" required className={inputClass} />
      </label>
      <label className="block min-w-0 text-sm">
        <span className="mb-1 block text-muted-foreground">{t("observedAt")}</span>
        <input name="observedAt" required placeholder="2026-11-20T12:00:00.000Z" className={inputClass} />
      </label>
      <label className="block min-w-0 text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">{t("bodyExcerpt")}</span>
        <textarea name="bodyExcerpt" required rows={6} className={areaClass} />
      </label>
    </form>
  );
}

export default async function ContentPublicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { publicationId } = await params;
  const evidenceError = evidenceErrorCode((await searchParams).evidenceError);
  const t = await getTranslator("content");
  const liveFetchEnabled = isPublicPageFetchEnabled();
  const href = `/dashboard/content/publications/${publicationId}`;
  const back = [{ href: "/dashboard/content", label: t("backToList") }];
  let detail: Awaited<ReturnType<typeof readPublication>>;
  try {
    detail = await readPublication(getConnection(), session.user.id, publicationId);
  } catch {
    console.error("content-publication-read-failed", { publicationId });
    detail = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in detail) {
    if (detail.error === "NOT_FOUND") notFound();
    return (
      <PublicationCanvas
        title={t("publicationDetail")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("publicationUnavailable")}</p>}
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

  const { publication, checks, actions, version, readOnly } = detail;
  const canEdit = !readOnly;
  const status = publication.status;
  const action = headerAction(status, readOnly);
  const links = [
    { href: `/dashboard/content/versions/${version.id}`, label: t("backToVersion") },
    ...back,
    { href: `/dashboard/brands/${publication.brandId}/facts`, label: t("brandFactsLink") },
  ];
  const checkForm = (
    <PublicCheckForm publication={publication} t={t} liveFetchEnabled={liveFetchEnabled} />
  );

  return (
    <PublicationCanvas
      title={t("publicationDetail")}
      summary={(
        <div className="max-w-2xl space-y-3">
          <p role="status" className="break-words text-sm leading-7 text-muted-foreground">
            {taskCopy(t, status, readOnly)}
          </p>
          <Badge variant="secondary">{status}</Badge>
          <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{publication.id}</p>
        </div>
      )}
      primary={action === "check" ? checkForm : action === "manual" ? (
        <ManualEvidenceForm publication={publication} t={t} evidenceError={evidenceError} />
      ) : null}
      relatedLabel={t("relatedEntries")}
      related={links}
    >
      <section className="min-w-0 space-y-2 rounded-2xl border bg-card p-5 text-sm">
        <p>{t("pageUrl")}: <span className="[overflow-wrap:anywhere]">{publication.pageUrl}</span></p>
        <p>{t("targetAccount")}: <span className="[overflow-wrap:anywhere]">{publication.targetAccount}</span></p>
        <p>{t("claimedPublishedAt")}: <span className="[overflow-wrap:anywhere]">{publication.claimedPublishedAt}</span></p>
        <p>{t("effectiveAt")}: <span className="[overflow-wrap:anywhere]">{publication.effectiveAt ?? t("noEffectiveAt")}</span></p>
        <p>{t("evidenceGrade")}: <span>{publication.evidenceGrade ?? t("none")}</span></p>
        <p>{t("channelDeclaration")}: <span className="[overflow-wrap:anywhere]">{publication.channelDeclaration}</span></p>
        <p>{t("contentVersion")}: <span className="[overflow-wrap:anywhere]">{version.title}</span></p>
      </section>

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("checkHistory")}</h2>
        {checks.length === 0 ? <p className="text-sm text-muted-foreground">{t("checksEmpty")}</p> : (
          <ul className="space-y-2 text-sm">
            {checks.map((check) => {
              const screenshot = manualScreenshotSummary(check.evidenceJson);
              return (
                <li key={check.id} className="min-w-0 rounded-md border px-3 py-2">
                  <p className="[overflow-wrap:anywhere]">{check.checkedAt} · {check.method} · {check.resultStatus}</p>
                  {check.notes ? <p className="break-words text-muted-foreground">{check.notes}</p> : null}
                  {screenshot ? (
                    <p className="mt-1 break-words">
                      <a
                        href={`/api/content/publications/${publication.id}?evidence=${screenshot.objectId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {t("downloadScreenshot")}
                      </a>
                      <span className="text-muted-foreground"> · {t("manualScreenshotNote")}</span>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("maintenanceActions")}</h2>
        {actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("actionsEmpty")}</p> : (
          <ul className="space-y-2 text-sm">
            {actions.map((item) => (
              <li key={item.id} className="min-w-0 rounded-md border px-3 py-2">
                <p>{item.kind} · {item.status}</p>
                <p className="break-words text-muted-foreground">{item.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && action !== "check" ? (
        <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">{t("runPublicCheck")}</h2>
          {checkForm}
        </section>
      ) : null}
    </PublicationCanvas>
  );
}
