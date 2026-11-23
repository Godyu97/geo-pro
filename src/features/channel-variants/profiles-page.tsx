import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao.ts";
import { publishChannelProfileAction } from "./actions.ts";
import { listChannelProfiles } from "./commands.ts";

const fieldClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const areaClass = "w-full min-w-0 rounded-md border bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const errorCodes = ["NOT_FOUND", "INVALID_INPUT", "SESSION_REQUIRED"] as const;
const noticeCodes = ["published"] as const;

function isErrorCode(value: string): value is (typeof errorCodes)[number] {
  return errorCodes.some((code) => code === value);
}

function isNoticeCode(value: string): value is (typeof noticeCodes)[number] {
  return noticeCodes.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("channelProfiles");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ChannelProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("channelProfiles");
  const locale = await getLocale();
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const notice = typeof params.notice === "string" && isNoticeCode(params.notice) ? params.notice : null;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const listed = await listChannelProfiles(connection, session.user.id, brandId);
  if ("error" in listed) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t(listed.error)}</p>
        <Link href="/dashboard/content" prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
      </div>
    );
  }

  const groups = new Map<string, typeof listed.versions>();
  for (const version of listed.versions) {
    const rows = groups.get(version.channelKey) ?? [];
    rows.push(version);
    groups.set(version.channelKey, rows);
  }

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <p className="text-sm">
          <Link href={`/dashboard/content?brandId=${brandId}`} prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
        </p>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : null}
      {notice ? <p role="status" className="text-sm">{t(notice)}</p> : null}
      {listed.readOnly ? <p role="status" className="text-sm text-muted-foreground">{t("readOnly")}</p> : null}

      {listed.readOnly ? null : (
        <form action={publishChannelProfileAction} className="grid max-w-xl gap-3 rounded-2xl border p-5">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("channelKey")}</span>
            <input name="channelKey" required pattern="[a-z0-9][a-z0-9_-]*" maxLength={64} className={fieldClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("maxCharacters")}</span>
            <input name="maxCharacters" inputMode="numeric" min={1} max={1000000} className={fieldClass} />
            <span className="mt-1 block text-muted-foreground">{t("maxCharactersHint")}</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("note")}</span>
            <textarea name="note" required rows={3} maxLength={2000} className={areaClass} />
          </label>
          <Button type="submit" className="h-auto max-w-full whitespace-normal">{t("publish")}</Button>
        </form>
      )}

      {listed.versions.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([channelKey, versions]) => (
            <section key={channelKey} className="space-y-3">
              <h2 className="break-all text-lg font-medium">{channelKey}</h2>
              <ul className="space-y-3">
                {versions.map((version) => (
                  <li key={version.id} className="rounded-2xl border px-4 py-4 text-sm">
                    <p className="font-medium">
                      {t("versionLabel", { version: version.versionNumber })}
                      {" · "}
                      {version.maxCharacters == null
                        ? t("unlimited")
                        : t("characterLimit", { count: formatNumber(locale, version.maxCharacters) })}
                    </p>
                    <p className="mt-2 leading-6 text-muted-foreground">{version.note}</p>
                    <p className="mt-2 text-muted-foreground">{formatDateTime(locale, new Date(version.createdAt))}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
