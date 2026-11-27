import Link from "next/link";
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { brandMaterialAccess } from "../brands/intake.ts";
import { workspaceBrand } from "../team-access/brand-scope.ts";
import { createFactFromSourceAction, importSourcesAction, setSourceRightsAction } from "./actions.ts";
import { listImportedOriginals } from "./commands.ts";
import type { SourceReason, SourceRights, SourceStatus } from "./contracts.ts";
import { SourceImportSubmit } from "./source-import-submit";

const sourcesPath = "/dashboard/content/sources";
const contentPath = "/dashboard/content";
const actionClass = "min-h-10 whitespace-normal text-center";

const errorCodes = ["NOT_FOUND", "INVALID_INPUT", "SERVICE_UNAVAILABLE", "FORBIDDEN", "SESSION_REQUIRED"] as const;

function isErrorCode(value: string): value is (typeof errorCodes)[number] {
  return errorCodes.some((code) => code === value);
}

function statusKey(status: SourceStatus) {
  if (status === "ready") return "statusReady" as const;
  if (status === "partial") return "statusPartial" as const;
  return "statusFailed" as const;
}

function reasonKey(reason: SourceReason) {
  if (reason === "encrypted") return "reasonEncrypted" as const;
  if (reason === "oversized") return "reasonOversized" as const;
  if (reason === "unrecognized") return "reasonUnrecognized" as const;
  if (reason === "batch_limit") return "reasonBatchLimit" as const;
  if (reason === "capacity") return "reasonCapacity" as const;
  return "reasonUnavailable" as const;
}

function rightsKey(rights: SourceRights) {
  if (rights === "revoked") return "rightsRevoked" as const;
  if (rights === "expired") return "rightsExpired" as const;
  return "rightsActive" as const;
}

