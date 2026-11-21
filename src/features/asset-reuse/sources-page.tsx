import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao.ts";
import { importSourcesAction, setSourceRightsAction } from "./actions.ts";
import { listImportedOriginals } from "./commands.ts";
import type { SourceReason, SourceRights, SourceStatus } from "./contracts.ts";

const inputClass = "block w-full text-sm";

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

export default async function SourceOriginalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("sources");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const batch = typeof params.batch === "string" ? params.batch : null;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const listed = await listImportedOriginals(connection, session.user.id, brandId);
  if ("error" in listed) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t(listed.error)}</p>
        <Link href="/dashboard/content" prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
      </div>
    );
  }

  const groups: { batchId: string; files: typeof listed.files }[] = [];
  for (const file of listed.files) {
    const last = groups.at(-1);
    if (!last || last.batchId !== file.batchId) groups.push({ batchId: file.batchId, files: [file] });
    else last.files.push(file);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm">
          <Link href={`/dashboard/content?brandId=${brandId}`} prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>

      {error ? <p role="alert" className="text-sm">{t(error)}</p> : null}

      <form action={importSourcesAction} className="space-y-4 rounded-2xl border p-4">
        <input type="hidden" name="brandId" value={brandId} />
        <label className="block text-sm">
          <span className="mb-2 block text-muted-foreground">{t("upload")}</span>
          <input
            className={inputClass}
            type="file"
            name="files"
            multiple
            required
            accept=".txt,.md,.markdown,.json,.pdf,text/plain,text/markdown,application/json,application/pdf"
          />
        </label>
        <Button type="submit">{t("submit")}</Button>
      </form>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.batchId} className="space-y-3">
              <h2 className="text-lg font-semibold">
                {t("batch")} {group.batchId === batch ? `· ${t("thisBatch")}` : ""}
              </h2>
              <p className="text-sm text-muted-foreground">{t("notApproved")}</p>
              <ul className="space-y-3">
                {group.files.map((file) => {
                  const downloadable = file.rightsStatus === "active" && file.storedObjectId !== null;
                  return (
                    <li key={file.id} className="rounded-2xl border px-4 py-4 text-sm">
                      <p className="font-medium break-all">{file.fileName}</p>
                      <p className="mt-2 leading-6">{t(statusKey(file.status))}</p>
                      {file.reason ? <p className="mt-1 leading-6">{t(reasonKey(file.reason))}</p> : null}
                      {file.storedObjectId ? <p className="mt-1 leading-6">{t(rightsKey(file.rightsStatus))}</p> : null}
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
    </div>
  );
}
