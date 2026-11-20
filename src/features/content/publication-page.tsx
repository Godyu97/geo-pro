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

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("publicationDetail"), robots: { index: false, follow: false } };
}

const inputClass = "h-10 w-full rounded-md border bg-background px-3";
const areaClass = "w-full rounded-md border bg-background px-3 py-2";

export default async function ContentPublicationPage({
  params,
}: {
  params: Promise<{ publicationId: string }>;
}) {
  const session = await requireSession();
  const { publicationId } = await params;
  const t = await getTranslator("content");
  const liveFetchEnabled = isPublicPageFetchEnabled();
  const detail = await readPublication(getConnection(), session.user.id, publicationId);
  if ("error" in detail) notFound();

  const { publication, checks, actions, version, readOnly } = detail;
  const canEdit = !readOnly;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/dashboard/content/versions/${version.id}`}
              prefetch={false}
              className="underline-offset-4 hover:underline"
            >
              {t("backToVersion")}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("publicationDetail")}</h1>
          <p className="mt-2 text-xs text-muted-foreground">{publication.id}</p>
        </div>
        <Badge variant="secondary">{publication.status}</Badge>
      </div>

      <section className="space-y-2 rounded-2xl border p-5 text-sm">
        <p>{t("pageUrl")}: <span className="break-all">{publication.pageUrl}</span></p>
        <p>{t("targetAccount")}: {publication.targetAccount}</p>
        <p>{t("claimedPublishedAt")}: {publication.claimedPublishedAt}</p>
        <p>{t("effectiveAt")}: {publication.effectiveAt ?? t("noEffectiveAt")}</p>
        <p>{t("evidenceGrade")}: {publication.evidenceGrade ?? t("none")}</p>
        <p>{t("channelDeclaration")}: {publication.channelDeclaration}</p>
        <p>{t("contentVersion")}: {version.title}</p>
      </section>

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("checkHistory")}</h2>
        {checks.length === 0 ? <p className="text-sm text-muted-foreground">{t("checksEmpty")}</p> : (
          <ul className="space-y-2 text-sm">
            {checks.map((check) => (
              <li key={check.id} className="rounded-md border px-3 py-2">
                <p>{check.checkedAt} · {check.method} · {check.resultStatus}</p>
                {check.notes ? <p className="text-muted-foreground">{check.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("maintenanceActions")}</h2>
        {actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("actionsEmpty")}</p> : (
          <ul className="space-y-2 text-sm">
            {actions.map((action) => (
              <li key={action.id} className="rounded-md border px-3 py-2">
                <p>{action.kind} · {action.status}</p>
                <p className="text-muted-foreground">{action.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit ? (
        <>
          <section className="space-y-3 rounded-2xl border p-5">
            <h2 className="text-lg font-semibold">{t("runPublicCheck")}</h2>
            <p className="text-sm text-muted-foreground">{t("fixtureHint")}</p>
            <p className="text-sm text-muted-foreground">
              {liveFetchEnabled ? t("liveFetchEnabled") : t("liveFetchDisabled")}
            </p>
            <form action={verifyPublicationAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="brandId" value={publication.brandId} />
              <input type="hidden" name="publicationId" value={publication.id} />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input name="useLiveFetch" type="checkbox" value="true" className="mt-1" />
                <span>{t("useLiveFetch")}</span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t("accessClass")}</span>
                <select name="accessClass" className={inputClass} defaultValue="public">
                  <option value="public">public</option>
                  <option value="login_wall">login_wall</option>
                  <option value="draft_box">draft_box</option>
                  <option value="removed">removed</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t("httpStatus")}</span>
                <input name="httpStatus" type="number" defaultValue={200} className={inputClass} />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">{t("fixtureTitle")}</span>
                <input name="fixtureTitle" className={inputClass} />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">{t("fixtureBody")}</span>
                <textarea name="fixtureBody" rows={6} className={areaClass} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">{t("runPublicCheck")}</Button>
              </div>
            </form>
          </section>

          <section className="space-y-3 rounded-2xl border p-5">
            <h2 className="text-lg font-semibold">{t("manualEvidence")}</h2>
            <p className="text-sm text-muted-foreground">{t("manualEvidenceHint")}</p>
            <form action={submitManualEvidenceAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="brandId" value={publication.brandId} />
              <input type="hidden" name="publicationId" value={publication.id} />
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">{t("screenshotRef")}</span>
                <input name="screenshotRef" required className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t("pageMarker")}</span>
                <input name="pageMarker" required className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t("observedAt")}</span>
                <input name="observedAt" required placeholder="2026-11-20T12:00:00.000Z" className={inputClass} />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">{t("bodyExcerpt")}</span>
                <textarea name="bodyExcerpt" required rows={6} className={areaClass} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">{t("submitManualEvidence")}</Button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