export async function generateMetadata() {
  const t = await getTranslator("sources");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function loadSources(userId: string, requestedBrandId: string | string[] | undefined) {
  const requested = brandIdSchema.safeParse(requestedBrandId);
  if (requestedBrandId !== undefined && !requested.success) return { state: "notFound" } as const;
  let brandId = requested.data;
  try {
    const connection = getConnection();
    brandId ??= (await workspaceBrand(connection, userId, undefined, "read"))?.brandId;
    if (!brandId) return { state: "noBrand" } as const;
    const listed = await listImportedOriginals(connection, userId, brandId);
    if ("error" in listed) return { state: "notFound" } as const;
    return { state: "ready", brandId, ...listed } as const;
  } catch {
    console.error("source-original-list-unavailable");
    return { state: "unavailable", brandId } as const;
  }
}

export default async function SourceOriginalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("sources");
  const workspace = await loadSources(session.user.id, params.brandId);
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const batch = typeof params.batch === "string" && params.batch.length <= 64 ? params.batch : null;

  if (workspace.state !== "ready") {
    const noBrand = workspace.state === "noBrand";
    const unavailable = workspace.state === "unavailable";
    const retry = new URLSearchParams();
    if (unavailable && workspace.brandId) retry.set("brandId", workspace.brandId);
    if (batch) retry.set("batch", batch);
    const retryHref = retry.size ? `${sourcesPath}?${retry}` : sourcesPath;
    return (
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role={!noBrand || error ? "alert" : undefined} className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t(unavailable ? "readUnavailable" : noBrand ? error ?? "noBrand" : "brandUnavailable")}
        </p>
        <Button asChild className={actionClass}>
          {unavailable ? <a href={retryHref}>{t("reload")}</a> : (
            <Link href={noBrand ? "/dashboard/brands" : contentPath} prefetch={false}>{t(noBrand ? "goBrands" : "back")}</Link>
          )}
        </Button>
      </header>
    );
  }

  const { brandId, canManage, files } = workspace;
  const canCreateFact = workspace.canCreateFact && brandMaterialAccess(await headers(), session.user.email).ok;
  const groups = new Map<string, typeof files>();
  for (const file of files) {
    const group = groups.get(file.batchId);
    if (group) group.push(file);
    else groups.set(file.batchId, [file]);
  }
  const currentFiles = batch ? groups.get(batch) : undefined;
  const totals = { ready: 0, partial: 0, failed: 0 };
  for (const file of currentFiles ?? []) {
    totals[file.status] += 1;
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t(canManage ? "description" : "readOnly")}
        </p>
        <div className="flex flex-wrap gap-2">
          {currentFiles && (
            <Button asChild className={actionClass}><a href="#source-current-batch">{t("viewResult")}</a></Button>
          )}
          {canManage && (
            <Button asChild variant={currentFiles ? "outline" : "default"} className={actionClass}>
              <a href="#source-files">{t("startImport")}</a>
            </Button>
          )}
          {!currentFiles && groups.size > 0 && (
            <Button asChild variant={canManage ? "outline" : "default"} className={actionClass}>
              <a href="#source-history">{t("viewHistory")}</a>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`${contentPath}?brandId=${brandId}`} prefetch={false}>{t("back")}</Link>
          </Button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-sm text-destructive">{t(error)}</p>}
      {currentFiles && (
        <p role="status" className="rounded-lg border bg-card p-3 text-sm">
          {t("batchResult", {
            ready: formatNumber(locale, totals.ready),
            partial: formatNumber(locale, totals.partial),
            failed: formatNumber(locale, totals.failed),
          })}
        </p>
      )}
      {canManage && (
        <Card className="max-w-xl">
          <CardContent>
            <h2 id="source-import" className="mb-3 font-semibold">{t("submit")}</h2>
            <form aria-labelledby="source-import" action={importSourcesAction} className="space-y-3">
              <input type="hidden" name="brandId" value={brandId} />
              <label className="block">
                <span className="mb-1 block">{t("upload")}</span>
                <Input
                  id="source-files"
                  className="block min-h-10 scroll-mt-24"
                  type="file"
                  name="files"
                  multiple
                  required
                  accept=".txt,.md,.markdown,.json,.pdf,text/plain,text/markdown,application/json,application/pdf"
                />
              </label>
              <SourceImportSubmit label={t("submit")} pendingLabel={t("importing")} />
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="source-history" className="space-y-3">
        <h2 id="source-history" tabIndex={-1} className="scroll-mt-24 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          {t("history")}
        </h2>
        {groups.size === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="space-y-6">
            {Array.from(groups, ([batchId, group]) => (
              <section key={batchId} className="min-w-0 space-y-3">
                <h3 id={batchId === batch ? "source-current-batch" : undefined} tabIndex={batchId === batch ? -1 : undefined}
                  className="scroll-mt-24 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
                  {t(batchId === batch ? "thisBatch" : "batch")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("notApproved")}</p>
                <ul className="space-y-3">
                  {group.map((file) => {
                    const downloadable = canManage && file.rightsStatus === "active" && file.storedObjectId !== null;
                    return (
                      <li key={file.id} className="rounded-xl border bg-card p-4 text-sm">
                        <p className="font-medium [overflow-wrap:anywhere]">{file.fileName}</p>
                        <p className="mt-2 font-medium leading-6">{t(statusKey(file.status))}</p>
                        {file.reason ? <p className="mt-1 leading-6">{t(reasonKey(file.reason))}</p> : null}
                        {file.storedObjectId ? <p className="mt-1 leading-6">{t(rightsKey(file.rightsStatus))}</p> : null}
                        {file.fragments.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            <h4 className="font-medium">{t("fragmentHeading")}</h4>
                            <ul className="space-y-2">
                              {file.fragments.map((fragment) => (
                                <li key={fragment.id} className="rounded-xl border border-dashed px-3 py-3 leading-6">
                                  {fragment.readable && fragment.text !== null ? (
                                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{fragment.text}</p>
                                  ) : null}
                                  {fragment.readable && fragment.text === null ? <p>{t("fragmentMissing")}</p> : null}
                                  {!fragment.readable ? <p>{t("fragmentUnreadable")}</p> : null}
                                  {fragment.page !== null ? (
                                    <p>{t("fragmentPage", { page: formatNumber(locale, fragment.page) })}</p>
                                  ) : (
                                    <p>{t("fragmentPageMissing")}</p>
                                  )}
                                  {fragment.conflicts.length === 0 ? <p>{t("fragmentNoConflict")}</p> : fragment.conflicts.map((conflict) => (
                                    <p key={conflict.factVersionId} className="break-all">
                                      {t("fragmentConflict", {
                                        version: formatNumber(locale, conflict.version),
                                        id: conflict.factVersionId,
                                      })}
                                    </p>
                                  ))}
                                  {canCreateFact && fragment.readable && fragment.text?.trim() && (
                                    <form className="mt-2" action={createFactFromSourceAction.bind(null, brandId, fragment.id)}>
                                      <SourceImportSubmit label={t("createFact")} pendingLabel={t("creatingFact")} />
                                    </form>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {downloadable ? (
                          <p className="mt-3">
                            <Link
                              href={`/api/content/sources/${file.id}?brandId=${brandId}`}
                              prefetch={false}
                              className="underline underline-offset-4"
                            >
                              {t("download")}
                            </Link>
                          </p>
                        ) : null}
                        {downloadable ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <form action={setSourceRightsAction}>
                              <input type="hidden" name="brandId" value={brandId} />
                              <input type="hidden" name="id" value={file.id} />
                              <input type="hidden" name="rights" value="revoked" />
                              <Button type="submit" variant="outline">{t("revoke")}</Button>
                            </form>
                            <form action={setSourceRightsAction}>
                              <input type="hidden" name="brandId" value={brandId} />
                              <input type="hidden" name="id" value={file.id} />
                              <input type="hidden" name="rights" value="expired" />
                              <Button type="submit" variant="outline">{t("expire")}</Button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
